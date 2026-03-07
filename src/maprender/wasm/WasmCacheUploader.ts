import type { ObjSpawn } from "../../data/obj/ObjSpawn";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { Scene } from "../../rs/scene/Scene";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeHandle,
    MapRenderRuntimeMissingBlobEntries,
    MapRenderRuntimePacket,
} from "../../wasm/MapRenderRuntimeBridgeAbi";
import {
    MAP_RENDER_RUNTIME_STATUS_INVALID_ARG,
    MAP_RENDER_RUNTIME_STATUS_NOT_FOUND,
    MAP_RENDER_RUNTIME_STATUS_OK,
} from "../../wasm/MapRenderRuntimeStatus.mjs";
import { SdMapLoaderInput } from "../MapRenderPayload";
import {
    RuntimeBlobTypeEntryKind,
    runtimeBlobTypeEntryDomain,
} from "./RuntimeBlobTypeEntries";

const MAP_SQUARE_SIZE = 64;

// Preferred domains for blob-store-backed type entries follow the runtime contract:
// domain = 100 + kind, group = 0, file = id.
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_LOC = runtimeBlobTypeEntryDomain(RuntimeBlobTypeEntryKind.loc);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_VARBIT = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.varbit,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_MODEL = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.model,
);
// Per-texture definition bytes (cache-type dependent):
// - Dat2 Sprite textures: SpriteTextureDefinition bytes
// - Dat2 procedural textures: procedural texture definition bytes
// (domain=104, group=0, file=textureId).
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_DEF = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.textureDef,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.seqType,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_FRAME = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.seqFrame,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_NPC = runtimeBlobTypeEntryDomain(RuntimeBlobTypeEntryKind.npc);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_BAS = runtimeBlobTypeEntryDomain(RuntimeBlobTypeEntryKind.bas);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_UNDERLAY = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.underlay,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.overlay,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ = runtimeBlobTypeEntryDomain(RuntimeBlobTypeEntryKind.obj);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.objSpawns,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_BASE = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.seqBase,
);
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ = runtimeBlobTypeEntryDomain(
    RuntimeBlobTypeEntryKind.skeletalSeq,
);
// Domain for map-square bytes: (domain=2, group=mapSquareId, file=<map-square file id>).
const RUNTIME_BLOB_DOMAIN_MAP_SQUARE = 2;
const RUNTIME_BLOB_MAP_SQUARE_FILE_TERRAIN = 0;
const RUNTIME_BLOB_MAP_SQUARE_FILE_LOC = 1;
const RUNTIME_BLOB_MAP_SQUARE_FILE_NPC = 2;
// Domain for dat seq frame-map bytes: (domain=3, group=frameMapId, file=0).
const RUNTIME_BLOB_DOMAIN_DAT_SEQ_FRAME_MAP = 3;
const RUNTIME_BLOB_DAT_SEQ_FRAME_MAP_FILE_BYTES = 0;
// Domain for legacy seq-frame support: upload the raw legacy base/frame named files once.
// (domain=4, group=0, file=<enum>)
const RUNTIME_BLOB_DOMAIN_LEGACY_SEQ_FILES = 4;
const RUNTIME_BLOB_LEGACY_SEQ_GROUP_GLOBAL = 0;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_HEAD = 0;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_TYPE = 1;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_LABEL = 2;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_HEAD = 3;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN1 = 4;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN2 = 5;
const RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_DEL = 6;
// Domain for legacy model support: upload the raw legacy model named files once.
// (domain=5, group=0, file=<enum>)
const RUNTIME_BLOB_DOMAIN_LEGACY_MODEL_FILES = 5;
const RUNTIME_BLOB_LEGACY_MODEL_GROUP_GLOBAL = 0;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_HEAD = 0;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE1 = 1;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE2 = 2;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE3 = 3;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE4 = 4;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE5 = 5;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT1 = 6;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT2 = 7;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT3 = 8;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT4 = 9;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT5 = 10;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_VERTEX1 = 11;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_VERTEX2 = 12;
const RUNTIME_BLOB_LEGACY_MODEL_FILE_AXIS = 13;

type TypeEntryLoaderLike = Readonly<{
    tryLoadBytes?: (id: number) => Uint8Array | Int8Array | undefined;
}>;

type LegacyModelFileBytes = Readonly<{
    headBytes: Uint8Array;
    face1Bytes: Uint8Array;
    face2Bytes: Uint8Array;
    face3Bytes: Uint8Array;
    face4Bytes: Uint8Array;
    face5Bytes: Uint8Array;
    point1Bytes: Uint8Array;
    point2Bytes: Uint8Array;
    point3Bytes: Uint8Array;
    point4Bytes: Uint8Array;
    point5Bytes: Uint8Array;
    vertex1Bytes: Uint8Array;
    vertex2Bytes: Uint8Array;
    axisBytes: Uint8Array;
}>;

type LegacySeqFrameFileBytes = Readonly<{
    baseHeadBytes: Uint8Array;
    baseTypeBytes: Uint8Array;
    baseLabelBytes: Uint8Array;
    frameHeadBytes: Uint8Array;
    frameTran1Bytes: Uint8Array;
    frameTran2Bytes: Uint8Array;
    frameDelBytes: Uint8Array;
}>;

