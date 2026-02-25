import path from "path";
import { pathToFileURL } from "url";

import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { tryCreateCacheSession } from "../../src/rs/runtime/createCacheSession";
import { Scene } from "../../src/rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { LocModelLoader } from "../../src/rs/scene/model/LocModelLoader";
import type {
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeCreateConfig,
    MapRenderRuntimeDebugBridgeV2,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import { importMapRenderDebugBridgeModule } from "../../src/wasm/loadMapRenderBridgeModule";
import {
    createMapRenderRuntimeUploadScratchState,
    uploadRuntimeCacheForBuildRequestWithBridge,
} from "../../src/worker/MapRenderDataBackend";
import { buildSceneFromMapBytesProvider } from "../../src/rs/scene/buildSceneFromMapBytesProvider";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    border: number;
}>;

type Square = Readonly<{
    mapX: number;
    mapY: number;
}>;

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let limit = 8;
    let border = 6;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
        } else if (arg === "--border") {
            border = Number(argv[++i]);
        }
    }
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Invalid --limit");
    }
    if (!Number.isFinite(border) || border < 0) {
        throw new Error("Invalid --border");
    }
    return {
        cacheName,
        limit: limit | 0,
        border: border | 0,
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

function firstFlagMismatch(a: Int32Array, b: Int32Array): number {
    if (a.length !== b.length) {
        return 0;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return i;
        }
    }
    return -1;
}

function getSceneBridgeUrl(): string {
    return pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_runtime.mjs"),
    ).href;
}

async function ensureSceneBridgeAvailable(bridgeUrl: string): Promise<void> {
    const mod = (await import(bridgeUrl)) as Record<string, unknown>;
    const bridge = mod.mapRenderRuntimeDebugBridge as Partial<MapRenderRuntimeDebugBridgeV2> | undefined;
    if (
        !bridge ||
        typeof bridge.initRuntime !== "function" ||
        typeof bridge.createRuntimeWithConfig !== "function" ||
        typeof bridge.cacheSetBuildConfig !== "function" ||
        typeof bridge.cachePutMapSquaresPacked !== "function" ||
        typeof bridge.cachePutTypeEntry !== "function" ||
        typeof bridge.cacheSetVarps !== "function" ||
        typeof bridge.buildMapPacketFromCache !== "function" ||
        typeof bridge.debugGetRuntimeLastCollisionFlags !== "function"
    ) {
        throw new Error("Failed to load map-render runtime wasm bridge");
    }
}

