import path from "path";
import { pathToFileURL } from "url";

import type { NpcSpawn } from "../../src/data/npc/NpcSpawn";
import type { ObjSpawn } from "../../src/data/obj/ObjSpawn";
import { SdMapLoaderInput } from "../../src/renderer/loader/SdMapLoaderInput";
import { SdMapRenderDataTsBackend } from "../../src/renderer/loader/SdMapRenderDataTsBackend";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { MapImageRenderer } from "../../src/rs/render/minimap/MapImageRenderer";
import { tryCreateCacheSession } from "../../src/rs/loaders/CacheSession";
import { SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { LocModelLoader } from "../../src/rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../src/rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../src/rs/scene/model/ObjModelLoader";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeCreateConfig,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import {
    createByteDrivenSceneBuildInput,
    uploadRuntimeCacheForBuildRequest,
} from "../../src/worker/runtime-cache/MapRenderRuntimeCacheV2Uploader";
import type { MapRenderRuntimePacket } from "../../src/worker/MapRenderDataContract";
import {
    runtimePacketToPayloadOverlay,
} from "../../src/worker/MapRenderDataContract";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    warmup: number;
    iterations: number;
    backend: "ts" | "cpp-wasm" | "both";
}>;

type Square = Readonly<{
    mapX: number;
    mapY: number;
}>;

type RuntimeBridge = MapRenderRuntimeBridgeV2 &
    Readonly<{
        createRuntime?(): Promise<number | undefined>;
    }>;

type WasmBridge = RuntimeBridge &
    Readonly<{
        runtimeHandle: number;
    }>;

function buildRuntimeRequest(
    sceneBuildInput: Record<string, unknown>,
): MapRenderRuntimeBuildRequest | undefined {
    const sizeX = (sceneBuildInput.sizeX as number) | 0;
    const sizeY = (sceneBuildInput.sizeY as number) | 0;
    const baseX = (sceneBuildInput.baseX as number) | 0;
    const baseY = (sceneBuildInput.baseY as number) | 0;
    const mapSquareSize = 64;
    if (sizeX <= 0 || sizeY <= 0) return undefined;
    const borderX = ((sizeX - mapSquareSize) / 2) | 0;
    const borderY = ((sizeY - mapSquareSize) / 2) | 0;
    if (
        borderX < 0 ||
        borderY < 0 ||
        borderX !== borderY ||
        sizeX !== mapSquareSize + borderX * 2 ||
        sizeY !== mapSquareSize + borderY * 2
    ) {
        return undefined;
    }
    const borderSize = borderX;
    return {
        mapX: Math.floor((baseX + borderSize) / mapSquareSize) | 0,
        mapY: Math.floor((baseY + borderSize) / mapSquareSize) | 0,
        borderSize,
        sizeX,
        sizeY,
        cacheGame: (sceneBuildInput.cacheGame as number) | 0,
        cacheRevision: (sceneBuildInput.cacheRevision as number) | 0,
        unitsTileHeightBasis: (sceneBuildInput.unitsTileHeightBasis as number) | 0,
        smoothTerrain: !!sceneBuildInput.smoothTerrain,
        locLoadType: (sceneBuildInput.locLoadType as number) | 0,
        loadLocs: sceneBuildInput.loadLocs !== false,
        loadObjs: sceneBuildInput.loadObjs !== false,
        loadNpcs: sceneBuildInput.loadNpcs !== false,
    };
}

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let limit = 4;
    let warmup = 1;
    let iterations = 3;
    let backend: "ts" | "cpp-wasm" | "both" = "both";

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
        } else if (arg === "--warmup") {
            warmup = Number(argv[++i]);
        } else if (arg === "--iterations") {
            iterations = Number(argv[++i]);
        } else if (arg === "--backend") {
            const value = argv[++i];
            if (value === "ts" || value === "cpp-wasm" || value === "both") {
                backend = value;
            } else {
                throw new Error("Invalid --backend (expected ts|cpp-wasm|both)");
            }
        }
    }

    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Invalid --limit");
    }
    if (!Number.isFinite(warmup) || warmup < 0) {
        throw new Error("Invalid --warmup");
    }
    if (!Number.isFinite(iterations) || iterations <= 0) {
        throw new Error("Invalid --iterations");
    }

    return {
        cacheName,
        limit: limit | 0,
        warmup: warmup | 0,
        iterations: iterations | 0,
        backend,
    };
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("No caches found");
    }
    if (!cacheName) {
        return latest;
    }
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function pickSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    limit: number,
): Square[] {
    const squares: Square[] = [];
    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            squares.push({ mapX, mapY });
            if (squares.length >= limit) {
                break outer;
            }
        }
    }
    return squares;
}