type ModelLoaderLike = TypeEntryLoaderLike &
    Readonly<{
        tryGetLegacyModelFileBytes?: () => LegacyModelFileBytes;
    }>;

type SeqFrameLoaderLike = TypeEntryLoaderLike &
    Readonly<{
        baseLoader?: TypeEntryLoaderLike;
        tryGetLegacySeqFrameFileBytes?: () => LegacySeqFrameFileBytes;
        tryGetFrameMapBytesForMapId?: (mapId: number) => Uint8Array | undefined;
        tryGet?: (id: number) => Readonly<{ hasAlphaTransform: boolean }> | undefined;
    }>;

type SkeletalSeqLoaderLike = TypeEntryLoaderLike &
    Readonly<{
        baseLoader?: TypeEntryLoaderLike;
        tryGet?: (id: number) => Readonly<{ hasAlphaTransform: boolean }> | undefined;
    }>;

type MapRenderSceneBuildInputDeps = Readonly<
    Pick<
        MapRenderByteDrivenSceneBuildInput,
        "objSpawns" | "cacheGame" | "cacheRevision" | "cacheProvider" | "varpValues"
    >
>;

export type MapRenderRuntimePrepareResult = Readonly<{
    ok: boolean;
    reason:
        | "ok"
        | "upload_base_failed"
        | "upload_missing_failed"
        | "status_non_ok"
        | "max_passes_exhausted";
    status: number;
    passesTried: number;
    missingCount: number;
    lastBuildFailure?:
        | Readonly<{ stage: number; status: number; detail0: number; detail1: number }>
        | undefined;
}>;

export type SceneBuildCacheProvider = Readonly<{
    tryGetBlobBytes(domain: number, group: number, file: number): Uint8Array | undefined;
}>;

export type SceneBuildCacheProviderLoaders = Readonly<{
    mapBytesProvider?: MapBytesProvider;
    locTypeLoader: TypeEntryLoaderLike;
    objTypeLoader?: TypeEntryLoaderLike;
    modelLoader?: ModelLoaderLike;
    seqTypeLoader?: TypeEntryLoaderLike;
    seqFrameLoader?: SeqFrameLoaderLike;
    skeletalSeqLoader?: SkeletalSeqLoaderLike;
    npcTypeLoader?: TypeEntryLoaderLike;
    basTypeLoader?: TypeEntryLoaderLike;
    textureLoader?: TypeEntryLoaderLike;
    varbitLoader?: TypeEntryLoaderLike;
    underlayTypeLoader?: TypeEntryLoaderLike;
    overlayTypeLoader?: TypeEntryLoaderLike;
}>;

type RuntimeCacheFeeder = Readonly<{
    setBuildConfig(request: MapRenderRuntimeBuildRequest): Promise<boolean>;
    setVarps(varps: Int32Array): Promise<boolean>;
    putBlobBatch(
        domain: number,
        groups: Int32Array,
        files: Int32Array,
        offsets: Int32Array,
        lengths: Int32Array,
        bytes: Uint8Array,
    ): Promise<boolean>;
    clearBlobDomain(domain: number): Promise<boolean>;
}>;

function createRuntimeCacheFeeder(
    bridge: MapRenderRuntimeBridgeV2,
    runtimeHandle: MapRenderRuntimeHandle,
): RuntimeCacheFeeder {
    return {
        setBuildConfig: async (request: MapRenderRuntimeBuildRequest) => {
            return (
                (await bridge.cacheSetBuildConfig(runtimeHandle, request)) ===
                MAP_RENDER_RUNTIME_STATUS_OK
            );
        },
        setVarps: async (varps: Int32Array) => {
            return (
                (await bridge.cacheSetVarps(runtimeHandle, varps)) === MAP_RENDER_RUNTIME_STATUS_OK
            );
        },
        putBlobBatch: async (
            domain: number,
            groups: Int32Array,
            files: Int32Array,
            offsets: Int32Array,
            lengths: Int32Array,
            bytes: Uint8Array,
        ) => {
            return (
                (await bridge.cachePutBlobBatch(
                    runtimeHandle,
                    domain | 0,
                    groups,
                    files,
                    offsets,
                    lengths,
                    bytes,
                )) === MAP_RENDER_RUNTIME_STATUS_OK
            );
        },
        clearBlobDomain: async (domain: number) => {
            return (
                (await bridge.cacheClearBlobDomain(runtimeHandle, domain | 0)) ===
                MAP_RENDER_RUNTIME_STATUS_OK
            );
        },
    };
}

