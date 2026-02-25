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
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import {
    createByteDrivenSceneBuildInput,
    createMapRenderRuntimeUploadScratchState,
    uploadRuntimeCacheForBuildRequestWithBridge,
} from "../../src/worker/MapRenderDataBackend";
import {
    diagnoseRuntimePacketToPayloadFailure,
    payloadToScaffold,
    runtimePacketToPayload,
} from "../../src/worker/MapRenderDataContract";
import type { MapRenderDataPayload } from "../../src/worker/MapRenderDataContract";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    squares?: ReadonlyArray<Square>;
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
        | "releasePacket"
        | "decodeNpcSpawnsFromBytes"
    > &
    Readonly<{
        getRuntimeCachedCommandStreamArrays: (runtimeHandle: number) => Promise<
            | Readonly<{
                  cmdBucketIndices: Int32Array;
                  cmdOffsets: Int32Array;
                  cmdElements: Int32Array;
                  cmdInstanceCounts: Int32Array;
                  cmdPackedInstances: Int32Array;
                  vertices: Uint8Array;
                  indices: Int32Array;
              }>
            | undefined
        >;
        debugGetRuntimeLastCommandProvenancePacked?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocMergeEmitEntriesPacked?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
    }>;

type CommandProvenanceEntry = Readonly<{
    bucket: number;
    offset: number;
    elements: number;
    sourceKind: number;
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    variantType: number;
    variantRotation: number;
    pass: number;
    mergePath: number;
    splitSignature: number;
}>;

type LocMergeEmitEntry = Readonly<{
    offsetElements: number;
    elements: number;
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    level: number;
    priority: number;
    transparent: number;
    includeLod: number;
    groupIndex: number;
    instanceIndex: number;
    hasFaceRenderPriorities: number;
    faceRenderPrioritiesLength: number;
}>;

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let limit = 4;
    let squares: Square[] | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
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
    let h = hash >>> 0;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateInt(h, data[i] | 0);
    }
    return h >>> 0;
}

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