async function loadWasmBridge(): Promise<WasmBridge> {
    const bridgeUrl = pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_bridge.mjs"),
    ).href;
    const mod = (await import(bridgeUrl)) as Record<string, unknown>;
    const runtimeCandidate = mod.mapRenderRuntimeBridge as Partial<RuntimeBridge> | undefined;
    if (
        !runtimeCandidate ||
        (typeof runtimeCandidate.createRuntime !== "function" &&
            typeof runtimeCandidate.createRuntimeWithConfig !== "function") ||
        typeof runtimeCandidate.cacheSetBuildConfig !== "function" ||
        typeof runtimeCandidate.cachePutBlobBatch !== "function" ||
        typeof runtimeCandidate.cacheClearBlobDomain !== "function" ||
        typeof runtimeCandidate.getLastMissingBlobEntries !== "function" ||
        typeof runtimeCandidate.cacheSetVarps !== "function" ||
        typeof runtimeCandidate.buildMapPacketFromCache !== "function"
    ) {
        throw new Error("Failed to load wasm map-render runtime bridge");
    }
    const ready =
        typeof runtimeCandidate.initRuntime === "function"
            ? await runtimeCandidate.initRuntime()
            : true;
    if (!ready) {
        throw new Error("Failed to init wasm map-render runtime bridge");
    }
    const runtimeHandle =
        typeof runtimeCandidate.createRuntimeWithConfig === "function"
            ? await runtimeCandidate.createRuntimeWithConfig({
                  cacheGame: 0,
                  cacheRevision: 0,
                  sceneLevels: 4,
                  unitsTileHeightBasis: 8,
              })
            : await runtimeCandidate.createRuntime!();
    if (runtimeHandle === undefined) {
        throw new Error("Failed to create wasm map-render runtime");
    }
    return Object.assign({ runtimeHandle }, runtimeCandidate) as WasmBridge;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const cacheInfos = loadCacheInfos();
    const cacheInfo = pickCache(cacheInfos, args.cacheName);
    const loadedCache = loadCache(cacheInfo);
    const sessionResult = tryCreateCacheSession(loadedCache as any, new JSCompressionHandler());
    if (!sessionResult.ok) {
        throw new Error(`Failed to create session for ${cacheInfo.name}`);
    }
    const session = sessionResult.value;
    const loaders = session.loaders;

    const varProvider = new VarManagerProvider(session.varManager);
    const mapBytesProvider = new MapFileBytesProvider(
        loaders.mapFileLoader,
        loadedCache.xteas as any,
    );
    const locModelLoader = new LocModelLoader(
        loaders.locTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
    );
    const objModelLoader = new ObjModelLoader(
        loaders.objTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
    );
    const npcModelLoader = new NpcModelLoader(
        loaders.npcTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
        varProvider,
    );
    const sceneBuilder = new SceneBuilder(cacheInfo, {
        underlayTypeLoader: loaders.underlayTypeLoader,
        overlayTypeLoader: loaders.overlayTypeLoader,
        locTypeLoader: loaders.locTypeLoader,
        textureLoader: loaders.textureLoader,
        locModelLoader,
        varProvider,
    });
    const mapImageRenderer = new MapImageRenderer(
        loaders.textureLoader,
        loaders.locTypeLoader,
        loaders.mapScenes,
        loaders.mapFunctions,
    );

    const wasmBridge = await loadWasmBridge();
    const objSpawns: ObjSpawn[] = [];
    const npcSpawns: NpcSpawn[] = [];

    const tsBackend = new SdMapRenderDataTsBackend({
        session,
        sceneBuilder,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,
        mapImageRenderer,
        varProvider,
        objSpawns,
        npcSpawns,
    });

    const squares = pickSquares(loaders.mapFileLoader.mapFileIndex, args.limit);
    if (squares.length === 0) {
        throw new Error("No map squares found for benchmark");
    }

    const inputs: SdMapLoaderInput[] = squares.map((square) => ({
        mapX: square.mapX,
        mapY: square.mapY,
        maxLevel: 3,
        loadObjs: true,
        loadNpcs: true,
        loadLocs: true,
        smoothTerrain: false,
        minimizeDrawCalls: false,
        loadedTextureIds: new Set<number>(),
    }));

    async function runTs(): Promise<void> {
        for (const input of inputs) {
            const result = await tsBackend.buildMapData(input, {
                includeMinimapBlob: false,
            });
            if (!result) {
                throw new Error(`TS backend returned no data at ${input.mapX},${input.mapY}`);
            }
        }
    }

    async function runCppWasm(): Promise<void> {
        for (const input of inputs) {
            const sceneBuildInput = createByteDrivenSceneBuildInput(input, {
                mapBytesProvider,
                locTypeLoader: loaders.locTypeLoader,
                locModelLoader,
                seqTypeLoader: loaders.seqTypeLoader,
                seqFrameLoader: loaders.seqFrameLoader,
                skeletalSeqLoader: loaders.skeletalSeqLoader,
                textureLoader: loaders.textureLoader,
                underlayTypeLoader: loaders.underlayTypeLoader,
                overlayTypeLoader: loaders.overlayTypeLoader,
                varProvider,
                cacheGame: cacheInfo.game,
                cacheRevision: cacheInfo.revision,
            });
            const request = buildRuntimeRequest(sceneBuildInput);
            const uploaded =
                !!request &&
                (await uploadRuntimeCacheForBuildRequest(
                    wasmBridge as unknown as MapRenderRuntimeBridgeV2,
                    wasmBridge.runtimeHandle,
                    request,
                    sceneBuildInput,
                ));
            const packet =
                uploaded && request
                    ? await wasmBridge.buildMapPacketFromCache(wasmBridge.runtimeHandle, request)
                    : undefined;
            const overlay = runtimePacketToPayloadOverlay(packet);
            // Packets are now deep-copied out of the wasm heap and released before returning.
            void packet;
            if (!overlay) {
                throw new Error(
                    `WASM bridge returned no runtime packet/overlay at ${input.mapX},${input.mapY}`,
                );
            }
        }
    }

    async function runBench(name: string, fn: () => Promise<void>): Promise<void> {
        for (let i = 0; i < args.warmup; i++) {
            await fn();
        }
        const samples: number[] = [];
        for (let i = 0; i < args.iterations; i++) {
            const t0 = performance.now();
            await fn();
            samples.push(performance.now() - t0);
        }
        const total = samples.reduce((acc, v) => acc + v, 0);
        const mean = total / samples.length;
        const perSquare = mean / inputs.length;
        console.log(
            `map-render-backend-bench ${name}: cache=${cacheInfo.name} squares=${
                inputs.length
            } iterations=${samples.length} meanMs=${mean.toFixed(
                1,
            )} meanPerSquareMs=${perSquare.toFixed(1)}`,
        );
    }

    if (args.backend === "ts" || args.backend === "both") {
        await runBench("ts", runTs);
    }
    if (args.backend === "cpp-wasm" || args.backend === "both") {
        await runBench("cpp-wasm", runCppWasm);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