function toUint8View(data: unknown): Uint8Array | undefined {
    if (data instanceof Uint8Array) {
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return undefined;
}

function tryLoadTypeBytes(
    loader: TypeEntryLoaderLike | undefined,
    id: number,
): Uint8Array | undefined {
    if (!loader) {
        return undefined;
    }
    if (typeof loader.tryLoadBytes === "function") {
        try {
            const bytes = toUint8View(loader.tryLoadBytes(id | 0));
            if (bytes) {
                return bytes;
            }
        } catch {
            // ignore
        }
    }
    return undefined;
}

export function createSceneBuildCacheProvider(
    loaders: SceneBuildCacheProviderLoaders,
): SceneBuildCacheProvider {
    const mapBytesProvider = loaders.mapBytesProvider;
    const locTypeLoader = loaders.locTypeLoader;
    const objTypeLoader = loaders.objTypeLoader;
    const npcTypeLoader = loaders.npcTypeLoader;
    const basTypeLoader = loaders.basTypeLoader;
    const textureLoader = loaders.textureLoader;
    const underlayTypeLoader = loaders.underlayTypeLoader;
    const overlayTypeLoader = loaders.overlayTypeLoader;
    const varbitLoader = loaders.varbitLoader;
    const modelLoader = loaders.modelLoader;
    const seqTypeLoader = loaders.seqTypeLoader;
    const seqFrameLoader = loaders.seqFrameLoader;
    const skeletalSeqLoader = loaders.skeletalSeqLoader;
    const seqBaseLoader = skeletalSeqLoader?.baseLoader ?? seqFrameLoader?.baseLoader;
    const legacyModelFilesByFileId = new Map<number, Uint8Array>();
    const legacySeqFilesByFileId = new Map<number, Uint8Array>();

    const legacyModelFileBytesGetter = modelLoader?.tryGetLegacyModelFileBytes;
    const tryGetLegacyModelFileBytes =
        typeof legacyModelFileBytesGetter === "function"
            ? () => {
                  try {
                      return legacyModelFileBytesGetter.call(modelLoader);
                  } catch {
                      return undefined;
                  }
              }
            : undefined;

    const legacySeqFrameFileBytesGetter = seqFrameLoader?.tryGetLegacySeqFrameFileBytes;
    const tryGetLegacySeqFrameFileBytes =
        typeof legacySeqFrameFileBytesGetter === "function"
            ? () => {
                  try {
                      return legacySeqFrameFileBytesGetter.call(seqFrameLoader);
                  } catch {
                      return undefined;
                  }
              }
            : undefined;

    const typeEntryBytesByDomain = new Map<number, (id: number) => Uint8Array | undefined>([
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_LOC, (id) => tryLoadTypeBytes(locTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_VARBIT, (id) => tryLoadTypeBytes(varbitLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_MODEL, (id) => tryLoadTypeBytes(modelLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_DEF, (id) => tryLoadTypeBytes(textureLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE, (id) => tryLoadTypeBytes(seqTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_FRAME, (id) => tryLoadTypeBytes(seqFrameLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_NPC, (id) => tryLoadTypeBytes(npcTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_BAS, (id) => tryLoadTypeBytes(basTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_UNDERLAY, (id) => tryLoadTypeBytes(underlayTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY, (id) => tryLoadTypeBytes(overlayTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ, (id) => tryLoadTypeBytes(objTypeLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_BASE, (id) => tryLoadTypeBytes(seqBaseLoader, id)],
        [RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ, (id) => tryLoadTypeBytes(skeletalSeqLoader, id)],
    ]);

    const tryGetTypeEntryBytes = (domain: number, id: number): Uint8Array | undefined => {
        const d = domain | 0;
        const typeId = id | 0;
        if (typeId < 0) return undefined;
        return typeEntryBytesByDomain.get(d)?.(typeId);
    };

    const tryGetBlobBytes = (
        domain: number,
        group: number,
        file: number,
    ): Uint8Array | undefined => {
        const d = domain | 0;
        const g = group | 0;
        const f = file | 0;

        if (d === RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS) return undefined;

        if (d === RUNTIME_BLOB_DOMAIN_MAP_SQUARE) {
            if (!mapBytesProvider) return undefined;
            const mapX = (g >> 8) & 0xff;
            const mapY = g & 0xff;
            if (f === RUNTIME_BLOB_MAP_SQUARE_FILE_TERRAIN) {
                return toUint8View(mapBytesProvider.getTerrainBytes(mapX, mapY));
            }
            if (f === RUNTIME_BLOB_MAP_SQUARE_FILE_LOC) {
                return toUint8View(mapBytesProvider.getLocBytes(mapX, mapY));
            }
            if (f === RUNTIME_BLOB_MAP_SQUARE_FILE_NPC) {
                if (typeof mapBytesProvider.getNpcSpawnBytes !== "function") return undefined;
                return toUint8View(mapBytesProvider.getNpcSpawnBytes(mapX, mapY));
            }
            return undefined;
        }

        if (d === RUNTIME_BLOB_DOMAIN_DAT_SEQ_FRAME_MAP) {
            if (f !== RUNTIME_BLOB_DAT_SEQ_FRAME_MAP_FILE_BYTES) return undefined;
            if (typeof seqFrameLoader?.tryGetFrameMapBytesForMapId !== "function") return undefined;
            try {
                const bytes = seqFrameLoader.tryGetFrameMapBytesForMapId(g);
                return bytes instanceof Uint8Array ? bytes : undefined;
            } catch {
                return undefined;
            }
        }

        if (d === RUNTIME_BLOB_DOMAIN_LEGACY_MODEL_FILES) {
            if (g !== RUNTIME_BLOB_LEGACY_MODEL_GROUP_GLOBAL) return undefined;
            const cached = legacyModelFilesByFileId.get(f);
            if (cached) return cached;
            const files = tryGetLegacyModelFileBytes?.();
            if (!files) return undefined;
            const table: Readonly<Record<number, Uint8Array>> = {
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_HEAD]: files.headBytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE1]: files.face1Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE2]: files.face2Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE3]: files.face3Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE4]: files.face4Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE5]: files.face5Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT1]: files.point1Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT2]: files.point2Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT3]: files.point3Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT4]: files.point4Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT5]: files.point5Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_VERTEX1]: files.vertex1Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_VERTEX2]: files.vertex2Bytes,
                [RUNTIME_BLOB_LEGACY_MODEL_FILE_AXIS]: files.axisBytes,
            };
            const bytes = table[f];
            if (bytes instanceof Uint8Array) {
                legacyModelFilesByFileId.set(f, bytes);
                return bytes;
            }
            return undefined;
        }

        if (d === RUNTIME_BLOB_DOMAIN_LEGACY_SEQ_FILES) {
            if (g !== RUNTIME_BLOB_LEGACY_SEQ_GROUP_GLOBAL) return undefined;
            const cached = legacySeqFilesByFileId.get(f);
            if (cached) return cached;
            const files = tryGetLegacySeqFrameFileBytes?.();
            if (!files) return undefined;
            const table: Readonly<Record<number, Uint8Array>> = {
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_HEAD]: files.baseHeadBytes,
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_TYPE]: files.baseTypeBytes,
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_LABEL]: files.baseLabelBytes,
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_HEAD]: files.frameHeadBytes,
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN1]: files.frameTran1Bytes,
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN2]: files.frameTran2Bytes,
                [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_DEL]: files.frameDelBytes,
            };
            const bytes = table[f];
            if (bytes instanceof Uint8Array) {
                legacySeqFilesByFileId.set(f, bytes);
                return bytes;
            }
            return undefined;
        }

        if (g !== 0) return undefined;
        return tryGetTypeEntryBytes(d, f);
    };

    return { tryGetBlobBytes };
}

