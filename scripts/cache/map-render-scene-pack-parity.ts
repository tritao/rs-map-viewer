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
}>;

type Square = Readonly<{
    mapX: number;
    mapY: number;
}>;

type DrawBucketKey =
    | "base"
    | "alpha"
    | "lod"
    | "lodAlpha"
    | "interact"
    | "interactAlpha"
    | "interactLod"
    | "interactLodAlpha";

const DRAW_BUCKET_KEYS: readonly DrawBucketKey[] = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
];

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
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
        }
    }
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Invalid --limit");
    }
    return {
        cacheName,
        limit: limit | 0,
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

function fnv1a32UpdateInt(hash: number, value: number): number {
    let h = hash >>> 0;
    const v = value >>> 0;
    h ^= v & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function hashI32Array(data: ArrayLike<number>, hash: number): number {
    let h = hash >>> 0;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateInt(h, data[i] | 0);
    }
    return h >>> 0;
}

function hashDrawRanges(
    ranges: ReadonlyArray<readonly [number, number, number]>,
    hash: number,
): number {
    let h = hash >>> 0;
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        h = fnv1a32UpdateInt(h, r[0] | 0);
        h = fnv1a32UpdateInt(h, r[1] | 0);
        h = fnv1a32UpdateInt(h, r[2] | 0);
    }
    return h >>> 0;
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

type BucketDigest = Readonly<{
    drawCommandCount: number;
    tsDrawRangeCount: number;
    wasmDrawRangeCount: number;
    tsModelInfoLength: number;
    wasmModelInfoLength: number;
    tsDrawRangeHash: number;
    wasmDrawRangeHash: number;
    tsModelInfoHash: number;
    wasmModelInfoHash: number;
}>;

function digestBucket(
    key: DrawBucketKey,
    stagedPayload: MapRenderDataPayload,
    tsPayload: MapRenderDataPayload,
    wasmPayload: MapRenderDataPayload,
): BucketDigest {
    const drawCommandCount = stagedPayload.staging?.drawCommands?.[key].length ?? 0;
    return {
        drawCommandCount,
        tsDrawRangeCount: tsPayload.drawRanges[key].length | 0,
        wasmDrawRangeCount: wasmPayload.drawRanges[key].length | 0,
        tsModelInfoLength: tsPayload.modelInfoTextures[key].length | 0,
        wasmModelInfoLength: wasmPayload.modelInfoTextures[key].length | 0,
        tsDrawRangeHash: hashDrawRanges(tsPayload.drawRanges[key], 2166136261 >>> 0),
        wasmDrawRangeHash: hashDrawRanges(wasmPayload.drawRanges[key], 2166136261 >>> 0),
        tsModelInfoHash: hashI32Array(tsPayload.modelInfoTextures[key], 2166136261 >>> 0),
        wasmModelInfoHash: hashI32Array(wasmPayload.modelInfoTextures[key], 2166136261 >>> 0),
    };
}

function coreDigest(payload: MapRenderDataPayload): Record<string, number> {
    return {
        verticesLength: payload.vertices.length | 0,
        indicesLength: payload.indices.length | 0,
        verticesHash: hashI32Array(payload.vertices, 2166136261 >>> 0),
        indicesHash: hashI32Array(payload.indices, 2166136261 >>> 0),
        heightMapLength: payload.heightMapTextureData.length | 0,
        heightMapHash: hashI32Array(payload.heightMapTextureData, 2166136261 >>> 0),
    };
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
        throw new Error("No map squares found for scene-pack parity");
    }

    let mismatches = 0;
    for (const square of squares) {
        const input: SdMapLoaderInput = {
            mapX: square.mapX,
            mapY: square.mapY,
            maxLevel: 3,
            loadObjs: true,
            loadNpcs: true,
            loadLocs: true,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Set<number>(),
        };

        const tsPayloadResult = await tsBackend.buildMapDataPayload(input, {
            includeStagingSceneHeights: false,
            includeMinimapBlob: false,
        });
        const stagedPayloadResult = await tsBackend.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
            includeStagingDrawCommands: true,
            preferWasmPacking: true,
            includeMinimapBlob: false,
        });

        if (!tsPayloadResult.data || !stagedPayloadResult.data) {
            mismatches++;
            console.error(`payload presence mismatch at ${square.mapX},${square.mapY}`);
            continue;
        }

        const wasmPayloadResult = await wasmBridge.buildMapData(input, stagedPayloadResult);
        if (!wasmPayloadResult?.data) {
            mismatches++;
            console.error(`wasm bridge returned empty payload at ${square.mapX},${square.mapY}`);
            continue;
        }
        if (wasmPayloadResult.data.staging !== undefined) {
            mismatches++;
            console.error(`staging not cleared by wasm at ${square.mapX},${square.mapY}`);
            continue;
        }

        const tsPayload = tsPayloadResult.data;
        const stagedPayload = stagedPayloadResult.data;
        const wasmPayload = wasmPayloadResult.data;

        const tsCore = coreDigest(tsPayload);
        const wasmCore = coreDigest(wasmPayload);
        if (JSON.stringify(tsCore) !== JSON.stringify(wasmCore)) {
            mismatches++;
            console.error(`core mismatch at ${square.mapX},${square.mapY}`);
            console.error(`  ts=${JSON.stringify(tsCore)}`);
            console.error(`  wasm=${JSON.stringify(wasmCore)}`);
        }

        for (const key of DRAW_BUCKET_KEYS) {
            const tsDigest = digestBucket(key, stagedPayload, tsPayload, tsPayload);
            const wasmDigest = digestBucket(key, stagedPayload, tsPayload, wasmPayload);
            if (JSON.stringify(tsDigest) !== JSON.stringify(wasmDigest)) {
                mismatches++;
                console.error(`bucket mismatch at ${square.mapX},${square.mapY} key=${key}`);
                console.error(`  ts=${JSON.stringify(tsDigest)}`);
                console.error(`  wasm=${JSON.stringify(wasmDigest)}`);
            }
        }
    }

    console.log(
        `map-render-scene-pack-parity: cache=${cacheInfo.name} squares=${squares.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
