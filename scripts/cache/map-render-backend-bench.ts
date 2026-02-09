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
import { tryCreateCacheSession } from "../../src/rs/runtime/createCacheSession";
import { SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { LocModelLoader } from "../../src/rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../src/rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../src/rs/scene/model/ObjModelLoader";
import type { MapRenderDataPayload } from "../../src/worker/MapRenderDataContract";
import { createSceneBuildBackend } from "../../src/worker/SceneBuildBackend";
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

type WasmBridge = Readonly<{
    buildMapData(
        input: SdMapLoaderInput,
        tsPayloadResult: { data: MapRenderDataPayload | undefined },
    ): Promise<{ data: MapRenderDataPayload | undefined } | undefined>;
    decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1: Uint8Array[],
        borderSize: number,
        mapX: number,
        mapY: number,
        data: Uint8Array,
        npcLoginScreenPropsById?: Uint8Array,
        requiredLoginScreenPropsMask?: number,
    ): Promise<NpcSpawn[] | undefined>;
}>;

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
    mapFileIndex: { tryGetTerrainArchiveId(x: number, y: number): number | undefined; tryGetLocArchiveId(x: number, y: number): number | undefined },
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
        path.resolve(process.cwd(), "public/wasm/rs_map_render_backend_bridge.mjs"),
    ).href;
    const mod = (await import(bridgeUrl)) as Record<string, unknown>;
    const candidate = (mod.cppWasmMapRenderDataBridge ?? mod.default) as WasmBridge | undefined;
    if (!candidate || typeof candidate.buildMapData !== "function") {
        throw new Error("Failed to load wasm map-render bridge");
    }
    return candidate;
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
    const mapBytesProvider = new MapFileBytesProvider(loaders.mapFileLoader, loadedCache.xteas as any);
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
    const sceneBuildBackend = createSceneBuildBackend("ts", {
        sceneBuilder,
        mapBytesProvider,
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
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,
        sceneBuildBackend,
        mapImageRenderer,
        varProvider,
        objSpawns,
        npcSpawns,
    });

    const tsWithWasmNpcBackend = new SdMapRenderDataTsBackend({
        session,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,
        sceneBuildBackend,
        mapImageRenderer,
        varProvider,
        objSpawns,
        npcSpawns,
        npcSpawnDecodeBackend: {
            name: "cpp-wasm",
            filtersLoginScreenProps: true,
            decodeNpcSpawnsFromBytes: (
                tileRenderFlagsLevel1,
                borderSize,
                mapX,
                mapY,
                data,
                npcLoginScreenPropsById,
                requiredLoginScreenPropsMask,
            ) =>
                wasmBridge.decodeNpcSpawnsFromBytes(
                    tileRenderFlagsLevel1,
                    borderSize,
                    mapX,
                    mapY,
                    data,
                    npcLoginScreenPropsById,
                    requiredLoginScreenPropsMask,
                ),
        },
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
            const result = await tsBackend.buildMapDataPayload(input, {
                includeStagingSceneHeights: false,
                includeMinimapBlob: false,
            });
            if (!result.data) {
                throw new Error(`TS backend returned no payload at ${input.mapX},${input.mapY}`);
            }
        }
    }

    async function runCppWasm(): Promise<void> {
        for (const input of inputs) {
            const tsResult = await tsWithWasmNpcBackend.buildMapDataPayload(input, {
                includeStagingSceneHeights: true,
                includeMinimapBlob: false,
            });
            if (!tsResult.data) {
                throw new Error(
                    `TS wasm-staged backend returned no payload at ${input.mapX},${input.mapY}`,
                );
            }
            const result = await wasmBridge.buildMapData(input, tsResult);
            if (!result?.data) {
                throw new Error(`WASM bridge returned no payload at ${input.mapX},${input.mapY}`);
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
            `map-render-backend-bench ${name}: cache=${cacheInfo.name} squares=${inputs.length} iterations=${samples.length} meanMs=${mean.toFixed(
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
