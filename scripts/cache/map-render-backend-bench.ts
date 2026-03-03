import path from "path";
import { pathToFileURL } from "url";

import type { ObjSpawn } from "../../src/data/obj/ObjSpawn";
import type { SdMapLoaderInput } from "../../src/maprender/MapRenderPayload";
import { MapRenderTsBackend } from "../../src/maprender/ts/MapRenderTsBackend";
import {
    WasmCacheUploader,
    createByteDrivenSceneBuildInput,
    createSceneBuildCacheProvider,
} from "../../src/maprender/wasm/WasmCacheUploader";
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
    MapRenderRuntimePacket,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import { runtimePacketToPayloadOverlay } from "./runtimePacketOverlay";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    square?: Square;
    limit: number;
    warmup: number;
    iterations: number;
    backend: "ts" | "cpp-wasm" | "both";
    loadLocs: boolean;
    loadObjs: boolean;
    loadNpcs: boolean;
    stages: boolean;
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

type CppPreparedInput = Readonly<{
    input: SdMapLoaderInput;
    sceneBuildInput: ReturnType<typeof createByteDrivenSceneBuildInput>;
    request: MapRenderRuntimeBuildRequest;
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
    let square: Square | undefined;
    let limit = 4;
    let warmup = 1;
    let iterations = 3;
    let backend: "ts" | "cpp-wasm" | "both" = "both";
    let loadLocs = true;
    let loadObjs = true;
    // Default off in Node bench mode to avoid fallback fetch-path variance/noise.
    let loadNpcs = false;
    let stages = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--square") {
            const value = argv[++i];
            const match = /^(\d+):(\d+)$/.exec(value ?? "");
            if (!match) {
                throw new Error("Invalid --square (expected mapX:mapY)");
            }
            square = {
                mapX: Number(match[1]) | 0,
                mapY: Number(match[2]) | 0,
            };
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
        } else if (arg === "--loadNpcs") {
            loadNpcs = true;
        } else if (arg === "--no-loadNpcs") {
            loadNpcs = false;
        } else if (arg === "--loadObjs") {
            loadObjs = true;
        } else if (arg === "--no-loadObjs") {
            loadObjs = false;
        } else if (arg === "--loadLocs") {
            loadLocs = true;
        } else if (arg === "--no-loadLocs") {
            loadLocs = false;
        } else if (arg === "--stages") {
            stages = true;
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
        square,
        limit: limit | 0,
        warmup: warmup | 0,
        iterations: iterations | 0,
        backend,
        loadLocs,
        loadObjs,
        loadNpcs,
        stages,
    };
}

function addStageSample(samplesByStage: Map<string, number[]>, stage: string, valueMs: number): void {
    const v = Number(valueMs);
    if (!Number.isFinite(v) || v < 0) {
        return;
    }
    const list = samplesByStage.get(stage);
    if (list) {
        list.push(v);
        return;
    }
    samplesByStage.set(stage, [v]);
}

function printStageSummary(name: string, samplesByStage: Map<string, number[]>): void {
    if (samplesByStage.size <= 0) {
        return;
    }
    const rows = Array.from(samplesByStage.entries()).map(([stage, samples]) => {
        const total = samples.reduce((acc, x) => acc + x, 0);
        const mean = total / samples.length;
        return {
            stage,
            samples: samples.length | 0,
            mean,
        };
    });
    rows.sort((a, b) => b.mean - a.mean);
    console.log(`map-render-backend-bench ${name} stageMeanMs:`);
    for (const row of rows) {
        console.log(
            `  ${row.stage}=${row.mean.toFixed(1)}ms samples=${row.samples}`,
        );
    }
}

