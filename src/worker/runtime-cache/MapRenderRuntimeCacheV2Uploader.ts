import type { ObjSpawn } from "../../data/obj/ObjSpawn";
import { SdMapLoaderInput } from "../../renderer/loader/SdMapLoaderInput";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { Scene } from "../../rs/scene/Scene";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeHandle,
    MapRenderRuntimeMapSquareEntry,
    MapRenderRuntimeMissingBlobEntries,
} from "../../wasm/MapRenderRuntimeBridgeAbi";

const RUNTIME_STATUS_OK = 1;

type RuntimeCacheFeeder = Readonly<{
    setBuildConfig(request: MapRenderRuntimeBuildRequest): Promise<boolean>;
    setVarps(varps: Int32Array): Promise<boolean>;
    putBlob(domain: number, group: number, file: number, bytes: Uint8Array): Promise<boolean>;
    putBlobBatch(
        domain: number,
        groups: Int32Array,
        files: Int32Array,
        offsets: Int32Array,
        lengths: Int32Array,
        bytes: Uint8Array,
    ): Promise<boolean>;
    clearBlobDomain(domain: number): Promise<boolean>;
    clearAllBlobs(): Promise<boolean>;
}>;

function createRuntimeCacheFeeder(
    bridge: MapRenderRuntimeBridgeV2,
    runtimeHandle: MapRenderRuntimeHandle,
): RuntimeCacheFeeder {
    return {
        setBuildConfig: async (request: MapRenderRuntimeBuildRequest) => {
            return (await bridge.cacheSetBuildConfig(runtimeHandle, request)) === RUNTIME_STATUS_OK;
        },
        setVarps: async (varps: Int32Array) => {
            return (await bridge.cacheSetVarps(runtimeHandle, varps)) === RUNTIME_STATUS_OK;
        },
        putBlob: async (domain: number, group: number, file: number, bytes: Uint8Array) => {
            return (
                (await bridge.cachePutBlobBatch(
                    runtimeHandle,
                    domain | 0,
                    Int32Array.of(group | 0),
                    Int32Array.of(file | 0),
                    Int32Array.of(0),
                    Int32Array.of(bytes.length | 0),
                    bytes,
                )) === RUNTIME_STATUS_OK
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
                )) === RUNTIME_STATUS_OK
            );
        },
        clearBlobDomain: async (domain: number) => {
            return (await bridge.cacheClearBlobDomain(runtimeHandle, domain | 0)) === RUNTIME_STATUS_OK;
        },
        clearAllBlobs: async () => {
            return (await bridge.cacheClearAllBlobs(runtimeHandle)) === RUNTIME_STATUS_OK;
        },
    };
}

const SD_TEXTURE_PACK_LIMIT = 2047;