function buildRuntimeRequestFromSceneInput(
    cacheInfo: CacheInfo,
    mapX: number,
    mapY: number,
    borderSize: number,
    sizeX: number,
    sizeY: number,
    smoothTerrain: boolean,
    locLoadType: LocLoadType,
): MapRenderRuntimeBuildRequest {
    return {
        mapX,
        mapY,
        borderSize,
        sizeX,
        sizeY,
        cacheGame: cacheInfo.game,
        cacheRevision: cacheInfo.revision,
        unitsTileHeightBasis: Scene.UNITS_TILE_HEIGHT_BASIS,
        smoothTerrain,
        locLoadType,
        minimizeDrawCalls: false,
        loadLocs: true,
        loadObjs: false,
        loadNpcs: false,
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const bridgeUrl = getSceneBridgeUrl();
    await ensureSceneBridgeAvailable(bridgeUrl);

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
    const sceneBuilder = new SceneBuilder(cacheInfo, {
        underlayTypeLoader: loaders.underlayTypeLoader,
        overlayTypeLoader: loaders.overlayTypeLoader,
        locTypeLoader: loaders.locTypeLoader,
        textureLoader: loaders.textureLoader,
        locModelLoader,
        varProvider,
    });
    const deps = {
        sceneBuilder,
        mapBytesProvider,
    } as const;

    const wasmBridgeMod = await importMapRenderDebugBridgeModule(bridgeUrl);
    const wasmBridge = wasmBridgeMod.mapRenderRuntimeDebugBridge as MapRenderRuntimeDebugBridgeV2;
    const ok = await wasmBridge.initRuntime();
    if (!ok) {
        throw new Error("Failed to init runtime cache-v2 wasm bridge");
    }
    const runtimeConfig: MapRenderRuntimeCreateConfig = {
        cacheGame: cacheInfo.game,
        cacheRevision: cacheInfo.revision,
        sceneLevels: Scene.MAX_LEVELS,
        unitsTileHeightBasis: Scene.UNITS_TILE_HEIGHT_BASIS,
    };
    const runtimeHandle = await wasmBridge.createRuntimeWithConfig(runtimeConfig);
    if (runtimeHandle === undefined) {
        throw new Error("Failed to create runtime handle");
    }
    const uploadScratch = createMapRenderRuntimeUploadScratchState();

    const squares = pickSquares(loaders.mapFileLoader.mapFileIndex, args.limit);
    if (squares.length === 0) {
        throw new Error("No map squares found for scene collision parity");
    }

    const mapSize = Scene.MAP_SQUARE_SIZE + args.border * 2;
    let mismatches = 0;
    for (const square of squares) {
        const baseX = square.mapX * Scene.MAP_SQUARE_SIZE - args.border;
        const baseY = square.mapY * Scene.MAP_SQUARE_SIZE - args.border;
        const smoothTerrain = false;
        const locLoadType = LocLoadType.NO_MODELS;
        const tsScene = await buildSceneFromMapBytesProvider(
            sceneBuilder,
            mapBytesProvider,
            baseX,
            baseY,
            mapSize,
            mapSize,
            smoothTerrain,
            locLoadType,
        );

        const sceneBuildInput: any = {
            mapX: square.mapX | 0,
            mapY: square.mapY | 0,
            maxLevel: Scene.MAX_LEVELS - 1,
            loadLocs: true,
            loadObjs: false,
            loadNpcs: false,
            baseX,
            baseY,
            sizeX: mapSize,
            sizeY: mapSize,
            smoothTerrain,
            minimizeDrawCalls: false,
            locLoadType: locLoadType as number,
            cacheGame: cacheInfo.game,
            cacheRevision: cacheInfo.revision,
            unitsTileHeightBasis: Scene.UNITS_TILE_HEIGHT_BASIS,
            mapBytesProvider,
            locTypeLoader: loaders.locTypeLoader,
            objTypeLoader: loaders.objTypeLoader,
            locModelLoader,
            npcTypeLoader: loaders.npcTypeLoader,
            basTypeLoader: loaders.basTypeLoader,
            underlayTypeLoader: loaders.underlayTypeLoader,
            overlayTypeLoader: loaders.overlayTypeLoader,
            varProvider,
            varpValues: (session.varManager?.values instanceof Int32Array)
                ? new Int32Array(session.varManager.values)
                : new Int32Array(0),
        };
        const request = buildRuntimeRequestFromSceneInput(
            cacheInfo,
            square.mapX,
            square.mapY,
            args.border,
            mapSize,
            mapSize,
            smoothTerrain,
            locLoadType,
        );
        if (
            !(await uploadRuntimeCacheForBuildRequestWithBridge(
                wasmBridge as unknown as MapRenderRuntimeBridgeV2,
                runtimeHandle,
                request,
                sceneBuildInput,
                uploadScratch,
            ))
        ) {
            throw new Error("Failed to upload runtime cache inputs for collision parity");
        }
        const packet = await wasmBridge.buildMapPacketFromCache(runtimeHandle, request);
        wasmBridge.releasePacket?.(packet);

        const getCollision = wasmBridge.debugGetRuntimeLastCollisionFlags;
        if (typeof getCollision !== "function") {
            throw new Error("Missing debugGetRuntimeLastCollisionFlags bridge method");
        }
        const cppCollision = await getCollision(runtimeHandle);
        if (!cppCollision || !(cppCollision.flags instanceof Int32Array)) {
            throw new Error("Missing collision flags from runtime");
        }
        if ((cppCollision.sizeX | 0) !== mapSize || (cppCollision.sizeY | 0) !== mapSize) {
            throw new Error(
                `Runtime collision size mismatch got=${cppCollision.sizeX}x${cppCollision.sizeY} expected=${mapSize}x${mapSize}`,
            );
        }

        for (let level = 0; level < Scene.MAX_LEVELS; level++) {
            const cppLevelOff = level * mapSize * mapSize;
            const cppFlags = cppCollision.flags.subarray(
                cppLevelOff,
                cppLevelOff + mapSize * mapSize,
            );
            const mismatchIdx = firstFlagMismatch(
                tsScene.collisionMaps[level].flags,
                cppFlags,
            );
            if (mismatchIdx >= 0) {
                mismatches++;
                const x = mismatchIdx % mapSize;
                const y = (mismatchIdx / mapSize) | 0;
                const tsFlag = tsScene.collisionMaps[level].flags[mismatchIdx] | 0;
                const cppFlag = cppFlags[mismatchIdx] | 0;
                console.error(
                    `collision mismatch square=${square.mapX},${square.mapY} level=${level} tile=${x},${y} ts=${tsFlag} cpp=${cppFlag}`,
                );
                break;
            }
        }
    }

    console.log(
        `scene-collision-parity: cache=${cacheInfo.name} squares=${squares.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