function addCppInternalStageSamples(
    samplesByStage: Map<string, number[]>,
    timings:
        | Readonly<{
              totalUs: number;
              collectMapInputUs: number;
              seedHashUs: number;
              buildCommandStreamUs: number;
              registerTickStateUs: number;
              planPayloadUs: number;
              buildPayloadUs: number;
              storePayloadUs: number;
              buildNpcUs: number;
              deriveUsedTextureIdsUs: number;
              finalizePayloadUs: number;
              commandPrepareInputUs: number;
              commandCoreBuildUs: number;
              commandValidateUs: number;
              commandCopyBuffersUs: number;
              commandCopyDebugUs: number;
              commandSetupUs: number;
              commandSceneBuildUs: number;
              commandTerrainUs: number;
              commandLocUs: number;
              commandObjUs: number;
              commandFinalizeUs: number;
              commandLocPlanUs: number;
              commandLocPlanSortUs: number;
              commandLocPlanMergeNormalsUs: number;
              commandLocPlanPlacementLoopUs: number;
              commandLocPlanRenderPlanUs: number;
              commandLocPlanAnimatedOrderUs: number;
              commandLocExecuteUs: number;
              commandLocExecuteInstancedUs: number;
              commandLocExecuteMergedUs: number;
              commandFinalizeAnimatedLocUs: number;
          }>
        | undefined,
): void {
    if (!timings) {
        return;
    }
    addStageSample(samplesByStage, "cppCore.total", (timings.totalUs | 0) / 1000);
    addStageSample(
        samplesByStage,
        "cppCore.collectMapInput",
        (timings.collectMapInputUs | 0) / 1000,
    );
    addStageSample(samplesByStage, "cppCore.seedHash", (timings.seedHashUs | 0) / 1000);
    addStageSample(
        samplesByStage,
        "cppCore.buildCommandStream",
        (timings.buildCommandStreamUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.registerTickState",
        (timings.registerTickStateUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.planPayload",
        (timings.planPayloadUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.buildPayload",
        (timings.buildPayloadUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.storePayload",
        (timings.storePayloadUs | 0) / 1000,
    );
    addStageSample(samplesByStage, "cppCore.buildNpc", (timings.buildNpcUs | 0) / 1000);
    addStageSample(
        samplesByStage,
        "cppCore.deriveUsedTextureIds",
        (timings.deriveUsedTextureIdsUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.finalizePayload",
        (timings.finalizePayloadUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.prepareInput",
        (timings.commandPrepareInputUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.coreBuild",
        (timings.commandCoreBuildUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.validate",
        (timings.commandValidateUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.copyBuffers",
        (timings.commandCopyBuffersUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.copyDebug",
        (timings.commandCopyDebugUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.setup",
        (timings.commandSetupUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.sceneBuild",
        (timings.commandSceneBuildUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.terrain",
        (timings.commandTerrainUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc",
        (timings.commandLocUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.obj",
        (timings.commandObjUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.finalize",
        (timings.commandFinalizeUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.plan",
        (timings.commandLocPlanUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.plan.sortPlacements",
        (timings.commandLocPlanSortUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.plan.mergeNormals",
        (timings.commandLocPlanMergeNormalsUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.plan.placementLoop",
        (timings.commandLocPlanPlacementLoopUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.plan.renderPlan",
        (timings.commandLocPlanRenderPlanUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.plan.animatedOrder",
        (timings.commandLocPlanAnimatedOrderUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.execute",
        (timings.commandLocExecuteUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.execute.instanced",
        (timings.commandLocExecuteInstancedUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.loc.execute.merged",
        (timings.commandLocExecuteMergedUs | 0) / 1000,
    );
    addStageSample(
        samplesByStage,
        "cppCore.command.finalize.animatedLoc",
        (timings.commandFinalizeAnimatedLocUs | 0) / 1000,
    );
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

function validateSquare(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    square: Square,
): void {
    if (mapFileIndex.tryGetTerrainArchiveId(square.mapX, square.mapY) === undefined) {
        throw new Error(`Square ${square.mapX}:${square.mapY} has no terrain archive`);
    }
    if (mapFileIndex.tryGetLocArchiveId(square.mapX, square.mapY) === undefined) {
        throw new Error(`Square ${square.mapX}:${square.mapY} has no loc archive`);
    }
}

function pickSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    preferredSquare: Square | undefined,
    limit: number,
): Square[] {
    if (preferredSquare) {
        validateSquare(mapFileIndex, preferredSquare);
        return [preferredSquare];
    }
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
        path.resolve(process.cwd(), "src/wasm/rs_map_runtime_bridge.mjs"),
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

    const tsBackend = new MapRenderTsBackend({
        session,
        sceneBuilder,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,
        mapImageRenderer,
        varProvider,
        objSpawns,
    });
    const cacheUploader = new WasmCacheUploader();
    const cacheProvider = createSceneBuildCacheProvider({
        mapBytesProvider,
        locTypeLoader: loaders.locTypeLoader,
        objTypeLoader: loaders.objTypeLoader,
        modelLoader: loaders.modelLoader,
        seqTypeLoader: loaders.seqTypeLoader,
        seqFrameLoader: loaders.seqFrameLoader,
        skeletalSeqLoader: loaders.skeletalSeqLoader,
        npcTypeLoader: loaders.npcTypeLoader,
        basTypeLoader: loaders.basTypeLoader,
        underlayTypeLoader: loaders.underlayTypeLoader,
        overlayTypeLoader: loaders.overlayTypeLoader,
        varbitLoader: session.varManager.varbitLoader,
    });
    const allTextureIds = loaders.textureLoader.getTextureIds();
    const textureIdLists = {
        sdTextureIds: allTextureIds.filter((id) => loaders.textureLoader.isSd(id | 0)),
        transparentTextureIds: allTextureIds.filter((id) =>
            loaders.textureLoader.isTransparent(id | 0),
        ),
    };
    const tsStageSamples = new Map<string, number[]>();
    const cppStageSamples = new Map<string, number[]>();

    const squares = pickSquares(loaders.mapFileLoader.mapFileIndex, args.square, args.limit);
    if (squares.length === 0) {
        throw new Error("No map squares found for benchmark");
    }

    const inputs: SdMapLoaderInput[] = squares.map((square) => ({
        mapX: square.mapX,
        mapY: square.mapY,
        maxLevel: 3,
        loadObjs: args.loadObjs,
        loadNpcs: args.loadNpcs,
        loadLocs: args.loadLocs,
        smoothTerrain: false,
        minimizeDrawCalls: false,
        loadedTextureIds: new Int32Array(0),
    }));

    async function runTs(collectStages: boolean): Promise<number> {
        let measuredTotalMs = 0;
        for (const input of inputs) {
            const tTotal = performance.now();
            const bridgeInput = await tsBackend.buildMapDataBridgeInput(input, {
                includeMinimapBlob: false,
                debugIncludeStageProfile: args.stages && collectStages,
            });
            if (!bridgeInput.data) {
                throw new Error(`TS backend returned no data at ${input.mapX},${input.mapY}`);
            }
            if (args.stages && collectStages) {
                const profile = bridgeInput.debugStageProfile;
                if (profile) {
                    for (const [stage, ms] of Object.entries(profile)) {
                        addStageSample(tsStageSamples, stage, ms);
                    }
                }
                const totalMs =
                    bridgeInput.debugTotalMs ?? (performance.now() - tTotal);
                addStageSample(tsStageSamples, "TOTAL", totalMs);
            }
            measuredTotalMs += performance.now() - tTotal;
        }
        return measuredTotalMs;
    }

    const runtimeHandlesToDestroy = new Set<number>();
    runtimeHandlesToDestroy.add(wasmBridge.runtimeHandle | 0);
    let defaultRuntimeClaimed = false;

    async function allocateRuntimeHandle(
        sceneBuildInput: ReturnType<typeof createByteDrivenSceneBuildInput>,
    ): Promise<number> {
        if (!defaultRuntimeClaimed) {
            defaultRuntimeClaimed = true;
            return wasmBridge.runtimeHandle | 0;
        }
        const createConfig: MapRenderRuntimeCreateConfig = {
            cacheGame: (sceneBuildInput.cacheGame as number) | 0,
            cacheRevision: (sceneBuildInput.cacheRevision as number) | 0,
            sceneLevels: ((sceneBuildInput.maxLevel as number) | 0) + 1,
            unitsTileHeightBasis: (sceneBuildInput.unitsTileHeightBasis as number) | 0,
        };
        const runtimeHandle =
            typeof wasmBridge.createRuntimeWithConfig === "function"
                ? await wasmBridge.createRuntimeWithConfig(createConfig)
                : typeof wasmBridge.createRuntime === "function"
                ? await wasmBridge.createRuntime()
                : undefined;
        if (runtimeHandle === undefined) {
            throw new Error("Failed to allocate cpp-wasm runtime handle for benchmark");
        }
        runtimeHandlesToDestroy.add(runtimeHandle | 0);
        return runtimeHandle | 0;
    }

    async function primeCppRuntimeInput(prepared: CppPreparedInput): Promise<void> {
        const preparedResult = await cacheUploader.prepareAndBuildMapPacketFromCacheDetailed(
            wasmBridge as unknown as MapRenderRuntimeBridgeV2,
            prepared.runtimeHandle,
            prepared.request,
            prepared.sceneBuildInput,
        );
        if (!preparedResult.ok) {
            throw new Error(
                `Failed to prepare runtime cache at ${prepared.input.mapX},${prepared.input.mapY} reason=${preparedResult.reason}`,
            );
        }
    }

    async function prepareCppInputs(): Promise<ReadonlyArray<CppPreparedInput>> {
        const out: CppPreparedInput[] = [];
        for (const input of inputs) {
            const sceneBuildInput = createByteDrivenSceneBuildInput(input, {
                cacheGame: cacheInfo.game,
                cacheRevision: cacheInfo.revision,
                cacheProvider,
                textureIdLists,
                varpValues: new Int32Array(varProvider.varManager.values),
            });
            const request = buildRuntimeRequest(sceneBuildInput);
            if (!request) {
                throw new Error(`Failed to build runtime request at ${input.mapX},${input.mapY}`);
            }
            const runtimeHandle = await allocateRuntimeHandle(sceneBuildInput);
            out.push({
                input,
                sceneBuildInput,
                request,
                runtimeHandle,
            });
        }
        return out;
    }

    let preparedCppInputs: ReadonlyArray<CppPreparedInput> = [];

    async function runCppWasm(collectStages: boolean): Promise<number> {
        let measuredTotalMs = 0;
        for (const prepared of preparedCppInputs) {
            // Prime the runtime state (base upload + missing blob backfill) outside
            // timed stage attribution so measured build stages reflect steady-state command build.
            await primeCppRuntimeInput(prepared);
            const tTotal = performance.now();
            const tBuildPacket = performance.now();
            const packet = (await wasmBridge.buildMapPacketFromCache(
                prepared.runtimeHandle,
                prepared.request,
            )) as MapRenderRuntimePacket | undefined;
            const buildPacketTotalMs = performance.now() - tBuildPacket;
            const tOverlay = performance.now();
            const overlay = runtimePacketToPayloadOverlay(packet);
            const overlayTotalMs = performance.now() - tOverlay;
            const missing = await wasmBridge.getLastMissingBlobEntries(prepared.runtimeHandle);
            if (missing && (missing.domains.length | 0) > 0) {
                throw new Error(
                    `Unexpected missing blob entries in timed run at ${prepared.input.mapX},${prepared.input.mapY}; rerun preflight`,
                );
            }
            if (!overlay) {
                throw new Error(
                    `WASM bridge returned no runtime packet/overlay at ${prepared.input.mapX},${prepared.input.mapY}`,
                );
            }

            if (args.stages && collectStages) {
                const timings =
                    typeof wasmBridge.debugGetLastBuildStageTimings === "function"
                        ? await wasmBridge.debugGetLastBuildStageTimings(prepared.runtimeHandle)
                        : undefined;
                addCppInternalStageSamples(cppStageSamples, timings);
                addStageSample(cppStageSamples, "buildMapPacketFromCache(total)", buildPacketTotalMs);
                addStageSample(cppStageSamples, "runtimePacketToPayloadOverlay(total)", overlayTotalMs);
                addStageSample(cppStageSamples, "TOTAL", performance.now() - tTotal);
            }
            measuredTotalMs += performance.now() - tTotal;
        }
        return measuredTotalMs;
    }

    async function runBench(
        name: string,
        fn: (collectStages: boolean) => Promise<number>,
    ): Promise<void> {
        for (let i = 0; i < args.warmup; i++) {
            await fn(false);
        }
        const samples: number[] = [];
        for (let i = 0; i < args.iterations; i++) {
            const measuredMs = await fn(true);
            samples.push(measuredMs);
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

    try {
        if (args.backend === "ts" || args.backend === "both") {
            await runBench("ts", runTs);
            if (args.stages) {
                printStageSummary("ts", tsStageSamples);
            }
        }
        if (args.backend === "cpp-wasm" || args.backend === "both") {
            preparedCppInputs = await prepareCppInputs();
            await runBench("cpp-wasm", runCppWasm);
            if (args.stages) {
                printStageSummary("cpp-wasm", cppStageSamples);
            }
        }
    } finally {
        for (const handle of runtimeHandlesToDestroy) {
            try {
                wasmBridge.destroyRuntime(handle | 0);
            } catch {
                // ignore cleanup failures in bench script
            }
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