export type MapRenderByteDrivenSceneBuildInput = Readonly<{
    mapX: number;
    mapY: number;
    maxLevel: number;
    loadLocs: boolean;
    loadObjs: boolean;
    loadNpcs: boolean;
    baseX: number;
    baseY: number;
    sizeX: number;
    sizeY: number;
    smoothTerrain: boolean;
    minimizeDrawCalls: boolean;
    locLoadType: number;
    cacheGame: number;
    cacheRevision: number;
    unitsTileHeightBasis: number;
    objSpawns?: ReadonlyArray<ObjSpawn>;
    varpValues: Int32Array;
    cacheProvider: SceneBuildCacheProvider;
}>;

export function createByteDrivenSceneBuildInput(
    input: SdMapLoaderInput,
    deps: MapRenderSceneBuildInputDeps,
): MapRenderByteDrivenSceneBuildInput {
    const borderSize = 6;
    const mapSquareSize = 64;
    const baseX = input.mapX * mapSquareSize - borderSize;
    const baseY = input.mapY * mapSquareSize - borderSize;
    const mapSize = mapSquareSize + borderSize * 2;
    // Keep consistent with TS build stages used in parity:
    // - If we aren't rendering loc models, still decode loc placements but avoid model loads/lighting.
    // - If we are rendering locs, load models and light the scene.
    const locLoadType = input.loadLocs === true ? 0 : 1; // LocLoadType.MODELS : LocLoadType.NO_MODELS
    return {
        mapX: input.mapX | 0,
        mapY: input.mapY | 0,
        maxLevel: input.maxLevel | 0,
        loadLocs: input.loadLocs === true,
        loadObjs: input.loadObjs === true,
        loadNpcs: input.loadNpcs === true,
        baseX,
        baseY,
        sizeX: mapSize,
        sizeY: mapSize,
        smoothTerrain: input.smoothTerrain,
        minimizeDrawCalls: input.minimizeDrawCalls,
        locLoadType,
        cacheGame: deps.cacheGame,
        cacheRevision: deps.cacheRevision,
        // Keep identical to TS `Scene` height basis (tile-heights are in 1/128 units).
        unitsTileHeightBasis: Scene.UNITS_TILE_HEIGHT_BASIS,
        objSpawns: deps.objSpawns,
        varpValues: deps.varpValues,
        cacheProvider: deps.cacheProvider,
    };
}

function computeSceneBuildMapBounds(baseX: number, baseY: number, sizeX: number, sizeY: number) {
    return {
        mapStartX: Math.floor(baseX / MAP_SQUARE_SIZE),
        mapStartY: Math.floor(baseY / MAP_SQUARE_SIZE),
        mapEndX: Math.ceil((baseX + sizeX) / MAP_SQUARE_SIZE),
        mapEndY: Math.ceil((baseY + sizeY) / MAP_SQUARE_SIZE),
    };
}