function computeMapBounds(baseX: number, baseY: number, sizeX: number, sizeY: number) {
    return {
        startX: Math.floor(baseX / 64),
        startY: Math.floor(baseY / 64),
        endX: Math.ceil((baseX + sizeX) / 64),
        endY: Math.ceil((baseY + sizeY) / 64),
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
        typeof runtimeCandidate.cacheSetBuildConfig !== "function" ||
        typeof runtimeCandidate.cacheClearMapSquares !== "function" ||
        typeof runtimeCandidate.cachePutMapSquaresPacked !== "function" ||
        typeof runtimeCandidate.cacheClearTypeKind !== "function" ||
        typeof runtimeCandidate.cachePutTypeEntry !== "function" ||
        typeof runtimeCandidate.collectRequiredExpandedTypeIds !== "function" ||
        typeof runtimeCandidate.cacheSetVarps !== "function" ||
        typeof runtimeCandidate.buildMapPacketFromCache !== "function" ||
        typeof runtimeCandidate.decodeNpcSpawnsFromBytes !== "function" ||
        typeof (runtimeCandidate as any).getRuntimeCachedCommandStreamArrays !== "function"
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
            : await runtimeCandidate.createRuntime?.();
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
        getRuntimeCachedCommandStreamArrays: (runtimeCandidate as any)
            .getRuntimeCachedCommandStreamArrays,
        debugGetRuntimeLastCommandProvenancePacked: (runtimeCandidate as any)
            .debugGetRuntimeLastCommandProvenancePacked,
        debugGetRuntimeLastLocMergeEmitEntriesPacked: (runtimeCandidate as any)
            .debugGetRuntimeLastLocMergeEmitEntriesPacked,
    };
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
    tsPayload: MapRenderDataPayload,
    wasmPayload: MapRenderDataPayload,
): BucketDigest {
    const drawCommandCount = (tsPayload.drawRanges[key].length / 3) | 0;
    return {
        drawCommandCount,
        tsDrawRangeCount: (tsPayload.drawRanges[key].length / 3) | 0,
        wasmDrawRangeCount: (wasmPayload.drawRanges[key].length / 3) | 0,
        tsModelInfoLength: tsPayload.modelInfoTextures[key].length | 0,
        wasmModelInfoLength: wasmPayload.modelInfoTextures[key].length | 0,
        tsDrawRangeHash: hashI32Array(tsPayload.drawRanges[key], 2166136261 >>> 0),
        wasmDrawRangeHash: hashI32Array(wasmPayload.drawRanges[key], 2166136261 >>> 0),
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

type PackedVertexTextureFields = Readonly<{
    isTextured: number;
    textureId: number;
    hasBlend: number;
    textureId1: number;
}>;

function decodePackedVertexTextureFields(
    bytes: Uint8Array,
    vertexIndex: number,
): PackedVertexTextureFields {
    const off = vertexIndex * 16;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v1 = view.getUint32(off + 4, true);
    const v2 = view.getUint32(off + 8, true);
    const v3 = view.getUint32(off + 12, true);
    const hsl = (v1 >>> 15) & 0xffff;

    const isTextured = (v1 >>> 31) & 0x1;
    const textureId =
        ((hsl >>> 7) & 0x1ff) | (((v2 >>> 5) & 0x1) << 9) | (((v3 >>> 19) & 0x1) << 10);

    const hasBlend = (v3 >>> 10) & 0x1;
    const textureId1 = (v3 & 0x3ff) | (((v3 >>> 20) & 0x1) << 10);

    return {
        isTextured,
        textureId: isTextured ? textureId : -1,
        hasBlend,
        textureId1: hasBlend ? textureId1 : -1,
    };
}

type PackedVertexFull = Readonly<{
    x: number;
    y: number;
    z: number;
    hsl: number;
    alpha: number;
    priority: number;
    isTextured: number;
    uPacked: number;
    vPacked: number;
    u: number;
    v: number;
    v0: number;
    v1: number;
    v2: number;
    v3: number;
}>;

function unpackFloat11(packed: number): number {
    return 16 - packed / 64;
}

function decodePackedVertexFull(bytes: Uint8Array, vertexIndex: number): PackedVertexFull {
    const off = vertexIndex * 16;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v0 = view.getUint32(off + 0, true) >>> 0;
    const v1 = view.getUint32(off + 4, true) >>> 0;
    const v2 = view.getUint32(off + 8, true) >>> 0;
    const v3 = view.getUint32(off + 12, true) >>> 0;

    const xPos = v0 >>> 17;
    const uLo = (v0 >>> 11) & 0x3f;
    const vPacked = v0 & 0x7ff;

    const yPos = v1 & 0x7fff;
    const hsl = (v1 >>> 15) & 0xffff;
    const isTextured = (v1 >>> 31) & 0x1;

    const zPos = v2 >>> 17;
    const alpha = (v2 >>> 9) & 0xff;
    const priority = (v2 >>> 6) & 0x7;
    const uHi = v2 & 0x1f;
    const uPacked = (uHi << 6) | uLo;

    const x = (xPos - 0x4000) | 0;
    const y = -(yPos - 0x4000) | 0;
    const z = (zPos - 0x4000) | 0;

    const u = unpackFloat11(uPacked);
    const v = unpackFloat11(vPacked);

    return {
        x,
        y,
        z,
        hsl,
        alpha,
        priority,
        isTextured,
        uPacked,
        vPacked,
        u,
        v,
        v0,
        v1,
        v2,
        v3,
    };
}

function firstPackedVertexFullDiff(
    aBytes: Uint8Array,
    bBytes: Uint8Array,
): { vertexIndex: number; ts: PackedVertexFull; wasm: PackedVertexFull } | undefined {
    const countA = (aBytes.length / 16) | 0;
    const countB = (bBytes.length / 16) | 0;
    const count = Math.min(countA, countB);
    for (let i = 0; i < count; i++) {
        const a = decodePackedVertexFull(aBytes, i);
        const b = decodePackedVertexFull(bBytes, i);
        if (a.v0 !== b.v0 || a.v1 !== b.v1 || a.v2 !== b.v2 || a.v3 !== b.v3) {
            return { vertexIndex: i, ts: a, wasm: b };
        }
    }
    return undefined;
}

function findFirstTriangleUsingVertex(indices: Int32Array, vertexIndex: number): number {
    const triCount = Math.floor(indices.length / 3) | 0;
    for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3 + 0] | 0;
        const i1 = indices[t * 3 + 1] | 0;
        const i2 = indices[t * 3 + 2] | 0;
        if (i0 === vertexIndex || i1 === vertexIndex || i2 === vertexIndex) {
            return t;
        }
    }
    return -1;
}