function sortedUniqueTypeIds(ids: ReadonlyArray<number> | undefined): number[] {
    if (!Array.isArray(ids) || ids.length <= 0) {
        return [];
    }
    return Array.from(new Set(ids.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
}

function splitRequiredTypeEntryIdsByDomain(
    required: MapRenderRuntimeMissingBlobEntries,
): ReadonlyMap<number, ReadonlyArray<number>> {
    const out = new Map<number, number[]>();
    const domains = required.domains;
    const groups = required.groups;
    const files = required.files;
    const n = domains.length | 0;
    if ((groups.length | 0) !== n || (files.length | 0) !== n) {
        return out;
    }
    for (let i = 0; i < n; i++) {
        const domain = domains[i] | 0;
        const group = groups[i] | 0;
        const file = files[i] | 0;
        // Type-entry blobs use the convention (domain=100+kind, group=0, file=id).
        if (group !== 0 || file < 0) {
            continue;
        }
        let ids = out.get(domain);
        if (!ids) {
            ids = [];
            out.set(domain, ids);
        }
        ids.push(file);
    }
    // Normalize to sorted+unique for stable iteration and fewer uploads.
    for (const [domain, ids] of out.entries()) {
        out.set(domain, sortedUniqueTypeIds(ids));
    }
    return out;
}

function toUint8ArrayView(data: unknown): Uint8Array | undefined {
    if (data instanceof Uint8Array) {
        return data;
    }
    if (data instanceof Int8Array) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return undefined;
}

function tryLoadDecoded(loader: unknown, id: number): unknown {
    if (!loader || typeof loader !== "object") {
        return undefined;
    }
    const withTryLoad = loader as { tryLoad?: (id: number) => unknown };
    if (typeof withTryLoad.tryLoad !== "function") {
        return undefined;
    }
    try {
        const result = withTryLoad.tryLoad(id | 0) as { ok?: boolean; value?: unknown } | undefined;
        if (result?.ok) {
            return result.value;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function tryLoadTypeBytes(loader: unknown, id: number): Uint8Array | undefined {
    if (!loader || typeof loader !== "object") {
        return undefined;
    }
    const withTryLoadBytes = loader as { tryLoadBytes?: (id: number) => unknown };
    if (typeof withTryLoadBytes.tryLoadBytes === "function") {
        try {
            const bytes = toUint8ArrayView(withTryLoadBytes.tryLoadBytes(id | 0));
            if (bytes) {
                return bytes;
            }
        } catch {
            // ignore
        }
    }
    return undefined;
}

function tryGetVarbitLoader(varProvider: unknown): unknown {
    if (!varProvider || typeof varProvider !== "object") {
        return undefined;
    }
    const managerVarbitLoader = (varProvider as { varManager?: { varbitLoader?: unknown } }).varManager
        ?.varbitLoader;
    if (managerVarbitLoader && typeof (managerVarbitLoader as { tryLoad?: unknown }).tryLoad === "function") {
        return managerVarbitLoader;
    }
    const directVarbitLoader = (varProvider as { varbitLoader?: unknown }).varbitLoader;
    if (directVarbitLoader && typeof (directVarbitLoader as { tryLoad?: unknown }).tryLoad === "function") {
        return directVarbitLoader;
    }
    return undefined;
}

function tryGetSkeletalSeqFromLoader(skeletalSeqLoader: unknown, seqId: number): unknown {
    if (!skeletalSeqLoader || seqId < 0 || typeof skeletalSeqLoader !== "object") {
        return undefined;
    }
    const withTryGet = skeletalSeqLoader as { tryGet?: (id: number) => unknown };
    if (typeof withTryGet.tryGet === "function") {
        try {
            const seq = withTryGet.tryGet(seqId | 0) as { ok?: boolean; value?: unknown } | undefined;
            if (seq?.ok) {
                return seq.value;
            }
            if (seq && typeof seq === "object" && !("ok" in seq)) {
                return seq;
            }
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function tryGetSeqFrameFromLoader(seqFrameLoader: unknown, frameId: number): unknown {
    if (!seqFrameLoader || frameId < 0 || typeof seqFrameLoader !== "object") {
        return undefined;
    }
    const withTryGet = seqFrameLoader as { tryGet?: (id: number) => unknown };
    if (typeof withTryGet.tryGet === "function") {
        try {
            const frame = withTryGet.tryGet(frameId | 0) as { ok?: boolean; value?: unknown } | undefined;
            if (frame?.ok) {
                return frame.value;
            }
            if (frame && typeof frame === "object" && !("ok" in frame)) {
                return frame;
            }
        } catch {
            // fall through to tryLoad path
        }
    }
    const withTryLoad = seqFrameLoader as { tryLoad?: (id: number) => unknown };
    if (typeof withTryLoad.tryLoad === "function") {
        try {
            const loaded = withTryLoad.tryLoad(frameId | 0) as { ok?: boolean; value?: unknown } | undefined;
            if (loaded?.ok) {
                return loaded.value;
            }
            if (loaded && typeof loaded === "object" && !("ok" in loaded)) {
                return loaded;
            }
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function getFrameIdsArrayLike(seqType: unknown): ArrayLike<number> | undefined {
    if (!seqType || typeof seqType !== "object") {
        return undefined;
    }
    const frameIds = (seqType as { frameIds?: unknown }).frameIds;
    if (Array.isArray(frameIds)) {
        return frameIds;
    }
    if (
        frameIds &&
        typeof frameIds === "object" &&
        typeof (frameIds as { length?: unknown }).length === "number"
    ) {
        return frameIds as ArrayLike<number>;
    }
    return undefined;
}

type SceneBuildCacheByteProvider = Readonly<{
    tryGetLocTypeBytes(id: number): Uint8Array | undefined;
    tryGetLocTypeDecoded(id: number): unknown;
    tryGetObjTypeBytes(id: number): Uint8Array | undefined;
    tryGetNpcTypeBytes(id: number): Uint8Array | undefined;
    tryGetBasTypeBytes(id: number): Uint8Array | undefined;
    tryGetUnderlayTypeBytes(id: number): Uint8Array | undefined;
    tryGetOverlayTypeBytes(id: number): Uint8Array | undefined;
    tryGetVarbitTypeBytes(id: number): Uint8Array | undefined;
    tryGetModelBytes(id: number): Uint8Array | undefined;
    tryGetSeqTypeBytes(id: number): Uint8Array | undefined;
    tryGetSeqTypeDecoded(id: number): unknown;
    tryGetSeqFrameBytes(id: number): Uint8Array | undefined;
    tryGetSeqFrameDecoded(id: number): unknown;
    tryGetSkeletalSeqBytes(id: number): Uint8Array | undefined;
    tryGetSkeletalSeqDecoded(id: number): unknown;
    tryGetSeqBaseBytes(id: number): Uint8Array | undefined;
    collectTextureIds(): ReadonlyArray<number>;
    isTextureTransparent(id: number): boolean;
    isTextureSd(id: number): boolean;
}>;

function createSceneBuildCacheByteProvider(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): SceneBuildCacheByteProvider {
    const locTypeLoader = sceneBuildInput.locTypeLoader;
    const objTypeLoader = sceneBuildInput.objTypeLoader;
    const npcTypeLoader = sceneBuildInput.npcTypeLoader;
    const basTypeLoader = sceneBuildInput.basTypeLoader;
    const underlayTypeLoader = sceneBuildInput.underlayTypeLoader;
    const overlayTypeLoader = sceneBuildInput.overlayTypeLoader;
    const varbitLoader = tryGetVarbitLoader(sceneBuildInput.varProvider);
    const locModelLoader = sceneBuildInput.locModelLoader as
        | {
              modelLoader?: unknown;
              textureLoader?: unknown;
              seqTypeLoader?: unknown;
              seqFrameLoader?: unknown;
              skeletalSeqLoader?: unknown;
          }
        | undefined;
    const modelLoader = locModelLoader?.modelLoader;
    const textureLoader = (sceneBuildInput.textureLoader ??
        locModelLoader?.textureLoader) as
        | {
              getTextureIds?: () => number[];
              isSd?: (id: number) => boolean;
              isTransparent?: (id: number) => boolean;
          }
        | undefined;
    const seqTypeLoader = sceneBuildInput.seqTypeLoader ?? locModelLoader?.seqTypeLoader;
    const seqFrameLoader = sceneBuildInput.seqFrameLoader ?? locModelLoader?.seqFrameLoader;
    const skeletalSeqLoader = sceneBuildInput.skeletalSeqLoader ?? locModelLoader?.skeletalSeqLoader;
    const seqBaseLoader =
        (skeletalSeqLoader as { baseLoader?: unknown } | undefined)?.baseLoader ??
        (seqFrameLoader as { baseLoader?: unknown } | undefined)?.baseLoader;

    return {
        tryGetLocTypeBytes: (id) => tryLoadTypeBytes(locTypeLoader, id),
        tryGetLocTypeDecoded: (id) => tryLoadDecoded(locTypeLoader, id),
        tryGetObjTypeBytes: (id) => tryLoadTypeBytes(objTypeLoader, id),
        tryGetNpcTypeBytes: (id) => tryLoadTypeBytes(npcTypeLoader, id),
        tryGetBasTypeBytes: (id) => tryLoadTypeBytes(basTypeLoader, id),
        tryGetUnderlayTypeBytes: (id) => tryLoadTypeBytes(underlayTypeLoader, id),
        tryGetOverlayTypeBytes: (id) => tryLoadTypeBytes(overlayTypeLoader, id),
        tryGetVarbitTypeBytes: (id) => tryLoadTypeBytes(varbitLoader, id),
        tryGetModelBytes: (id) => tryLoadTypeBytes(modelLoader, id),
        tryGetSeqTypeBytes: (id) => tryLoadTypeBytes(seqTypeLoader, id),
        tryGetSeqTypeDecoded: (id) => tryLoadDecoded(seqTypeLoader, id),
        tryGetSeqFrameBytes: (id) => tryLoadTypeBytes(seqFrameLoader, id),
        tryGetSeqFrameDecoded: (id) => tryGetSeqFrameFromLoader(seqFrameLoader, id),
        tryGetSkeletalSeqBytes: (id) => tryLoadTypeBytes(skeletalSeqLoader, id),
        tryGetSkeletalSeqDecoded: (id) => tryGetSkeletalSeqFromLoader(skeletalSeqLoader, id),
        tryGetSeqBaseBytes: (id) => tryLoadTypeBytes(seqBaseLoader, id),
        collectTextureIds: () => {
            if (!textureLoader || typeof textureLoader.getTextureIds !== "function") return [];
            try {
                const ids = textureLoader.getTextureIds();
                return Array.isArray(ids) ? ids : [];
            } catch {
                return [];
            }
        },
        isTextureTransparent: (id) =>
            !!textureLoader &&
            typeof textureLoader.isTransparent === "function" &&
            textureLoader.isTransparent(id | 0),
        isTextureSd: (id) =>
            !!textureLoader && typeof textureLoader.isSd === "function" && textureLoader.isSd(id | 0),
    };
}

function collectAugmentedSeqTypeIds(args: Readonly<{
    provider: SceneBuildCacheByteProvider;
    expanded: Readonly<{
        seqTypeIds?: ReadonlyArray<number>;
        locTypeIds?: ReadonlyArray<number>;
    }>;
}>): number[] {
    const { provider, expanded } = args;
    const out = new Set<number>(sortedUniqueTypeIds(expanded.seqTypeIds as number[] | undefined));
    const locTypeIds = sortedUniqueTypeIds(expanded.locTypeIds as number[] | undefined);
    for (let i = 0; i < locTypeIds.length; i++) {
        const locType = provider.tryGetLocTypeDecoded(locTypeIds[i] | 0) as
            | { seqId?: number; randomSeqIds?: number[] }
            | undefined;
        if (!locType) {
            continue;
        }
        const seqId = (locType.seqId ?? -1) | 0;
        if (seqId >= 0) {
            out.add(seqId);
        }
        const randomSeqIds = Array.isArray(locType.randomSeqIds) ? locType.randomSeqIds : [];
        for (let j = 0; j < randomSeqIds.length; j++) {
            const randomSeqId = randomSeqIds[j] | 0;
            if (randomSeqId >= 0) {
                out.add(randomSeqId);
            }
        }
    }
    return sortedUniqueTypeIds(Array.from(out));
}

function collectSeqFrameIdsForSeqTypes(args: Readonly<{
    provider: SceneBuildCacheByteProvider;
    seqTypeIds: ReadonlyArray<number> | undefined;
}>): number[] {
    const { provider, seqTypeIds } = args;
    const out = new Set<number>();
    const sortedSeqTypeIds = sortedUniqueTypeIds(seqTypeIds);
    for (let i = 0; i < sortedSeqTypeIds.length; i++) {
        const seqType = provider.tryGetSeqTypeDecoded(sortedSeqTypeIds[i] | 0) as
            | { frameIds?: unknown }
            | undefined;
        const frameIds = getFrameIdsArrayLike(seqType);
        const frameCount = frameIds ? (frameIds.length | 0) : 0;
        for (let j = 0; j < frameCount; j++) {
            const frameId = Number(frameIds![j]) | 0;
            if (frameId >= 0) {
                out.add(frameId);
            }
        }
    }
    return sortedUniqueTypeIds(Array.from(out));
}

type DerivedTypeUploadPlan = Readonly<{
    seqAlphaHintBytesById: ReadonlyMap<number, Uint8Array>;
    transparentTextureIds: number[];
    sdTextureIds: number[];
}>;

function buildDerivedTypeUploadPlan(args: Readonly<{
    provider: SceneBuildCacheByteProvider;
    expanded: Readonly<{
        seqTypeIds?: ReadonlyArray<number>;
    }>;
}>): DerivedTypeUploadPlan {
    const { provider, expanded } = args;
    const seqTypeIds = sortedUniqueTypeIds(expanded.seqTypeIds as number[] | undefined);

    const transparentTextureIds: number[] = [];
    const sdTextureIds: number[] = [];
    const allTextureIds = provider.collectTextureIds();
    for (let i = 0; i < allTextureIds.length; i++) {
        const textureId = allTextureIds[i] | 0;
        if (textureId < 0) continue;
        if (provider.isTextureTransparent(textureId)) {
            transparentTextureIds.push(textureId);
        }
        if (provider.isTextureSd(textureId) && sdTextureIds.length < SD_TEXTURE_PACK_LIMIT) {
            sdTextureIds.push(textureId);
        }
    }

    const seqAlphaHintBytesById = new Map<number, Uint8Array>();
    for (let i = 0; i < seqTypeIds.length; i++) {
        const seqId = seqTypeIds[i] | 0;
        const seqType = provider.tryGetSeqTypeDecoded(seqId) as
            | { hasAnimMayaSeq?: () => boolean; animMayaId?: number; frameIds?: unknown }
            | undefined;
        let hasAlphaTransform = false;
        if (seqType) {
            const hasAnimMaya =
                typeof seqType.hasAnimMayaSeq === "function"
                    ? (() => {
                          try {
                              return seqType.hasAnimMayaSeq() === true;
                          } catch {
                              return (seqType.animMayaId ?? -1) >= 0;
                          }
                      })()
                    : (seqType.animMayaId ?? -1) >= 0;
            if (hasAnimMaya) {
                const animMayaId = (seqType.animMayaId ?? -1) | 0;
                const skeletalSeq = provider.tryGetSkeletalSeqDecoded(animMayaId) as
                    | { hasAlphaTransform?: boolean }
                    | undefined;
                hasAlphaTransform = skeletalSeq?.hasAlphaTransform === true;
            } else {
                const frameIds = getFrameIdsArrayLike(seqType);
                const frameCount = frameIds ? (frameIds.length | 0) : 0;
                for (let f = 0; f < frameCount; f++) {
                    const frameId = Number(frameIds![f]) | 0;
                    const seqFrame = provider.tryGetSeqFrameDecoded(frameId) as
                        | { hasAlphaTransform?: boolean }
                        | undefined;
                    if (seqFrame?.hasAlphaTransform === true) {
                        hasAlphaTransform = true;
                        break;
                    }
                }
            }
        }
        seqAlphaHintBytesById.set(seqId, Uint8Array.of(hasAlphaTransform ? 1 : 0));
    }

    return {
        seqAlphaHintBytesById,
        transparentTextureIds: sortedUniqueTypeIds(transparentTextureIds),
        sdTextureIds: sortedUniqueTypeIds(sdTextureIds),
    };
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
    mapBytesProvider: MapBytesProvider;
    locTypeLoader: unknown;
    objTypeLoader?: unknown;
    locModelLoader: unknown;
    seqTypeLoader?: unknown;
    seqFrameLoader?: unknown;
    skeletalSeqLoader?: unknown;
    textureLoader?: unknown;
    npcTypeLoader?: unknown;
    basTypeLoader?: unknown;
    varProvider: unknown;
    underlayTypeLoader?: unknown;
    overlayTypeLoader?: unknown;
    objSpawns?: ReadonlyArray<ObjSpawn>;
    varpValues: Int32Array;
}>;

export type ByteDrivenSceneBuildInputDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    locTypeLoader: unknown;
    objTypeLoader?: unknown;
    locModelLoader: unknown;
    seqTypeLoader?: unknown;
    seqFrameLoader?: unknown;
    skeletalSeqLoader?: unknown;
    textureLoader?: unknown;
    npcTypeLoader?: unknown;
    basTypeLoader?: unknown;
    varProvider: unknown;
    underlayTypeLoader?: unknown;
    overlayTypeLoader?: unknown;
    objSpawns?: ReadonlyArray<ObjSpawn>;
    cacheGame: number;
    cacheRevision: number;
}>;

export function snapshotVarpValues(varProvider: unknown): Int32Array {
    const provider = varProvider as
        | {
              varManager?: { values?: Int32Array };
              values?: Int32Array;
          }
        | undefined;
    const managerValues = provider?.varManager?.values;
    if (managerValues instanceof Int32Array) {
        return new Int32Array(managerValues);
    }
    const directValues = provider?.values;
    if (directValues instanceof Int32Array) {
        return new Int32Array(directValues);
    }
    return new Int32Array(0);
}

export function createByteDrivenSceneBuildInput(
    input: SdMapLoaderInput,
    deps: ByteDrivenSceneBuildInputDeps,
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
        mapBytesProvider: deps.mapBytesProvider,
        locTypeLoader: deps.locTypeLoader,
        objTypeLoader: deps.objTypeLoader,
        locModelLoader: deps.locModelLoader,
        seqTypeLoader: deps.seqTypeLoader,
        seqFrameLoader: deps.seqFrameLoader,
        skeletalSeqLoader: deps.skeletalSeqLoader,
        textureLoader: deps.textureLoader,
        npcTypeLoader: deps.npcTypeLoader,
        basTypeLoader: deps.basTypeLoader,
        varProvider: deps.varProvider,
        underlayTypeLoader: deps.underlayTypeLoader,
        overlayTypeLoader: deps.overlayTypeLoader,
        objSpawns: deps.objSpawns,
        varpValues: snapshotVarpValues(deps.varProvider),
    };
}

const MAP_SQUARE_SIZE = 64;

// Preferred domains for blob-store-backed type entries: (domain=101..116, group=0, file=id).
// TS should treat these domains as opaque and operate only on blob keys.
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_LOC = 101;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_VARBIT = 102;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_MODEL = 103;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_TRANSPARENT = 104;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE = 105;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_FRAME = 106;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_NPC = 107;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_BAS = 108;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS = 109;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_UNDERLAY = 110;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY = 111;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ = 112;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS = 113;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_ALPHA_HINT = 114;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_BASE = 115;
const RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ = 116;
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

function toUint8View(data: unknown): Uint8Array | undefined {
    if (data instanceof Uint8Array) {
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return undefined;
}

function computeSceneBuildMapBounds(baseX: number, baseY: number, sizeX: number, sizeY: number) {
    return {
        mapStartX: Math.floor(baseX / MAP_SQUARE_SIZE),
        mapStartY: Math.floor(baseY / MAP_SQUARE_SIZE),
        mapEndX: Math.ceil((baseX + sizeX) / MAP_SQUARE_SIZE),
        mapEndY: Math.ceil((baseY + sizeY) / MAP_SQUARE_SIZE),
    };
}

function collectRuntimeCacheMapSquareEntries(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): ReadonlyArray<MapRenderRuntimeMapSquareEntry> | undefined {
    const mapBytesProvider = sceneBuildInput.mapBytesProvider;
    if (!mapBytesProvider) {
        return undefined;
    }
    const bounds = computeSceneBuildMapBounds(
        sceneBuildInput.baseX | 0,
        sceneBuildInput.baseY | 0,
        sceneBuildInput.sizeX | 0,
        sceneBuildInput.sizeY | 0,
    );

    const entries: MapRenderRuntimeMapSquareEntry[] = [];
    for (let mapX = bounds.mapStartX; mapX < bounds.mapEndX; mapX++) {
        for (let mapY = bounds.mapStartY; mapY < bounds.mapEndY; mapY++) {
            const terrainBytes = toUint8View(mapBytesProvider.getTerrainBytes(mapX, mapY));
            const locBytes = toUint8View(mapBytesProvider.getLocBytes(mapX, mapY));
            const npcBytes =
                typeof mapBytesProvider.getNpcSpawnBytes === "function"
                    ? toUint8View(mapBytesProvider.getNpcSpawnBytes(mapX, mapY))
                    : undefined;
            if (!terrainBytes && !locBytes && !npcBytes) {
                continue;
            }
            entries.push({
                mapX,
                mapY,
                terrainBytes,
                locBytes,
                npcBytes,
            });
        }
    }
    return entries;
}

function createObjSpawnTypeEntryBytesForBuild(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): Readonly<{ typeId: number; bytes: Uint8Array }> | undefined {
    if (sceneBuildInput.loadObjs !== true) {
        return undefined;
    }
    const objSpawns = Array.isArray(sceneBuildInput.objSpawns) ? sceneBuildInput.objSpawns : [];
    if (objSpawns.length <= 0) {
        return undefined;
    }
    const entries: number[] = [];
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
            spawnMapX !== (sceneBuildInput.mapX | 0) ||
            spawnMapY !== (sceneBuildInput.mapY | 0)
        ) {
            continue;
        }
        entries.push(spawn.id | 0, spawn.count | 0, x, y, plane);
    }
    if (entries.length <= 0) {
        return undefined;
    }
    const packed = Int32Array.from(entries);
    const bytes = new Uint8Array(packed.byteLength);
    bytes.set(new Uint8Array(packed.buffer));
    const mapId =
        (((sceneBuildInput.mapX | 0) & 0xff) << 8) | ((sceneBuildInput.mapY | 0) & 0xff);
    return { typeId: mapId | 0, bytes };
}

export class MapRenderRuntimeCacheV2Uploader {
    // Avoid re-uploading large dat seq-frame map blobs across retry passes.
    private readonly uploadedDatSeqFrameMapIds: Set<number> = new Set();
    private legacyModelFilesUploaded = false;
    private legacySeqFilesUploaded = false;

    reset(): void {
        this.uploadedDatSeqFrameMapIds.clear();
        this.legacyModelFilesUploaded = false;
        this.legacySeqFilesUploaded = false;
    }

    private async uploadLegacyModelFilesIfNeeded(
        feeder: RuntimeCacheFeeder,
        modelLoader: unknown,
        modelIds: ReadonlyArray<number> | undefined,
    ): Promise<Readonly<{ status: "not_legacy" | "ok" | "failed"; uploadedCount: number }>> {
        void modelIds;
        const loader = modelLoader as
            | {
                  tryGetLegacyModelFileBytes?: () => Readonly<{
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
              }
            | undefined;
        if (typeof loader?.tryGetLegacyModelFileBytes !== "function") {
            return { status: "not_legacy", uploadedCount: 0 };
        }
        if (this.legacyModelFilesUploaded) {
            return { status: "ok", uploadedCount: 0 };
        }

        let files:
            | Readonly<{
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
              }>
            | undefined = undefined;
        try {
            files = loader.tryGetLegacyModelFileBytes();
        } catch {
            files = undefined;
        }
        if (!files) {
            return { status: "failed", uploadedCount: 0 };
        }

        const uploads: Array<Readonly<[number, Uint8Array]>> = [
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_HEAD, files.headBytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE1, files.face1Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE2, files.face2Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE3, files.face3Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE4, files.face4Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_FACE5, files.face5Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT1, files.point1Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT2, files.point2Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT3, files.point3Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT4, files.point4Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_POINT5, files.point5Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_VERTEX1, files.vertex1Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_VERTEX2, files.vertex2Bytes],
            [RUNTIME_BLOB_LEGACY_MODEL_FILE_AXIS, files.axisBytes],
        ];
        for (let i = 0; i < uploads.length; i++) {
            const [fileId, bytes] = uploads[i];
            if (!(bytes instanceof Uint8Array) || bytes.length <= 0) {
                return { status: "failed", uploadedCount: 0 };
            }
            if (
                !(await feeder.putBlob(
                    RUNTIME_BLOB_DOMAIN_LEGACY_MODEL_FILES,
                    RUNTIME_BLOB_LEGACY_MODEL_GROUP_GLOBAL,
                    fileId,
                    bytes,
                ))
            ) {
                return { status: "failed", uploadedCount: 0 };
            }
        }

        this.legacyModelFilesUploaded = true;
        return { status: "ok", uploadedCount: uploads.length | 0 };
    }

    private async uploadLegacySeqFrameFilesIfNeeded(
        feeder: RuntimeCacheFeeder,
        seqFrameLoader: unknown,
        frameIds: ReadonlyArray<number> | undefined,
    ): Promise<Readonly<{ status: "not_legacy" | "ok" | "failed"; uploadedCount: number }>> {
        void frameIds;
        const loader = seqFrameLoader as
            | {
                  tryGetLegacySeqFrameFileBytes?: () => Readonly<{
                      baseHeadBytes: Uint8Array;
                      baseTypeBytes: Uint8Array;
                      baseLabelBytes: Uint8Array;
                      frameHeadBytes: Uint8Array;
                      frameTran1Bytes: Uint8Array;
                      frameTran2Bytes: Uint8Array;
                      frameDelBytes: Uint8Array;
                  }>;
              }
            | undefined;
        if (typeof loader?.tryGetLegacySeqFrameFileBytes !== "function") {
            return { status: "not_legacy", uploadedCount: 0 };
        }
        if (this.legacySeqFilesUploaded) {
            return { status: "ok", uploadedCount: 0 };
        }

        let files:
            | Readonly<{
                  baseHeadBytes: Uint8Array;
                  baseTypeBytes: Uint8Array;
                  baseLabelBytes: Uint8Array;
                  frameHeadBytes: Uint8Array;
                  frameTran1Bytes: Uint8Array;
                  frameTran2Bytes: Uint8Array;
                  frameDelBytes: Uint8Array;
              }>
            | undefined = undefined;
        try {
            files = loader.tryGetLegacySeqFrameFileBytes();
        } catch {
            files = undefined;
        }
        if (!files) {
            return { status: "failed", uploadedCount: 0 };
        }

        const uploads: Array<Readonly<[number, Uint8Array]>> = [
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_HEAD, files.baseHeadBytes],
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_TYPE, files.baseTypeBytes],
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_BASE_LABEL, files.baseLabelBytes],
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_HEAD, files.frameHeadBytes],
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN1, files.frameTran1Bytes],
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN2, files.frameTran2Bytes],
            [RUNTIME_BLOB_LEGACY_SEQ_FILE_FRAME_DEL, files.frameDelBytes],
        ];
        for (let i = 0; i < uploads.length; i++) {
            const [fileId, bytes] = uploads[i];
            if (!(bytes instanceof Uint8Array) || bytes.length <= 0) {
                return { status: "failed", uploadedCount: 0 };
            }
            if (
                !(await feeder.putBlob(
                    RUNTIME_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RUNTIME_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    fileId,
                    bytes,
                ))
            ) {
                return { status: "failed", uploadedCount: 0 };
            }
        }

        this.legacySeqFilesUploaded = true;
        return { status: "ok", uploadedCount: uploads.length | 0 };
    }

    private async uploadDatSeqFrameMapsForFrameIds(
        feeder: RuntimeCacheFeeder,
        datSeqFrameLoader: unknown,
        frameIds: ReadonlyArray<number> | undefined,
    ): Promise<number> {
        const sortedIds = sortedUniqueTypeIds(frameIds);
        const loader = datSeqFrameLoader as {
            tryGetFrameMapBlobForFrameId?: (
                id: number,
            ) => Readonly<{ frameMapId: number; bytes: Uint8Array }> | undefined;
        };
        if (typeof loader.tryGetFrameMapBlobForFrameId !== "function") {
            return 0;
        }
        const mapBytesById = new Map<number, Uint8Array>();
        for (let i = 0; i < sortedIds.length; i++) {
            const frameId = sortedIds[i] | 0;
            let blob: Readonly<{ frameMapId: number; bytes: Uint8Array }> | undefined = undefined;
            try {
                blob = loader.tryGetFrameMapBlobForFrameId(frameId);
            } catch {
                blob = undefined;
            }
            if (!blob) continue;
            const mapId = blob.frameMapId | 0;
            if (!mapBytesById.has(mapId)) {
                mapBytesById.set(mapId, blob.bytes);
            }
        }
        if (mapBytesById.size <= 0) {
            return 0;
        }
        const mapIds = Array.from(mapBytesById.keys())
            .filter((id) => !this.uploadedDatSeqFrameMapIds.has(id | 0))
            .sort((a, b) => a - b);
        if (mapIds.length <= 0) {
            return 0;
        }

        const groups: number[] = [];
        const files: number[] = [];
        const offsets: number[] = [];
        const lengths: number[] = [];
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        for (let i = 0; i < mapIds.length; i++) {
            const mapId = mapIds[i] | 0;
            const bytes = mapBytesById.get(mapId);
            if (!(bytes instanceof Uint8Array) || bytes.length <= 0) {
                continue;
            }
            groups.push(mapId);
            files.push(RUNTIME_BLOB_DAT_SEQ_FRAME_MAP_FILE_BYTES);
            offsets.push(totalBytes);
            lengths.push(bytes.length | 0);
            chunks.push(bytes);
            totalBytes += bytes.length | 0;
        }
        if (groups.length <= 0) {
            return 0;
        }

        const packedBytes = new Uint8Array(totalBytes);
        let writeOffset = 0;
        for (let i = 0; i < chunks.length; i++) {
            const bytes = chunks[i];
            packedBytes.set(bytes, writeOffset);
            writeOffset += bytes.length | 0;
        }

        const ok = await feeder.putBlobBatch(
            RUNTIME_BLOB_DOMAIN_DAT_SEQ_FRAME_MAP,
            Int32Array.from(groups),
            Int32Array.from(files),
            Int32Array.from(offsets),
            Int32Array.from(lengths),
            packedBytes,
        );
        if (!ok) {
            return -1;
        }
        for (let i = 0; i < groups.length; i++) {
            this.uploadedDatSeqFrameMapIds.add(groups[i] | 0);
        }
        return groups.length | 0;
    }

    private async uploadTypeEntriesFromIdsWithByteGetter(
        feeder: RuntimeCacheFeeder,
        domain: number,
        ids: ReadonlyArray<number> | undefined,
        tryGetBytes: (id: number) => Uint8Array | undefined,
        options?: Readonly<{ allowEmptyBytes?: boolean }>,
    ): Promise<number> {
        const allowEmptyBytes = options?.allowEmptyBytes === true;
        const sortedIds = sortedUniqueTypeIds(ids);

        const pendingIds: number[] = [];
        const pendingBytes: Uint8Array[] = [];
        for (let i = 0; i < sortedIds.length; i++) {
            const id = sortedIds[i] | 0;
            let bytes: Uint8Array | undefined;
            try {
                bytes = tryGetBytes(id);
            } catch {
                bytes = undefined;
            }
            if (!bytes) {
                continue;
            }
            if (!allowEmptyBytes && bytes.length <= 0) {
                continue;
            }
            pendingIds.push(id);
            pendingBytes.push(bytes);
        }

        if (pendingIds.length <= 0) {
            return 0;
        }

        const groups = new Int32Array(pendingIds.length);
        const files = new Int32Array(pendingIds.length);
        const offsets = new Int32Array(pendingIds.length);
        const lengths = new Int32Array(pendingIds.length);
        let totalBytes = 0;
        for (let i = 0; i < pendingIds.length; i++) {
            const bytes = pendingBytes[i];
            groups[i] = 0;
            files[i] = pendingIds[i] | 0;
            offsets[i] = totalBytes | 0;
            lengths[i] = bytes.length | 0;
            totalBytes += bytes.length | 0;
        }
        const packedBytes = new Uint8Array(totalBytes);
        let writeOffset = 0;
        for (let i = 0; i < pendingBytes.length; i++) {
            const bytes = pendingBytes[i];
            if (bytes.length > 0) {
                packedBytes.set(bytes, writeOffset);
                writeOffset += bytes.length | 0;
            }
        }
        if (
            !(await feeder.putBlobBatch(
                domain,
                groups,
                files,
                offsets,
                lengths,
                packedBytes,
            ))
        ) {
            return -1;
        }
        return pendingIds.length | 0;
    }

    async uploadMissingBlobEntriesForBuildRequest(
        bridge: MapRenderRuntimeBridgeV2,
        runtimeHandle: MapRenderRuntimeHandle,
        missing: MapRenderRuntimeMissingBlobEntries,
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<boolean> {
        const feeder = createRuntimeCacheFeeder(bridge, runtimeHandle);
        const provider = createSceneBuildCacheByteProvider(sceneBuildInput);

        let needsLegacyModelFiles = false;
        let needsLegacySeqFiles = false;
        for (let i = 0; i < (missing.domains.length | 0); i++) {
            const domain = missing.domains[i] | 0;
            if (domain === RUNTIME_BLOB_DOMAIN_LEGACY_MODEL_FILES) {
                needsLegacyModelFiles = true;
            } else if (domain === RUNTIME_BLOB_DOMAIN_LEGACY_SEQ_FILES) {
                needsLegacySeqFiles = true;
            }
        }

        const idsByDomain = splitRequiredTypeEntryIdsByDomain(missing);

        const locUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_LOC,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_LOC),
            (id) => provider.tryGetLocTypeBytes(id),
        );
        if (locUploaded < 0) return false;

        const objUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ),
            (id) => provider.tryGetObjTypeBytes(id),
        );
        if (objUploaded < 0) return false;

        const npcUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_NPC,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_NPC),
            (id) => provider.tryGetNpcTypeBytes(id),
        );
        if (npcUploaded < 0) return false;

        const varbitUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_VARBIT,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_VARBIT),
            (id) => provider.tryGetVarbitTypeBytes(id),
        );
        if (varbitUploaded < 0) return false;

        if (needsLegacyModelFiles) {
            const legacyResult = await this.uploadLegacyModelFilesIfNeeded(
                feeder,
                (sceneBuildInput.locModelLoader as any)?.modelLoader,
                idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_MODEL),
            );
            if (legacyResult.status === "failed") return false;
        } else {
            const modelUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
                feeder,
                RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
                idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_MODEL),
                (id) => provider.tryGetModelBytes(id),
            );
            if (modelUploaded < 0) return false;
        }

        const seqTypeUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE),
            (id) => provider.tryGetSeqTypeBytes(id),
        );
        if (seqTypeUploaded < 0) return false;

        const seqFrameIds = sortedUniqueTypeIds(idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_FRAME));
        if (needsLegacySeqFiles) {
            const legacyResult = await this.uploadLegacySeqFrameFilesIfNeeded(
                feeder,
                (sceneBuildInput.locModelLoader as any)?.seqFrameLoader,
                seqFrameIds,
            );
            if (legacyResult.status === "failed") return false;
        } else {
            const datFrameIds = seqFrameIds.filter((id) => (id | 0) <= 0xffff);
            if (datFrameIds.length > 0) {
                const mapsUploaded = await this.uploadDatSeqFrameMapsForFrameIds(
                    feeder,
                    (sceneBuildInput.locModelLoader as any)?.seqFrameLoader,
                    datFrameIds,
                );
                if (mapsUploaded < 0) return false;
            }
        }
        const dat2FrameIds = seqFrameIds.filter((id) => (id | 0) > 0xffff);
        if (dat2FrameIds.length > 0) {
            const seqFrameUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
                feeder,
                RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_FRAME,
                dat2FrameIds,
                (id) => provider.tryGetSeqFrameBytes(id),
            );
            if (seqFrameUploaded < 0) return false;
        }

        const skeletalUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ),
            (id) => provider.tryGetSkeletalSeqBytes(id),
        );
        if (skeletalUploaded < 0) return false;

        const seqBaseUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_BASE,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_BASE),
            (id) => provider.tryGetSeqBaseBytes(id),
        );
        if (seqBaseUploaded < 0) return false;

        const basUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_BAS,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_BAS),
            (id) => provider.tryGetBasTypeBytes(id),
        );
        if (basUploaded < 0) return false;

        const underlayUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_UNDERLAY,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_UNDERLAY),
            (id) => provider.tryGetUnderlayTypeBytes(id),
        );
        if (underlayUploaded < 0) return false;

        const overlayUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY),
            (id) => provider.tryGetOverlayTypeBytes(id),
        );
        if (overlayUploaded < 0) return false;

        const seqAlphaHintIds = idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_ALPHA_HINT);
        if (seqAlphaHintIds && seqAlphaHintIds.length > 0) {
            const plan = buildDerivedTypeUploadPlan({
                provider,
                expanded: {
                    seqTypeIds: seqAlphaHintIds,
                },
            });
            const seqAlphaUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
                feeder,
                RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_SEQ_ALPHA_HINT,
                seqAlphaHintIds,
                (id) => plan.seqAlphaHintBytesById.get(id | 0),
            );
            if (seqAlphaUploaded < 0) return false;
        }

        const transparentUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_TRANSPARENT,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_TRANSPARENT),
            () => new Uint8Array(0),
            { allowEmptyBytes: true },
        );
        if (transparentUploaded < 0) return false;

        const sdTextureUploaded = await this.uploadTypeEntriesFromIdsWithByteGetter(
            feeder,
            RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS,
            idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS),
            () => new Uint8Array(0),
            { allowEmptyBytes: true },
        );
        if (sdTextureUploaded < 0) return false;

        // Obj spawns is an ephemeral domain built from the worker's input list (not cache bytes).
        if (idsByDomain.get(RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS)?.length) {
            const objSpawnTypeEntry = createObjSpawnTypeEntryBytesForBuild(sceneBuildInput);
            if (
                objSpawnTypeEntry &&
                !(await feeder.putBlob(
                    RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS,
                    0,
                    objSpawnTypeEntry.typeId,
                    objSpawnTypeEntry.bytes,
                ))
            ) {
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
        const feeder = createRuntimeCacheFeeder(bridge, runtimeHandle);
        if (!(await feeder.setBuildConfig(request))) return false;
        if (!(await feeder.setVarps(sceneBuildInput.varpValues))) return false;
        const mapEntries = collectRuntimeCacheMapSquareEntries(sceneBuildInput);
        if (!mapEntries) {
            return false;
        }
        if (!(await feeder.clearBlobDomain(RUNTIME_BLOB_DOMAIN_MAP_SQUARE))) return false;
        const groups: number[] = [];
        const files: number[] = [];
        const offsets: number[] = [];
        const lengths: number[] = [];
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        for (let i = 0; i < mapEntries.length; i++) {
            const entry = mapEntries[i];
            const mapId = (((entry.mapX | 0) & 0xff) << 8) | ((entry.mapY | 0) & 0xff);
            const push = (fileId: number, bytes: Uint8Array | undefined) => {
                if (!(bytes instanceof Uint8Array) || bytes.length <= 0) return;
                groups.push(mapId);
                files.push(fileId | 0);
                offsets.push(totalBytes);
                lengths.push(bytes.length | 0);
                chunks.push(bytes);
                totalBytes += bytes.length | 0;
            };
            push(RUNTIME_BLOB_MAP_SQUARE_FILE_TERRAIN, entry.terrainBytes);
            push(RUNTIME_BLOB_MAP_SQUARE_FILE_LOC, entry.locBytes);
            push(RUNTIME_BLOB_MAP_SQUARE_FILE_NPC, entry.npcBytes);
        }
        const bytes = new Uint8Array(totalBytes);
        let off = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            bytes.set(chunk, off);
            off += chunk.length;
        }
        const okBatch = await feeder.putBlobBatch(
            RUNTIME_BLOB_DOMAIN_MAP_SQUARE,
            Int32Array.from(groups),
            Int32Array.from(files),
            Int32Array.from(offsets),
            Int32Array.from(lengths),
            bytes,
        );
        if (!okBatch) {
            return false;
        }
        if (
            !(
                await feeder.clearBlobDomain(
                    RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS,
                )
            )
        )
            return false;
        const objSpawnTypeEntry = createObjSpawnTypeEntryBytesForBuild(sceneBuildInput);
        const objSpawnDomain = RUNTIME_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS;
        if (
            objSpawnTypeEntry &&
            !(await feeder.putBlob(
                objSpawnDomain,
                0,
                objSpawnTypeEntry.typeId,
                objSpawnTypeEntry.bytes,
            ))
        ) {
            return false;
        }
        return true;
    }
}

export async function uploadRuntimeCacheForBuildRequest(
    bridge: MapRenderRuntimeBridgeV2,
    runtimeHandle: MapRenderRuntimeHandle,
    request: MapRenderRuntimeBuildRequest,
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): Promise<boolean> {
    const uploader = new MapRenderRuntimeCacheV2Uploader();
    return uploader.uploadRuntimeCacheForBuildRequest(bridge, runtimeHandle, request, sceneBuildInput);
}
