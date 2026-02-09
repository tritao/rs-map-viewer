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
import type { AnimationFrames } from "../../src/renderer/AnimationFrames";
import type { LocAnimatedData } from "../../src/renderer/loc/LocAnimatedData";
import type { NpcData } from "../../src/renderer/npc/NpcData";
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
    let h = hash;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateInt(h, data[i] | 0);
    }
    return h >>> 0;
}

function hashDrawRanges(
    ranges: ReadonlyArray<readonly [number, number, number]>,
    hash: number,
): number {
    let h = hash;
    for (const range of ranges) {
        h = fnv1a32UpdateInt(h, range[0] | 0);
        h = fnv1a32UpdateInt(h, range[1] | 0);
        h = fnv1a32UpdateInt(h, range[2] | 0);
    }
    return h >>> 0;
}

function hashAnimationFrames(anim: AnimationFrames | undefined, hash: number): number {
    let h = fnv1a32UpdateInt(hash, anim ? 1 : 0);
    if (!anim) {
        return h;
    }
    h = hashDrawRanges(anim.frames, h);
    h = fnv1a32UpdateInt(h, anim.framesAlpha ? 1 : 0);
    if (anim.framesAlpha) {
        h = hashDrawRanges(anim.framesAlpha, h);
    }
    return h >>> 0;
}

function hashLocsAnimated(locs: LocAnimatedData[], hash: number): number {
    let h = fnv1a32UpdateInt(hash, locs.length);
    for (const loc of locs) {
        h = fnv1a32UpdateInt(h, loc.drawRangeIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeAlphaIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeLodIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeLodAlphaIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeInteractIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeInteractAlphaIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeInteractLodIndex | 0);
        h = fnv1a32UpdateInt(h, loc.drawRangeInteractLodAlphaIndex | 0);
        h = fnv1a32UpdateInt(h, loc.seqId | 0);
        h = fnv1a32UpdateInt(h, loc.randomStart ? 1 : 0);
        h = hashAnimationFrames(loc.anim, h);
    }
    return h >>> 0;
}

function hashNpcs(npcs: NpcData[], hash: number): number {
    let h = fnv1a32UpdateInt(hash, npcs.length);
    for (const npc of npcs) {
        h = fnv1a32UpdateInt(h, npc.id | 0);
        h = fnv1a32UpdateInt(h, npc.tileX | 0);
        h = fnv1a32UpdateInt(h, npc.tileY | 0);
        h = fnv1a32UpdateInt(h, npc.level | 0);
        h = hashAnimationFrames(npc.idleAnim, h);
        h = hashAnimationFrames(npc.walkAnim, h);
    }
    return h >>> 0;
}

function digestPayload(data: MapRenderDataPayload): Record<string, number> {
    let hMeta = 2166136261 >>> 0;
    hMeta = fnv1a32UpdateInt(hMeta, data.mapX | 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.mapY | 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.maxLevel | 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.loadObjs ? 1 : 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.loadNpcs ? 1 : 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.loadLocs ? 1 : 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.smoothTerrain ? 1 : 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.borderSize | 0);
    hMeta = fnv1a32UpdateInt(hMeta, data.minimapBlob.size | 0);

    let hTileFlags = 2166136261 >>> 0;
    hTileFlags = fnv1a32UpdateInt(hTileFlags, data.tileRenderFlags.length | 0);
    for (const level of data.tileRenderFlags) {
        hTileFlags = fnv1a32UpdateInt(hTileFlags, level.length | 0);
        for (const col of level) {
            hTileFlags = hashI32Array(col, hTileFlags);
        }
    }

    let hCollision = 2166136261 >>> 0;
    hCollision = fnv1a32UpdateInt(hCollision, data.collisionDatas.length | 0);
    for (const collision of data.collisionDatas) {
        hCollision = fnv1a32UpdateInt(hCollision, collision.sizeX | 0);
        hCollision = fnv1a32UpdateInt(hCollision, collision.sizeY | 0);
        hCollision = hashI32Array(collision.flags, hCollision);
    }

    let hDrawRanges = 2166136261 >>> 0;
    hDrawRanges = hashDrawRanges(data.drawRanges.base, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.alpha, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.lod, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.lodAlpha, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.interact, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.interactAlpha, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.interactLod, hDrawRanges);
    hDrawRanges = hashDrawRanges(data.drawRanges.interactLodAlpha, hDrawRanges);

    let hModelInfo = 2166136261 >>> 0;
    hModelInfo = hashI32Array(data.modelInfoTextures.base, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.alpha, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.lod, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.lodAlpha, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.interact, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.interactAlpha, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.interactLod, hModelInfo);
    hModelInfo = hashI32Array(data.modelInfoTextures.interactLodAlpha, hModelInfo);

    let hTextures = 2166136261 >>> 0;
    hTextures = hashI32Array(data.usedTextureIds, hTextures);
    const loadedTextures = [...data.loadedTextures].sort((a, b) => a[0] - b[0]);
    for (const [id, pixels] of loadedTextures) {
        hTextures = fnv1a32UpdateInt(hTextures, id | 0);
        hTextures = hashI32Array(pixels, hTextures);
    }

    return {
        meta: hMeta,
        tileFlags: hTileFlags,
        collision: hCollision,
        vertices: hashI32Array(data.vertices, 2166136261 >>> 0),
        indices: hashI32Array(data.indices, 2166136261 >>> 0),
        modelInfo: hModelInfo,
        heightMap: hashI32Array(data.heightMapTextureData, 2166136261 >>> 0),
        drawRanges: hDrawRanges,
        locsAnimated: hashLocsAnimated(data.locsAnimated, 2166136261 >>> 0),
        npcs: hashNpcs(data.npcs, 2166136261 >>> 0),
        textures: hTextures,
    };
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
        throw new Error("No map squares found for parity");
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

        const tsResult = await tsBackend.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
            includeMinimapBlob: false,
        });
        const tsWasmNpcResult = await tsWithWasmNpcBackend.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
            includeStagingDrawCommands: true,
            preferWasmPacking: true,
            includeMinimapBlob: false,
        });

        if (!tsResult.data || !tsWasmNpcResult.data) {
            if (tsResult.data !== tsWasmNpcResult.data) {
                mismatches++;
                console.error(`payload presence mismatch at ${square.mapX},${square.mapY}`);
            }
            continue;
        }

        const wasmResult = await wasmBridge.buildMapData(input, tsWasmNpcResult);
        if (!wasmResult?.data) {
            mismatches++;
            console.error(`wasm bridge returned empty payload at ${square.mapX},${square.mapY}`);
            continue;
        }
        if (wasmResult.data.staging !== undefined) {
            mismatches++;
            console.error(`wasm heightmap stage did not clear staging at ${square.mapX},${square.mapY}`);
            continue;
        }

        const expected = {
            ...tsResult.data,
            staging: undefined,
        };
        const expectedDigest = digestPayload(expected);
        const actualDigest = digestPayload(wasmResult.data);

        const mismatchKeys = Object.keys(expectedDigest).filter(
            (k) => expectedDigest[k] !== actualDigest[k],
        );
        if (mismatchKeys.length > 0) {
            mismatches++;
            console.error(
                `payload mismatch at ${square.mapX},${square.mapY} keys=${mismatchKeys.join(",")}`,
            );
            for (const key of mismatchKeys) {
                console.error(
                    `  ${key}: ts=${expectedDigest[key]} wasm=${actualDigest[key]}`,
                );
            }
        }
    }

    console.log(
        `map-render-backend-parity: cache=${cacheInfo.name} squares=${squares.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