function findFirstElementUsingVertex(indices: Int32Array, vertexIndex: number): number {
    for (let i = 0; i < indices.length; i++) {
        if ((indices[i] | 0) === (vertexIndex | 0)) {
            return i | 0;
        }
    }
    return -1;
}

function decodeTrianglePackedVertices(
    bytes: Uint8Array,
    indices: Int32Array,
    triIndex: number,
): PackedVertexFull[] {
    const i0 = indices[triIndex * 3 + 0] | 0;
    const i1 = indices[triIndex * 3 + 1] | 0;
    const i2 = indices[triIndex * 3 + 2] | 0;
    return [
        decodePackedVertexFull(bytes, i0),
        decodePackedVertexFull(bytes, i1),
        decodePackedVertexFull(bytes, i2),
    ];
}

function digestPackedVertexU32(bytes: Uint8Array): Record<string, number> {
    const vertexCount = (bytes.length / 16) | 0;
    let hash = 2166136261 >>> 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < vertexCount; i++) {
        const off = i * 16;
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 0, true));
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 4, true));
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 8, true));
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 12, true));
    }
    return { vertexCount, u32Hash: hash >>> 0 };
}

function digestPackedVertexU32Prefix(bytes: Uint8Array, count: number): Record<string, number> {
    const vertexCount = Math.min((bytes.length / 16) | 0, count | 0);
    let hash = 2166136261 >>> 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < vertexCount; i++) {
        const off = i * 16;
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 0, true));
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 4, true));
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 8, true));
        hash = fnv1a32UpdateInt(hash, view.getUint32(off + 12, true));
    }
    return { vertexCount, u32PrefixHash: hash >>> 0 };
}

function parseCommandProvenancePacked(packed: Int32Array | undefined): CommandProvenanceEntry[] {
    if (!(packed instanceof Int32Array) || packed.length <= 0) {
        return [];
    }
    const stride = packed.length % 12 === 0 ? 12 : packed.length % 11 === 0 ? 11 : 0;
    if (stride <= 0) {
        return [];
    }
    const out: CommandProvenanceEntry[] = [];
    const count = (packed.length / stride) | 0;
    for (let i = 0; i < count; i++) {
        const base = i * stride;
        const fieldBase = base + (stride === 12 ? 3 : 0);
        out.push({
            bucket: stride === 12 ? packed[base + 0] | 0 : -1,
            offset: stride === 12 ? packed[base + 1] | 0 : -1,
            elements: stride === 12 ? packed[base + 2] | 0 : -1,
            sourceKind: packed[fieldBase + 0] | 0,
            locTypeId: packed[fieldBase + 1] | 0,
            placementType: packed[fieldBase + 2] | 0,
            placementRotation: packed[fieldBase + 3] | 0,
            variantType: packed[fieldBase + 4] | 0,
            variantRotation: packed[fieldBase + 5] | 0,
            pass: packed[fieldBase + 6] | 0,
            mergePath: packed[fieldBase + 7] | 0,
            splitSignature: stride === 12 ? packed[fieldBase + 8] | 0 : -1,
        });
    }
    return out;
}

function parseLocMergeEmitEntriesPacked(packed: Int32Array | undefined): LocMergeEmitEntry[] {
    if (!(packed instanceof Int32Array) || packed.length <= 0) {
        return [];
    }
    const stride = packed.length % 13 === 0 ? 13 : packed.length % 11 === 0 ? 11 : 0;
    if (stride <= 0) {
        return [];
    }
    const out: LocMergeEmitEntry[] = [];
    for (let i = 0; i < packed.length; i += stride) {
        out.push({
            offsetElements: packed[i + 0] | 0,
            elements: packed[i + 1] | 0,
            locTypeId: packed[i + 2] | 0,
            placementType: packed[i + 3] | 0,
            placementRotation: packed[i + 4] | 0,
            level: packed[i + 5] | 0,
            priority: packed[i + 6] | 0,
            transparent: packed[i + 7] | 0,
            includeLod: packed[i + 8] | 0,
            groupIndex: packed[i + 9] | 0,
            instanceIndex: packed[i + 10] | 0,
            hasFaceRenderPriorities: stride >= 13 ? packed[i + 11] | 0 : -1,
            faceRenderPrioritiesLength: stride >= 13 ? packed[i + 12] | 0 : -1,
        });
    }
    return out;
}