function createObjSpawnBytesByMapIdForBuild(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    requiredMapIds?: ReadonlyArray<number>,
): ReadonlyMap<number, Uint8Array> | undefined {
    if (sceneBuildInput.loadObjs !== true) {
        return undefined;
    }
    const objSpawns = Array.isArray(sceneBuildInput.objSpawns) ? sceneBuildInput.objSpawns : [];
    if (objSpawns.length <= 0) {
        return undefined;
    }
    const bounds = computeSceneBuildMapBounds(
        sceneBuildInput.baseX | 0,
        sceneBuildInput.baseY | 0,
        sceneBuildInput.sizeX | 0,
        sceneBuildInput.sizeY | 0,
    );
    const requiredSet =
        Array.isArray(requiredMapIds) && requiredMapIds.length > 0
            ? new Set(requiredMapIds.map((v) => v | 0))
            : undefined;

    const entriesByMapId = new Map<number, number[]>();
    for (let i = 0; i < objSpawns.length; i++) {
        const spawn = objSpawns[i];
        if (!spawn) {
            continue;
        }
        const x = spawn.x | 0;
        const y = spawn.y | 0;
        const plane = spawn.plane | 0;
        if (plane > (sceneBuildInput.maxLevel | 0)) {
            continue;
        }
        const spawnMapX = Math.floor(x / MAP_SQUARE_SIZE) | 0;
        const spawnMapY = Math.floor(y / MAP_SQUARE_SIZE) | 0;
        if (
            spawnMapX < (bounds.mapStartX | 0) ||
            spawnMapX >= (bounds.mapEndX | 0) ||
            spawnMapY < (bounds.mapStartY | 0) ||
            spawnMapY >= (bounds.mapEndY | 0)
        ) {
            continue;
        }

        const mapId = (((spawnMapX | 0) & 0xff) << 8) | ((spawnMapY | 0) & 0xff);
        if (requiredSet && !requiredSet.has(mapId | 0)) {
            continue;
        }

        let entries = entriesByMapId.get(mapId);
        if (!entries) {
            entries = [];
            entriesByMapId.set(mapId, entries);
        }
        entries.push(spawn.id | 0, spawn.count | 0, x, y, plane);
    }
    if (entriesByMapId.size <= 0) {
        return undefined;
    }

    const sortedMapIds = Array.from(entriesByMapId.keys()).sort((a, b) => (a | 0) - (b | 0));
    const out = new Map<number, Uint8Array>();
    for (let i = 0; i < sortedMapIds.length; i++) {
        const mapId = sortedMapIds[i] | 0;
        const entries = entriesByMapId.get(mapId);
        if (!entries || entries.length <= 0) {
            continue;
        }
        const packed = Int32Array.from(entries);
        const bytes = new Uint8Array(packed.byteLength);
        bytes.set(new Uint8Array(packed.buffer));
        out.set(mapId | 0, bytes);
    }
    return out.size > 0 ? out : undefined;
}

function createSceneBuildCacheProviderForBuild(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): SceneBuildCacheProvider {
    const baseProvider = sceneBuildInput.cacheProvider;
    let objSpawnBytesByMapId: ReadonlyMap<number, Uint8Array> | undefined | null = undefined;
    return {
        tryGetBlobBytes: (domain, group, file) => {
            const d = domain | 0;
            const g = group | 0;
            const f = file | 0;
            if (d === RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS && g === 0) {
                if (objSpawnBytesByMapId === undefined) {
                    objSpawnBytesByMapId =
                        createObjSpawnBytesByMapIdForBuild(sceneBuildInput) ?? null;
                }
                return objSpawnBytesByMapId ? objSpawnBytesByMapId.get(f) : undefined;
            }
            return baseProvider.tryGetBlobBytes(d, g, f);
        },
    };
}

type BlobBatchBuilder = {
    groups: number[];
    files: number[];
    offsets: number[];
    lengths: number[];
    chunks: Uint8Array[];
    totalBytes: number;
};

type FinalizedBlobBatch = Readonly<{
    groups: Int32Array;
    files: Int32Array;
    offsets: Int32Array;
    lengths: Int32Array;
    bytes: Uint8Array;
}>;

function createBlobBatchBuilder(): BlobBatchBuilder {
    return {
        groups: [],
        files: [],
        offsets: [],
        lengths: [],
        chunks: [],
        totalBytes: 0,
    };
}

function addBlobBatchEntry(
    builder: BlobBatchBuilder,
    group: number,
    file: number,
    bytes: Uint8Array | undefined,
    allowEmpty = false,
): void {
    if (!(bytes instanceof Uint8Array) || bytes.length <= 0) {
        if (allowEmpty) {
            builder.groups.push(group | 0);
            builder.files.push(file | 0);
            builder.offsets.push(builder.totalBytes);
            builder.lengths.push(0);
        }
        return;
    }
    builder.groups.push(group | 0);
    builder.files.push(file | 0);
    builder.offsets.push(builder.totalBytes);
    builder.lengths.push(bytes.length | 0);
    builder.chunks.push(bytes);
    builder.totalBytes += bytes.length | 0;
}

function finalizeBlobBatch(builder: BlobBatchBuilder): FinalizedBlobBatch | undefined {
    if (builder.groups.length <= 0) {
        return undefined;
    }
    const bytes = new Uint8Array(builder.totalBytes);
    let offset = 0;
    for (let i = 0; i < builder.chunks.length; i++) {
        const chunk = builder.chunks[i];
        bytes.set(chunk, offset);
        offset += chunk.length | 0;
    }
    return {
        groups: Int32Array.from(builder.groups),
        files: Int32Array.from(builder.files),
        offsets: Int32Array.from(builder.offsets),
        lengths: Int32Array.from(builder.lengths),
        bytes,
    };
}

