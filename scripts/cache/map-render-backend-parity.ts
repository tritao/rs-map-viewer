import path from "path";
import { pathToFileURL } from "url";

import type { NpcSpawn } from "../../src/data/npc/NpcSpawn";
import type { ObjSpawn } from "../../src/data/obj/ObjSpawn";
import type { AnimationFrames } from "../../src/renderer/AnimationFrames";
import { SdMapLoaderInput } from "../../src/renderer/loader/SdMapLoaderInput";
import { SdMapRenderDataTsBackend } from "../../src/renderer/loader/SdMapRenderDataTsBackend";
import type { LocAnimatedData } from "../../src/renderer/loc/LocAnimatedData";
import type { NpcData } from "../../src/renderer/npc/NpcData";
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
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeCreateConfig,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import {
    createByteDrivenSceneBuildInput,
    createMapRenderRuntimeUploadScratchState,
    uploadRuntimeCacheForBuildRequestWithBridge,
} from "../../src/worker/MapRenderDataBackend";
import type {
    MapRenderDataPayload,
    MapRenderRuntimePacket,
} from "../../src/worker/MapRenderDataContract";
import { runtimePacketToPayloadOverlay } from "../../src/worker/MapRenderDataContract";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    detail: boolean;
    squares?: ReadonlyArray<Square>;
}>;

type Square = Readonly<{
    mapX: number;
    mapY: number;
}>;

type RuntimeBridge = MapRenderRuntimeBridgeV2 &
    Readonly<{
        createRuntime?(): Promise<number | undefined>;
    }>;

type WasmBridge = Readonly<{
    runtimeHandle: number;
}> &
    Pick<
        RuntimeBridge,
        | "cacheSetBuildConfig"
        | "cacheClearMapSquares"
        | "cachePutMapSquaresPacked"
        | "cacheClearTypeKind"
        | "cachePutTypeEntry"
        | "collectRequiredExpandedTypeIds"
        | "cacheSetVarps"
        | "buildMapPacketFromCache"
        | "decodeNpcSpawnsFromBytes"
    > &
    Readonly<{
        releasePacket?: (packet: MapRenderRuntimePacket | undefined) => boolean;
        debugGetRuntimeLastBuildStats?: (runtimeHandle: number) => Promise<unknown>;
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
    let detail = false;
    let squares: Square[] | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
        } else if (arg === "--detail") {
            detail = true;
        } else if (arg === "--squares") {
            const raw = argv[++i] ?? "";
            const parsed: Square[] = [];
            const tokens = raw
                .split(/[;,]/)
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
            for (let t = 0; t < tokens.length; t++) {
                const parts = tokens[t].split(":");
                if (parts.length !== 2) {
                    throw new Error("Invalid --squares format; expected mapX:mapY[,mapX:mapY]");
                }
                const mapX = Number(parts[0]);
                const mapY = Number(parts[1]);
                if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
                    throw new Error("Invalid --squares value");
                }
                parsed.push({ mapX: mapX | 0, mapY: mapY | 0 });
            }
            squares = parsed;
        }
    }
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Invalid --limit");
    }
    return {
        cacheName,
        limit: limit | 0,
        detail,
        squares,
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
    let h = hash;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateInt(h, data[i] | 0);
    }
    return h >>> 0;
}