function findCommandForElement(
    cmdOffsets: Int32Array,
    cmdElements: Int32Array,
    elementIndex: number,
): number {
    for (let i = 0; i < cmdOffsets.length; i++) {
        const start = ((cmdOffsets[i] | 0) >> 2) | 0; // offset is byte offset into U32 indices
        const count = i < cmdElements.length ? cmdElements[i] | 0 : 0;
        if (count <= 0) {
            continue;
        }
        const end = (start + count) | 0;
        if (elementIndex >= start && elementIndex < end) {
            return i;
        }
    }
    return -1;
}

function decodeBucketKey(bucket: number): string {
    if (bucket < 0 || bucket >= DRAW_BUCKET_KEYS.length) {
        return "unknown";
    }
    return DRAW_BUCKET_KEYS[bucket];
}

function summarizeCommandVertexPriorities(
    verticesBytes: Uint8Array,
    indices: Int32Array,
    offsetElements: number,
    elements: number,
): Record<string, number> {
    const out: Record<string, number> = {};
    const start = Math.max(0, offsetElements | 0);
    const end = Math.min(indices.length | 0, (start + (elements | 0)) | 0);
    for (let i = start; i < end; i++) {
        const v = indices[i] | 0;
        if (v < 0) continue;
        const p = decodePackedVertexFull(verticesBytes, v).priority | 0;
        const key = String(p);
        out[key] = ((out[key] ?? 0) + 1) | 0;
    }
    return out;
}

function digestPackedVertexTextureFields(bytes: Uint8Array): Record<string, number> {
    const vertexCount = (bytes.length / 16) | 0;
    let hash = 2166136261 >>> 0;
    let textured = 0;
    let blended = 0;
    for (let i = 0; i < vertexCount; i++) {
        const f = decodePackedVertexTextureFields(bytes, i);
        textured += f.isTextured;
        blended += f.hasBlend;
        hash = fnv1a32UpdateInt(hash, f.isTextured);
        hash = fnv1a32UpdateInt(hash, f.textureId);
        hash = fnv1a32UpdateInt(hash, f.hasBlend);
        hash = fnv1a32UpdateInt(hash, f.textureId1);
    }
    return {
        vertexCount,
        texturedCount: textured,
        blendedCount: blended,
        textureFieldHash: hash >>> 0,
    };
}