export class WasmCacheUploader {
    reset(): void {
        // No-op: texture lists are no longer uploaded. Texture SD/transparent classification is
        // determined inside the runtime from per-texture definition bytes (kind=4, domain=104).
    }

    async uploadMissingBlobEntriesForBuildRequest(
        bridge: MapRenderRuntimeBridgeV2,
        runtimeHandle: MapRenderRuntimeHandle,
        missing: MapRenderRuntimeMissingBlobEntries,
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<boolean> {
        const feeder = createRuntimeCacheFeeder(bridge, runtimeHandle);
        const provider = createSceneBuildCacheProviderForBuild(sceneBuildInput);
        const domains = missing.domains;
        const groups = missing.groups;
        const files = missing.files;
        const n = domains.length | 0;
        if ((groups.length | 0) !== n || (files.length | 0) !== n) {
            return false;
        }

        // Group missing entries by domain+group for stable batching.
        const byDomain = new Map<number, Map<number, Set<number>>>();
        let unsatisfiedCount = 0;
        let unsatisfiedPreview:
            | Readonly<{ domain: number; group: number; file: number }>
            | undefined = undefined;
        for (let i = 0; i < n; i++) {
            const domain = domains[i] | 0;
            const group = groups[i] | 0;
            const file = files[i] | 0;

            // Fail fast if we can't satisfy the runtime's request; otherwise we'd just spin passes.
            // (The actual upload batching below will fetch bytes again; this is just a guard.)
            const allowEmpty = domain === RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_DEF && group === 0;
            const maybe = provider.tryGetBlobBytes(domain, group, file);
            if ((!maybe || maybe.length <= 0) && !allowEmpty) {
                unsatisfiedCount++;
                if (!unsatisfiedPreview) {
                    unsatisfiedPreview = { domain, group, file };
                }
                continue;
            }

            let byGroup = byDomain.get(domain);
            if (!byGroup) {
                byGroup = new Map<number, Set<number>>();
                byDomain.set(domain, byGroup);
            }
            let fileSet = byGroup.get(group);
            if (!fileSet) {
                fileSet = new Set<number>();
                byGroup.set(group, fileSet);
            }
            fileSet.add(file | 0);
        }

        if (unsatisfiedCount > 0) {
            const preview = unsatisfiedPreview ?? { domain: -1, group: -1, file: -1 };
            console.warn(
                `[runtime-cache-v2] cannot satisfy ${unsatisfiedCount} missing blobs ` +
                    `(first: domain=${preview.domain} group=${preview.group} file=${preview.file})`,
            );
            return false;
        }

        for (const [domain, byGroup] of byDomain.entries()) {
            const sortedGroups = Array.from(byGroup.keys()).sort((a, b) => (a | 0) - (b | 0));
            const batch = createBlobBatchBuilder();

            for (let gi = 0; gi < sortedGroups.length; gi++) {
                const group = sortedGroups[gi] | 0;
                const set = byGroup.get(group);
                if (!set) continue;
                const sortedFiles = Array.from(set.values()).sort((a, b) => (a | 0) - (b | 0));
                for (let fi = 0; fi < sortedFiles.length; fi++) {
                    const file = sortedFiles[fi] | 0;
                    const bytes = provider.tryGetBlobBytes(domain, group, file);
                    addBlobBatchEntry(
                        batch,
                        group,
                        file,
                        bytes,
                        domain === RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_DEF && group === 0,
                    );
                }
            }

            const finalized = finalizeBlobBatch(batch);
            if (!finalized) {
                continue;
            }

            const ok = await feeder.putBlobBatch(
                domain,
                finalized.groups,
                finalized.files,
                finalized.offsets,
                finalized.lengths,
                finalized.bytes,
            );
            if (!ok) {
                return false;
            }
        }

        return true;
    }

    async uploadRuntimeCacheForBuildRequest(
        bridge: MapRenderRuntimeBridgeV2,
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<boolean> {
        const fail = (
            stage: string,
            detail?: Readonly<Record<string, number | boolean | string | undefined>>,
        ): false => {
            console.warn("[runtime-cache-v2] upload base failed", {
                stage,
                runtimeHandle: runtimeHandle | 0,
                mapX: request.mapX | 0,
                mapY: request.mapY | 0,
                borderSize: request.borderSize | 0,
                sizeX: request.sizeX | 0,
                sizeY: request.sizeY | 0,
                ...detail,
            });
            return false;
        };
        const feeder = createRuntimeCacheFeeder(bridge, runtimeHandle);
        if (!(await feeder.setBuildConfig(request))) return fail("setBuildConfig");
        if (!(await feeder.setVarps(sceneBuildInput.varpValues)))
            return fail("setVarps", { varpCount: sceneBuildInput.varpValues.length | 0 });
        if (!(await feeder.clearBlobDomain(RUNTIME_BLOB_DOMAIN_MAP_SQUARE)))
            return fail("clearMapSquareDomain", { domain: RUNTIME_BLOB_DOMAIN_MAP_SQUARE });
        const provider = createSceneBuildCacheProviderForBuild(sceneBuildInput);
        const bounds = computeSceneBuildMapBounds(
            sceneBuildInput.baseX | 0,
            sceneBuildInput.baseY | 0,
            sceneBuildInput.sizeX | 0,
            sceneBuildInput.sizeY | 0,
        );
        const mapSquareBatch = createBlobBatchBuilder();
        for (let mapX = bounds.mapStartX; mapX < bounds.mapEndX; mapX++) {
            for (let mapY = bounds.mapStartY; mapY < bounds.mapEndY; mapY++) {
                const mapId = (((mapX | 0) & 0xff) << 8) | ((mapY | 0) & 0xff);
                addBlobBatchEntry(
                    mapSquareBatch,
                    mapId,
                    RUNTIME_BLOB_MAP_SQUARE_FILE_TERRAIN,
                    provider.tryGetBlobBytes(
                        RUNTIME_BLOB_DOMAIN_MAP_SQUARE,
                        mapId,
                        RUNTIME_BLOB_MAP_SQUARE_FILE_TERRAIN,
                    ),
                );
                addBlobBatchEntry(
                    mapSquareBatch,
                    mapId,
                    RUNTIME_BLOB_MAP_SQUARE_FILE_LOC,
                    provider.tryGetBlobBytes(
                        RUNTIME_BLOB_DOMAIN_MAP_SQUARE,
                        mapId,
                        RUNTIME_BLOB_MAP_SQUARE_FILE_LOC,
                    ),
                );
                addBlobBatchEntry(
                    mapSquareBatch,
                    mapId,
                    RUNTIME_BLOB_MAP_SQUARE_FILE_NPC,
                    provider.tryGetBlobBytes(
                        RUNTIME_BLOB_DOMAIN_MAP_SQUARE,
                        mapId,
                        RUNTIME_BLOB_MAP_SQUARE_FILE_NPC,
                    ),
                );
            }
        }
        const finalizedMapSquareBatch = finalizeBlobBatch(mapSquareBatch);
        if (!finalizedMapSquareBatch) {
            return fail("mapSquareBatch.empty", {
                mapStartX: bounds.mapStartX | 0,
                mapStartY: bounds.mapStartY | 0,
                mapEndX: bounds.mapEndX | 0,
                mapEndY: bounds.mapEndY | 0,
            });
        }
        const okBatch = await feeder.putBlobBatch(
            RUNTIME_BLOB_DOMAIN_MAP_SQUARE,
            finalizedMapSquareBatch.groups,
            finalizedMapSquareBatch.files,
            finalizedMapSquareBatch.offsets,
            finalizedMapSquareBatch.lengths,
            finalizedMapSquareBatch.bytes,
        );
        if (!okBatch) {
            return fail("mapSquareBatch.putBlobBatch", {
                domain: RUNTIME_BLOB_DOMAIN_MAP_SQUARE,
                entryCount: finalizedMapSquareBatch.groups.length | 0,
                payloadBytes: finalizedMapSquareBatch.bytes.length | 0,
            });
        }
        if (!(await feeder.clearBlobDomain(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS)))
            return fail("clearObjSpawnDomain", {
                domain: RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS,
            });
        {
            const objSpawnBatch = createBlobBatchBuilder();

            for (let mapX = bounds.mapStartX; mapX < bounds.mapEndX; mapX++) {
                for (let mapY = bounds.mapStartY; mapY < bounds.mapEndY; mapY++) {
                    const mapId = (((mapX | 0) & 0xff) << 8) | ((mapY | 0) & 0xff);
                    const spawnBytes = provider.tryGetBlobBytes(
                        RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS,
                        0,
                        mapId,
                    );
                    addBlobBatchEntry(objSpawnBatch, 0, mapId, spawnBytes);
                }
            }

            const finalizedObjSpawnBatch = finalizeBlobBatch(objSpawnBatch);
            if (finalizedObjSpawnBatch) {
                const ok = await feeder.putBlobBatch(
                    RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS,
                    finalizedObjSpawnBatch.groups,
                    finalizedObjSpawnBatch.files,
                    finalizedObjSpawnBatch.offsets,
                    finalizedObjSpawnBatch.lengths,
                    finalizedObjSpawnBatch.bytes,
                );
                if (!ok) {
                    return fail("objSpawnBatch.putBlobBatch", {
                        domain: RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS,
                        entryCount: finalizedObjSpawnBatch.groups.length | 0,
                        payloadBytes: finalizedObjSpawnBatch.bytes.length | 0,
                    });
                }
            }
        }
        return true;
    }

    async prepareAndBuildMapPacketFromCacheDetailed(
        bridge: MapRenderRuntimeBridgeV2,
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
        maxPasses = 12,
    ): Promise<MapRenderRuntimePrepareResult & Readonly<{ packet?: MapRenderRuntimePacket }>> {
        const uploadMissingOrGetFailure = async (
            status: number,
            passIndex: number,
            missing: MapRenderRuntimeMissingBlobEntries | undefined,
        ): Promise<
            | (MapRenderRuntimePrepareResult & Readonly<{ packet?: MapRenderRuntimePacket }>)
            | undefined
        > => {
            if (!missing) {
                return undefined;
            }
            const missingCount = missing.domains.length | 0;
            if (missingCount <= 0) {
                return undefined;
            }
            const okMissing = await this.uploadMissingBlobEntriesForBuildRequest(
                bridge,
                runtimeHandle,
                missing,
                sceneBuildInput,
            );
            if (okMissing) {
                return undefined;
            }
            return {
                ok: false,
                reason: "upload_missing_failed",
                status,
                passesTried: (passIndex + 1) | 0,
                missingCount,
                lastBuildFailure: await bridge.debugGetLastBuildFailure?.(runtimeHandle),
            };
        };

        const uploadedBase = await this.uploadRuntimeCacheForBuildRequest(
            bridge,
            runtimeHandle,
            request,
            sceneBuildInput,
        );
        if (!uploadedBase) {
            return {
                ok: false,
                reason: "upload_base_failed",
                status: MAP_RENDER_RUNTIME_STATUS_INVALID_ARG,
                passesTried: 0,
                missingCount: 0,
            };
        }

        const passes = Math.max(1, maxPasses | 0);
        let lastStatus = MAP_RENDER_RUNTIME_STATUS_NOT_FOUND;
        for (let pass = 0; pass < passes; pass++) {
            let status = MAP_RENDER_RUNTIME_STATUS_OK;
            const hasProbe = typeof bridge.probeBuildMapPacketFromCacheStatus === "function";
            let packet: MapRenderRuntimePacket | undefined;
            if (hasProbe) {
                status =
                    (await bridge.probeBuildMapPacketFromCacheStatus(runtimeHandle, request)) | 0;
            } else {
                packet = await bridge.buildMapPacketFromCache(runtimeHandle, request);
                status = packet
                    ? MAP_RENDER_RUNTIME_STATUS_OK
                    : MAP_RENDER_RUNTIME_STATUS_NOT_FOUND;
            }
            lastStatus = status | 0;

            const missing = await bridge.getLastMissingBlobEntries(runtimeHandle);
            const missingFailure = await uploadMissingOrGetFailure(status, pass, missing);
            if (missingFailure) {
                return missingFailure;
            }
            if (missing && (missing.domains.length | 0) > 0) {
                continue;
            }

            if (status === MAP_RENDER_RUNTIME_STATUS_OK) {
                if (!packet) {
                    packet = await bridge.buildMapPacketFromCache(runtimeHandle, request);
                    if (!packet) {
                        return {
                            ok: false,
                            reason: "status_non_ok",
                            status,
                            passesTried: (pass + 1) | 0,
                            missingCount: 0,
                            lastBuildFailure:
                                await bridge.debugGetLastBuildFailure?.(runtimeHandle),
                        };
                    }
                    const missingAfterBuild = await bridge.getLastMissingBlobEntries(runtimeHandle);
                    const missingAfterBuildFailure = await uploadMissingOrGetFailure(
                        status,
                        pass,
                        missingAfterBuild,
                    );
                    if (missingAfterBuildFailure) {
                        return missingAfterBuildFailure;
                    }
                    if (missingAfterBuild && (missingAfterBuild.domains.length | 0) > 0) {
                        continue;
                    }
                }
                return {
                    ok: true,
                    reason: "ok",
                    status,
                    passesTried: (pass + 1) | 0,
                    missingCount: 0,
                    packet,
                };
            }

            // Some bridge/probe versions can report non-OK without surfacing missing blob
            // entries. Fall back to one full build attempt to surface missing blobs (or to
            // confirm a successful build).
            if (hasProbe) {
                packet = await bridge.buildMapPacketFromCache(runtimeHandle, request);
                if (packet) {
                    const missingAfterBuild = await bridge.getLastMissingBlobEntries(runtimeHandle);
                    const missingAfterBuildFailure = await uploadMissingOrGetFailure(
                        status,
                        pass,
                        missingAfterBuild,
                    );
                    if (missingAfterBuildFailure) {
                        return missingAfterBuildFailure;
                    }
                    if (missingAfterBuild && (missingAfterBuild.domains.length | 0) > 0) {
                        continue;
                    }
                    return {
                        ok: true,
                        reason: "ok",
                        status: MAP_RENDER_RUNTIME_STATUS_OK,
                        passesTried: (pass + 1) | 0,
                        missingCount: 0,
                        packet,
                    };
                }
                const missingAfterBuild = await bridge.getLastMissingBlobEntries(runtimeHandle);
                const missingAfterBuildFailure = await uploadMissingOrGetFailure(
                    status,
                    pass,
                    missingAfterBuild,
                );
                if (missingAfterBuildFailure) {
                    return missingAfterBuildFailure;
                }
                if (missingAfterBuild && (missingAfterBuild.domains.length | 0) > 0) {
                    continue;
                }
            }
            return {
                ok: false,
                reason: "status_non_ok",
                status,
                passesTried: (pass + 1) | 0,
                missingCount: 0,
                lastBuildFailure: await bridge.debugGetLastBuildFailure?.(runtimeHandle),
            };
        }

        return {
            ok: false,
            reason: "max_passes_exhausted",
            status: lastStatus | 0,
            passesTried: passes | 0,
            missingCount: 0,
            lastBuildFailure: await bridge.debugGetLastBuildFailure?.(runtimeHandle),
        };
    }
}