function hashDrawRangeTuples(
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
    h = hashDrawRangeTuples(anim.frames, h);
    h = fnv1a32UpdateInt(h, anim.framesAlpha ? 1 : 0);
    if (anim.framesAlpha) {
        h = hashDrawRangeTuples(anim.framesAlpha, h);
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

function summarizeDrawRangeBuckets(
    data: MapRenderDataPayload,
): Record<string, { cmdCount: number; elementSum: number; instanceSum: number }> {
    const out: Record<string, { cmdCount: number; elementSum: number; instanceSum: number }> = {};
    for (const key of [
        "base",
        "alpha",
        "lod",
        "lodAlpha",
        "interact",
        "interactAlpha",
        "interactLod",
        "interactLodAlpha",
    ] as const) {
        const ranges = data.drawRanges[key];
        const cmdCount = (ranges.length / 3) | 0;
        let elementSum = 0;
        let instanceSum = 0;
        for (let i = 0; i < ranges.length; i += 3) {
            elementSum += ranges[i + 1] | 0;
            instanceSum += ranges[i + 2] | 0;
        }
        out[key] = { cmdCount, elementSum, instanceSum };
    }
    return out;
}

function firstDrawRangeDiff(
    a: Int32Array,
    b: Int32Array,
): { tupleIndex: number; lane: 0 | 1 | 2; ts: number; wasm: number } | undefined {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if ((a[i] | 0) !== (b[i] | 0)) {
            return {
                tupleIndex: (i / 3) | 0,
                lane: (i % 3) as 0 | 1 | 2,
                ts: a[i] | 0,
                wasm: b[i] | 0,
            };
        }
    }
    if (a.length !== b.length) {
        return {
            tupleIndex: (len / 3) | 0,
            lane: (len % 3) as 0 | 1 | 2,
            ts: a.length | 0,
            wasm: b.length | 0,
        };
    }
    return undefined;
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
    hDrawRanges = hashI32Array(data.drawRanges.base, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.alpha, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.lod, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.lodAlpha, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.interact, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.interactAlpha, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.interactLod, hDrawRanges);
    hDrawRanges = hashI32Array(data.drawRanges.interactLodAlpha, hDrawRanges);

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
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_runtime_bridge.mjs"),
    ).href;
    const mod = (await import(bridgeUrl)) as Record<string, unknown>;
    const runtimeCandidate = mod.mapRenderRuntimeBridge as Partial<RuntimeBridge> | undefined;
    if (
        !runtimeCandidate ||
        (typeof runtimeCandidate.createRuntime !== "function" &&
            typeof runtimeCandidate.createRuntimeWithConfig !== "function") ||
        typeof runtimeCandidate.cacheSetBuildConfig !== "function" ||
        typeof runtimeCandidate.cacheClearMapSquares !== "function" ||
        typeof runtimeCandidate.cachePutMapSquaresPacked !== "function" ||
        typeof runtimeCandidate.cacheClearTypeKind !== "function" ||
        typeof runtimeCandidate.cachePutTypeEntry !== "function" ||
        typeof runtimeCandidate.collectRequiredExpandedTypeIds !== "function" ||
        typeof runtimeCandidate.cacheSetVarps !== "function" ||
        typeof runtimeCandidate.buildMapPacketFromCache !== "function" ||
        typeof runtimeCandidate.decodeNpcSpawnsFromBytes !== "function"
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
    return {
        runtimeHandle,
        cacheSetBuildConfig: runtimeCandidate.cacheSetBuildConfig,
        cacheClearMapSquares: runtimeCandidate.cacheClearMapSquares,
        cachePutMapSquaresPacked: runtimeCandidate.cachePutMapSquaresPacked,
        cacheClearTypeKind: runtimeCandidate.cacheClearTypeKind,
        cachePutTypeEntry: runtimeCandidate.cachePutTypeEntry,
        collectRequiredExpandedTypeIds: runtimeCandidate.collectRequiredExpandedTypeIds,
        cacheSetVarps: runtimeCandidate.cacheSetVarps,
        buildMapPacketFromCache: runtimeCandidate.buildMapPacketFromCache,
        releasePacket: runtimeCandidate.releasePacket,
        decodeNpcSpawnsFromBytes: runtimeCandidate.decodeNpcSpawnsFromBytes,
        debugGetRuntimeLastBuildStats: runtimeCandidate.debugGetRuntimeLastBuildStats,
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

    const tsWithWasmNpcBackend = new SdMapRenderDataTsBackend({
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

    const squares =
        args.squares && args.squares.length > 0
            ? [...args.squares]
            : pickSquares(loaders.mapFileLoader.mapFileIndex, args.limit);
    if (squares.length === 0) {
        throw new Error("No map squares found for parity");
    }

    let mismatches = 0;
    const uploadScratchState = createMapRenderRuntimeUploadScratchState();
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
            includeMinimapBlob: false,
        });
        const tsWasmNpcResult = await tsWithWasmNpcBackend.buildMapDataPayload(input, {
            includeMinimapBlob: false,
        });

        if (!tsResult.data || !tsWasmNpcResult.data) {
            if (tsResult.data !== tsWasmNpcResult.data) {
                mismatches++;
                console.error(`payload presence mismatch at ${square.mapX},${square.mapY}`);
            }
            continue;
        }
        const sceneBuildInput = createByteDrivenSceneBuildInput(input, {
            mapBytesProvider,
            locTypeLoader: loaders.locTypeLoader,
            locModelLoader,
            underlayTypeLoader: loaders.underlayTypeLoader,
            overlayTypeLoader: loaders.overlayTypeLoader,
            varProvider,
            cacheGame: cacheInfo.game,
            cacheRevision: cacheInfo.revision,
        });
        const request = buildRuntimeRequest(sceneBuildInput);
        const uploaded =
            !!request &&
            (await uploadRuntimeCacheForBuildRequestWithBridge(
                wasmBridge as unknown as MapRenderRuntimeBridgeV2,
                wasmBridge.runtimeHandle,
                request,
                sceneBuildInput,
                uploadScratchState,
            ));
        const packet =
            uploaded && request
                ? await wasmBridge.buildMapPacketFromCache(wasmBridge.runtimeHandle, request)
                : undefined;
        const overlay = runtimePacketToPayloadOverlay(packet);
        if (typeof wasmBridge.releasePacket === "function") {
            wasmBridge.releasePacket(packet);
        }
        if (!overlay) {
            mismatches++;
            console.error(`wasm bridge returned empty payload at ${square.mapX},${square.mapY}`);
            if (typeof wasmBridge.debugGetRuntimeLastBuildStats === "function") {
                const stats = await wasmBridge.debugGetRuntimeLastBuildStats(
                    wasmBridge.runtimeHandle,
                );
                console.error("  wasm build stats:", stats);
            }
            continue;
        }
        const wasmResult: MapRenderDataPayload = {
            ...tsWasmNpcResult.data,
            heightMapTextureData: overlay.heightMapTextureData,
            drawRanges: overlay.drawRanges,
            modelInfoTextures: overlay.modelInfoTextures,
        };

        const expected = tsResult.data;
        const expectedDigest = digestPayload(expected);
        const actualDigest = digestPayload(wasmResult);

        const mismatchKeys = Object.keys(expectedDigest).filter(
            (k) => expectedDigest[k] !== actualDigest[k],
        );
        if (mismatchKeys.length > 0) {
            mismatches++;
            console.error(
                `payload mismatch at ${square.mapX},${square.mapY} keys=${mismatchKeys.join(",")}`,
            );
            for (const key of mismatchKeys) {
                console.error(`  ${key}: ts=${expectedDigest[key]} wasm=${actualDigest[key]}`);
            }
            if (args.detail) {
                const tsSummary = summarizeDrawRangeBuckets(expected);
                const wasmSummary = summarizeDrawRangeBuckets(wasmResult);
                console.error("  draw-range bucket summary:");
                for (const key of Object.keys(tsSummary)) {
                    const t = tsSummary[key];
                    const w = wasmSummary[key];
                    console.error(
                        `    ${key}: ts(cmd=${t.cmdCount}, elems=${t.elementSum}, inst=${t.instanceSum}) wasm(cmd=${w.cmdCount}, elems=${w.elementSum}, inst=${w.instanceSum})`,
                    );
                    const first = firstDrawRangeDiff(
                        expected.drawRanges[key as keyof typeof expected.drawRanges],
                        wasmResult.drawRanges[key as keyof typeof wasmResult.drawRanges],
                    );
                    if (first) {
                        console.error(
                            `      first diff tuple=${first.tupleIndex} lane=${first.lane} ts=${first.ts} wasm=${first.wasm}`,
                        );
                    }
                }
                console.error("  modelInfo lengths by bucket:");
                for (const key of [
                    "base",
                    "alpha",
                    "lod",
                    "lodAlpha",
                    "interact",
                    "interactAlpha",
                    "interactLod",
                    "interactLodAlpha",
                ] as const) {
                    console.error(
                        `    ${key}: ts=${expected.modelInfoTextures[key].length} wasm=${wasmResult.modelInfoTextures[key].length}`,
                    );
                }
                if (typeof wasmBridge.debugGetRuntimeLastBuildStats === "function") {
                    const stats = await wasmBridge.debugGetRuntimeLastBuildStats(
                        wasmBridge.runtimeHandle,
                    );
                    console.error("  wasm build stats:", stats);
                }
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