function firstPackedVertexTextureFieldDiff(
    aBytes: Uint8Array,
    bBytes: Uint8Array,
):
    | { vertexIndex: number; ts: PackedVertexTextureFields; wasm: PackedVertexTextureFields }
    | undefined {
    const countA = (aBytes.length / 16) | 0;
    const countB = (bBytes.length / 16) | 0;
    const count = Math.min(countA, countB);
    for (let i = 0; i < count; i++) {
        const a = decodePackedVertexTextureFields(aBytes, i);
        const b = decodePackedVertexTextureFields(bBytes, i);
        if (
            a.isTextured !== b.isTextured ||
            a.textureId !== b.textureId ||
            a.hasBlend !== b.hasBlend ||
            a.textureId1 !== b.textureId1
        ) {
            return { vertexIndex: i, ts: a, wasm: b };
        }
    }
    return undefined;
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
        throw new Error("No map squares found for runtime-packet parity");
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

        const tsPayloadResult = await tsBackend.buildMapDataPayload(input, {
            includeMinimapBlob: false,
        });

        if (!tsPayloadResult.data) {
            mismatches++;
            console.error(`payload missing at ${square.mapX},${square.mapY}`);
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

        const wasmPayload = runtimePacketToPayload(
            packet,
            payloadToScaffold(tsPayloadResult.data),
            { requirePacketGeometry: true },
        );

        if (typeof wasmBridge.releasePacket === "function") {
            wasmBridge.releasePacket(packet);
        }
        if (!wasmPayload) {
            mismatches++;
            console.error(`wasm packet conversion failed at ${square.mapX},${square.mapY}`);
            const failure = diagnoseRuntimePacketToPayloadFailure(packet, {
                requirePacketGeometry: true,
            });
            if (failure) {
                console.error(`  packet failure: ${JSON.stringify(failure)}`);
                if (failure.stage === "geometry") {
                    const arrays = await wasmBridge.getRuntimeCachedCommandStreamArrays(
                        wasmBridge.runtimeHandle,
                    );
                    if (arrays) {
                        console.error(
                            "  cached command stream lengths: " +
                                JSON.stringify({
                                    cmdCount: arrays.cmdOffsets.length | 0,
                                    cmdPackedInstancesLength: arrays.cmdPackedInstances.length | 0,
                                    verticesLength: arrays.vertices.length | 0,
                                    indicesLength: arrays.indices.length | 0,
                                }),
                        );
                    } else {
                        console.error("  cached command stream arrays unavailable");
                    }
                }
            }
            const bounds = computeMapBounds(
                sceneBuildInput.baseX | 0,
                sceneBuildInput.baseY | 0,
                sceneBuildInput.sizeX | 0,
                sceneBuildInput.sizeY | 0,
            );
            const presentSquares: Array<{
                mapX: number;
                mapY: number;
                terrain: boolean;
                loc: boolean;
            }> = [];
            for (let mx = bounds.startX; mx < bounds.endX; mx++) {
                for (let my = bounds.startY; my < bounds.endY; my++) {
                    presentSquares.push({
                        mapX: mx,
                        mapY: my,
                        terrain: mapBytesProvider.getTerrainBytes(mx, my) instanceof Uint8Array,
                        loc: mapBytesProvider.getLocBytes(mx, my) instanceof Uint8Array,
                    });
                }
            }
            console.error("  map-byte presence:", JSON.stringify(presentSquares));
            continue;
        }

        const tsPayload = tsPayloadResult.data;

        const tsCore = coreDigest(tsPayload);
        const wasmCore = coreDigest(wasmPayload);
        if (JSON.stringify(tsCore) !== JSON.stringify(wasmCore)) {
            mismatches++;
            console.error(`core mismatch at ${square.mapX},${square.mapY}`);
            console.error(`  ts=${JSON.stringify(tsCore)}`);
            console.error(`  wasm=${JSON.stringify(wasmCore)}`);
            const tsU32 = digestPackedVertexU32(tsPayload.vertices);
            const wasmU32 = digestPackedVertexU32(wasmPayload.vertices);
            console.error(
                "  vertex-u32 digest ts=" +
                    JSON.stringify(tsU32) +
                    " wasm=" +
                    JSON.stringify(wasmU32),
            );
            console.error(
                "  vertex-u32 prefix(256) ts=" +
                    JSON.stringify(digestPackedVertexU32Prefix(tsPayload.vertices, 256)) +
                    " wasm=" +
                    JSON.stringify(digestPackedVertexU32Prefix(wasmPayload.vertices, 256)),
            );
            const firstFull = firstPackedVertexFullDiff(tsPayload.vertices, wasmPayload.vertices);
            if (firstFull) {
                console.error("  first packed-vertex diff=" + JSON.stringify(firstFull));
                const tri = findFirstTriangleUsingVertex(
                    tsPayload.indices,
                    firstFull.vertexIndex | 0,
                );
                if (tri >= 0) {
                    const tsTri = decodeTrianglePackedVertices(
                        tsPayload.vertices,
                        tsPayload.indices,
                        tri,
                    );
                    const wasmTri = decodeTrianglePackedVertices(
                        wasmPayload.vertices,
                        wasmPayload.indices,
                        tri,
                    );
                    console.error(
                        "  first packed-vertex tri=" + tri + " ts=" + JSON.stringify(tsTri),
                    );
                    console.error(
                        "  first packed-vertex tri=" + tri + " wasm=" + JSON.stringify(wasmTri),
                    );
                }

                const firstElement = findFirstElementUsingVertex(
                    wasmPayload.indices,
                    firstFull.vertexIndex | 0,
                );
                if (firstElement >= 0) {
                    const commandStreamArrays = await wasmBridge.getRuntimeCachedCommandStreamArrays(
                        wasmBridge.runtimeHandle,
                    );
                    const commandProvenancePacked =
                        typeof wasmBridge.debugGetRuntimeLastCommandProvenancePacked === "function"
                            ? await wasmBridge.debugGetRuntimeLastCommandProvenancePacked(
                                  wasmBridge.runtimeHandle,
                              )
                            : undefined;
                    const commandProvenance = parseCommandProvenancePacked(commandProvenancePacked);
                    const locMergeEmitEntriesPacked =
                        typeof wasmBridge.debugGetRuntimeLastLocMergeEmitEntriesPacked ===
                        "function"
                            ? await wasmBridge.debugGetRuntimeLastLocMergeEmitEntriesPacked(
                                  wasmBridge.runtimeHandle,
                              )
                            : undefined;
                    const locMergeEmitEntries =
                        parseLocMergeEmitEntriesPacked(locMergeEmitEntriesPacked);
                    const cmdIndex =
                        commandStreamArrays &&
                        commandStreamArrays.cmdOffsets instanceof Int32Array &&
                        commandStreamArrays.cmdElements instanceof Int32Array
                            ? findCommandForElement(
                                  commandStreamArrays.cmdOffsets,
                                  commandStreamArrays.cmdElements,
                                  firstElement,
                              )
                            : -1;
                    const triIndex = (firstElement / 3) | 0;
                    console.error(
                        "  first packed-vertex usage element=" +
                            firstElement +
                            " tri=" +
                            triIndex +
                            " cmdIndex=" +
                            cmdIndex,
                    );
                    if (cmdIndex >= 0 && commandStreamArrays) {
                        const cmdBucket = commandStreamArrays.cmdBucketIndices[cmdIndex] | 0;
                        const cmdOffsetBytes = commandStreamArrays.cmdOffsets[cmdIndex] | 0;
                        const cmdElements = commandStreamArrays.cmdElements[cmdIndex] | 0;
                        const cmdInstanceCount =
                            commandStreamArrays.cmdInstanceCounts[cmdIndex] | 0;
                        const cmdOffsetElements = (cmdOffsetBytes >> 2) | 0;
                        console.error(
                            "  command stream cmd=" +
                                JSON.stringify({
                                    bucket: cmdBucket,
                                    bucketKey: decodeBucketKey(cmdBucket),
                                    offsetBytes: cmdOffsetBytes,
                                    offsetElements: cmdOffsetElements,
                                    elements: cmdElements,
                                    instanceCount: cmdInstanceCount,
                                }),
                        );
                        console.error(
                            "  command priority histogram ts=" +
                                JSON.stringify(
                                    summarizeCommandVertexPriorities(
                                        tsPayload.vertices,
                                        tsPayload.indices,
                                        cmdOffsetElements,
                                        cmdElements,
                                    ),
                                ) +
                                " wasm=" +
                                JSON.stringify(
                                    summarizeCommandVertexPriorities(
                                        wasmPayload.vertices,
                                        wasmPayload.indices,
                                        cmdOffsetElements,
                                        cmdElements,
                                    ),
                                ),
                        );
                    }
                    if (cmdIndex >= 0 && cmdIndex < commandProvenance.length) {
                        console.error(
                            "  command provenance cmd=" +
                                JSON.stringify(commandProvenance[cmdIndex]),
                        );
                    }
                    if (locMergeEmitEntries.length > 0) {
                        const mergeSource = locMergeEmitEntries.find((entry) => {
                            const start = entry.offsetElements | 0;
                            const end = (start + (entry.elements | 0)) | 0;
                            return firstElement >= start && firstElement < end;
                        });
                        if (mergeSource) {
                            console.error("  loc-merge emit source=" + JSON.stringify(mergeSource));
                        }
                    }
                }
            }
        }

        const tsVertexTextureDigest = digestPackedVertexTextureFields(tsPayload.vertices);
        const wasmVertexTextureDigest = digestPackedVertexTextureFields(wasmPayload.vertices);
        if (JSON.stringify(tsVertexTextureDigest) !== JSON.stringify(wasmVertexTextureDigest)) {
            mismatches++;
            console.error(`vertex texture-field mismatch at ${square.mapX},${square.mapY}`);
            console.error(`  ts=${JSON.stringify(tsVertexTextureDigest)}`);
            console.error(`  wasm=${JSON.stringify(wasmVertexTextureDigest)}`);
            const firstDiff = firstPackedVertexTextureFieldDiff(
                tsPayload.vertices,
                wasmPayload.vertices,
            );
            if (firstDiff) {
                console.error(`  firstDiff=${JSON.stringify(firstDiff)}`);
            }
        }

        for (const key of DRAW_BUCKET_KEYS) {
            const tsDigest = digestBucket(key, tsPayload, tsPayload);
            const wasmDigest = digestBucket(key, tsPayload, wasmPayload);
            if (JSON.stringify(tsDigest) !== JSON.stringify(wasmDigest)) {
                mismatches++;
                console.error(`bucket mismatch at ${square.mapX},${square.mapY} key=${key}`);
                console.error(`  ts=${JSON.stringify(tsDigest)}`);
                console.error(`  wasm=${JSON.stringify(wasmDigest)}`);
            }
        }
    }

    console.log(
        `map-render-runtime-packet-parity: cache=${cacheInfo.name} squares=${squares.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
