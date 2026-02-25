import type { ObjSpawn } from "../data/obj/ObjSpawn";
import { SdMapData } from "../renderer/loader/SdMapData";
import { SdMapLoaderInput } from "../renderer/loader/SdMapLoaderInput";
import { SdMapRenderDataTsBackend } from "../renderer/loader/SdMapRenderDataTsBackend";
import type {
    BuildMapDataPayloadOptions,
    SdMapRenderDataTsBackendDeps,
} from "../renderer/loader/SdMapRenderDataTsBackend";
import { GameType } from "../rs/cache/CacheInfo";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import { Scene } from "../rs/scene/Scene";
import { decodeTerrainSquareFromBytesInto, TerrainSquareDecodeScratch } from "../rs/scene/decodeTerrainSquare";
import { errorToString } from "../util/ErrorUtil";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeCreateConfig,
    MapRenderRuntimeHandle,
    MapRenderRuntimeMapSquareEntry,
    MapRenderRuntimeRequiredTypeIds,
} from "../wasm/MapRenderRuntimeBridgeAbi";
import {
    importMapRenderBridgeModule,
    resolveMapRenderBridgeModuleUrl,
} from "../wasm/loadMapRenderBridgeModule";
import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    MapRenderDataPayload,
    MapRenderDataPayloadResult,
    MapRenderRuntimePacket,
    payloadResultToRenderDataResult,
    payloadToScaffold,
    runtimePacketToPayload,
    validateMapRenderPayload,
} from "./MapRenderDataContract";
import type { RenderDataResult } from "./RenderDataLoader";

export type MapRenderDataBackendKind = "ts" | "cpp-wasm";

export type MapRenderDataBackendOptions = Readonly<{
    cppWasmModuleUrl?: string;
    telemetry?: boolean;
    strictCppWasm?: boolean;
    strictCppWasmPacketGeometry?: boolean;
}>;

export type MapRenderDataBackendDeps = SdMapRenderDataTsBackendDeps;

export interface MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
}

const CPP_WASM_OUTCOME_KEYS = [
    "success",
    "bridgeMissing",
    "tsPayloadEmpty",
    "bridgeReturnedEmpty",
    "validationFailed",
    "bridgeError",
] as const;

type CppWasmBuildOutcome = (typeof CPP_WASM_OUTCOME_KEYS)[number];
type CppWasmBuildOutcomeStats = Record<CppWasmBuildOutcome, number>;

function createCppWasmBuildOutcomeStats(): CppWasmBuildOutcomeStats {
    return {
        success: 0,
        bridgeMissing: 0,
        tsPayloadEmpty: 0,
        bridgeReturnedEmpty: 0,
        validationFailed: 0,
        bridgeError: 0,
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
    npcTypeLoader?: unknown;
    basTypeLoader?: unknown;
    varProvider: unknown;
    underlayTypeLoader?: unknown;
    overlayTypeLoader?: unknown;
    objSpawns?: ReadonlyArray<ObjSpawn>;
    varpValues: Int32Array;
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

export type ByteDrivenSceneBuildInputDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    locTypeLoader: unknown;
    objTypeLoader?: unknown;
    locModelLoader: unknown;
    npcTypeLoader?: unknown;
    basTypeLoader?: unknown;
    varProvider: unknown;
    underlayTypeLoader?: unknown;
    overlayTypeLoader?: unknown;
    objSpawns?: ReadonlyArray<ObjSpawn>;
    cacheGame: number;
    cacheRevision: number;
}>;

export type MapRenderRuntimeUploadScratchState = {
    uploadedTypeCacheKey: string;
    uploadedTypeIdsByKind: Map<number, Set<number>>;
};

export function createMapRenderRuntimeUploadScratchState(): MapRenderRuntimeUploadScratchState {
    return {
        uploadedTypeCacheKey: "",
        uploadedTypeIdsByKind: new Map(),
    };
}

export function resetMapRenderRuntimeUploadScratchState(
    state: MapRenderRuntimeUploadScratchState,
): void {
    state.uploadedTypeCacheKey = "";
    state.uploadedTypeIdsByKind.clear();
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
const RUNTIME_STATUS_OK = 1;
const SD_TEXTURE_PACK_LIMIT = 2047;
const RUNTIME_TYPE_BLOB_LOC_KIND = 1;
const RUNTIME_TYPE_BLOB_VARBIT_KIND = 2;
const RUNTIME_TYPE_BLOB_MODEL_KIND = 3;
const RUNTIME_TYPE_BLOB_TEXTURE_TRANSPARENT_KIND = 4;
const RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND = 5;
const RUNTIME_TYPE_BLOB_SEQ_FRAME_KIND = 6;
const RUNTIME_TYPE_BLOB_NPC_KIND = 7;
const RUNTIME_TYPE_BLOB_BAS_KIND = 8;
const RUNTIME_TYPE_BLOB_TEXTURE_IDS_KIND = 9;
const RUNTIME_TYPE_BLOB_UNDERLAY_KIND = 10;
const RUNTIME_TYPE_BLOB_OVERLAY_KIND = 11;
const RUNTIME_TYPE_BLOB_OBJ_KIND = 12;
const RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND = 13;
const RUNTIME_TYPE_BLOB_SEQ_ALPHA_HINT_KIND = 14;
const RUNTIME_TYPE_BLOB_SEQ_BASE_KIND = 15;
const RUNTIME_TYPE_BLOB_SKELETAL_SEQ_KIND = 16;

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
            const terrainBytes = mapBytesProvider.getTerrainBytes(mapX, mapY);
            const locBytes = mapBytesProvider.getLocBytes(mapX, mapY);
            const npcBytes =
                typeof mapBytesProvider.getNpcSpawnBytes === "function"
                    ? mapBytesProvider.getNpcSpawnBytes(mapX, mapY)
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

function isNewTerrainFormat(cacheGame: number, cacheRevision: number): boolean {
    return (cacheGame | 0) === GameType.Oldschool && (cacheRevision | 0) >= 209;
}

function collectTerrainTypeIdsFromMapEntries(
    mapEntries: ReadonlyArray<MapRenderRuntimeMapSquareEntry> | undefined,
    cacheGame: number,
    cacheRevision: number,
): Readonly<{ underlayTypeIds: number[]; overlayTypeIds: number[] }> {
    if (!mapEntries || mapEntries.length <= 0) {
        return { underlayTypeIds: [], overlayTypeIds: [] };
    }
    const underlayIds = new Set<number>();
    const overlayIds = new Set<number>();
    const scratch = new TerrainSquareDecodeScratch();
    const newTerrainFormat = isNewTerrainFormat(cacheGame, cacheRevision);
    for (let i = 0; i < mapEntries.length; i++) {
        const entry = mapEntries[i];
        const terrainBytes = entry?.terrainBytes;
        if (!(terrainBytes instanceof Uint8Array) || terrainBytes.length <= 0) {
            continue;
        }
        try {
            decodeTerrainSquareFromBytesInto(
                scratch,
                terrainBytes,
                newTerrainFormat,
                (entry.mapX | 0) * MAP_SQUARE_SIZE,
                (entry.mapY | 0) * MAP_SQUARE_SIZE,
            );
        } catch {
            continue;
        }
        for (let level = 0; level < Scene.MAX_LEVELS; level++) {
            const underlayCols = scratch.tileUnderlays[level];
            const overlayCols = scratch.tileOverlays[level];
            for (let x = 0; x < Scene.MAP_SQUARE_SIZE; x++) {
                const underlayCol = underlayCols[x];
                const overlayCol = overlayCols[x];
                for (let y = 0; y < Scene.MAP_SQUARE_SIZE; y++) {
                    const underlayId = (underlayCol[y] | 0) - 1;
                    const overlayId = (overlayCol[y] | 0) - 1;
                    if (underlayId >= 0) {
                        underlayIds.add(underlayId);
                    }
                    if (overlayId >= 0) {
                        overlayIds.add(overlayId);
                    }
                }
            }
        }
    }
    return {
        underlayTypeIds: Array.from(underlayIds.values()),
        overlayTypeIds: Array.from(overlayIds.values()),
    };
}

function createRuntimeCacheBuildRequest(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): MapRenderRuntimeBuildRequest | undefined {
    const sizeX = sceneBuildInput.sizeX | 0;
    const sizeY = sceneBuildInput.sizeY | 0;
    if (sizeX <= 0 || sizeY <= 0) {
        return undefined;
    }
    const borderX = ((sizeX - MAP_SQUARE_SIZE) / 2) | 0;
    const borderY = ((sizeY - MAP_SQUARE_SIZE) / 2) | 0;
    if (
        borderX < 0 ||
        borderY < 0 ||
        borderX !== borderY ||
        sizeX !== MAP_SQUARE_SIZE + borderX * 2 ||
        sizeY !== MAP_SQUARE_SIZE + borderY * 2
    ) {
        return undefined;
    }
    const borderSize = borderX;
    return {
        mapX: sceneBuildInput.mapX | 0,
        mapY: sceneBuildInput.mapY | 0,
        borderSize,
        sizeX,
        sizeY,
        cacheGame: sceneBuildInput.cacheGame | 0,
        cacheRevision: sceneBuildInput.cacheRevision | 0,
        unitsTileHeightBasis: sceneBuildInput.unitsTileHeightBasis | 0,
        smoothTerrain: sceneBuildInput.smoothTerrain,
        locLoadType: sceneBuildInput.locLoadType | 0,
        minimizeDrawCalls: sceneBuildInput.minimizeDrawCalls,
        loadLocs: sceneBuildInput.loadLocs,
        loadObjs: sceneBuildInput.loadObjs,
        loadNpcs: sceneBuildInput.loadNpcs,
    };
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

function sortedUniqueTypeIds(ids: ReadonlyArray<number> | undefined): number[] {
    if (!Array.isArray(ids) || ids.length <= 0) {
        return [];
    }
    return Array.from(new Set(ids.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
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
    const tryLoad = (loader as { tryLoad?: (id: number) => unknown }).tryLoad;
    if (typeof tryLoad !== "function") {
        return undefined;
    }
    try {
        const result = tryLoad(id | 0) as { ok?: boolean; value?: unknown } | undefined;
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
    const withGetData = loader as { getData?: (id: number) => unknown };
    if (typeof withGetData.getData === "function") {
        try {
            const bytes = toUint8ArrayView(withGetData.getData(id | 0));
            if (bytes) {
                return bytes;
            }
        } catch {
            // ignore
        }
    }
    const modelSource = (loader as { modelSource?: { getBytes?: (id: number) => unknown } })
        .modelSource;
    if (modelSource && typeof modelSource.getBytes === "function") {
        try {
            const bytes = toUint8ArrayView(modelSource.getBytes(id | 0));
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
    const managerVarbitLoader = (
        varProvider as { varManager?: { varbitLoader?: unknown } }
    ).varManager?.varbitLoader;
    if (
        managerVarbitLoader &&
        typeof (managerVarbitLoader as { tryLoad?: unknown }).tryLoad === "function"
    ) {
        return managerVarbitLoader;
    }
    const directVarbitLoader = (varProvider as { varbitLoader?: unknown }).varbitLoader;
    if (
        directVarbitLoader &&
        typeof (directVarbitLoader as { tryLoad?: unknown }).tryLoad === "function"
    ) {
        return directVarbitLoader;
    }
    return undefined;
}

function encodeVarbitTypeBytes(varbit: unknown): Uint8Array {
    const v = varbit as { baseVar?: number; startBit?: number; endBit?: number } | undefined;
    const baseVar = (v?.baseVar ?? 0) & 0xffff;
    const startBit = (v?.startBit ?? 0) & 0xff;
    const endBit = (v?.endBit ?? 0) & 0xff;
    const bytes = new Uint8Array(6);
    bytes[0] = 1;
    bytes[1] = (baseVar >>> 8) & 0xff;
    bytes[2] = baseVar & 0xff;
    bytes[3] = startBit;
    bytes[4] = endBit;
    bytes[5] = 0;
    return bytes;
}

function encodeSeqFrameBytes(seqFrame: unknown): Uint8Array | undefined {
    if (!seqFrame || typeof seqFrame !== "object") {
        return undefined;
    }
    const frame = seqFrame as {
        base?: { count?: number; types?: number[]; labels?: number[][] };
        transformCount?: number;
        transformGroups?: number[];
        transformX?: number[];
        transformY?: number[];
        transformZ?: number[];
        resetOriginGroups?: number[];
        hasAlphaTransform?: boolean;
        hasColorTransform?: boolean;
    };
    const base = frame.base;
    const baseCount = base?.count ?? base?.types?.length ?? 0;
    const baseTypesRaw = base?.types;
    const baseLabelsRaw = base?.labels;
    const baseTypes = Array.isArray(baseTypesRaw) ? baseTypesRaw : undefined;
    const baseLabels = Array.isArray(baseLabelsRaw) ? baseLabelsRaw : undefined;
    if (!baseTypes || !baseLabels || (baseCount | 0) <= 0) {
        return undefined;
    }

    const bc = baseCount | 0;
    const transformCount = Math.max(0, frame.transformCount ?? 0) | 0;
    let labelsBytes = 0;
    for (let i = 0; i < bc; i++) {
        labelsBytes += 1 + (Array.isArray(baseLabels[i]) ? baseLabels[i].length | 0 : 0);
    }

    const bytesLen =
        4 + // magic
        1 + // version
        1 + // flags
        2 + // baseCount
        bc +
        labelsBytes +
        2 + // transformCount
        transformCount * (2 + 2 + 2 + 2 + 2);
    const out = new Uint8Array(bytesLen);
    let o = 0;
    out[o++] = 0x52;
    out[o++] = 0x53;
    out[o++] = 0x51;
    out[o++] = 0x46;
    out[o++] = 1;
    let flags = 0;
    if (frame.hasAlphaTransform === true) flags |= 1;
    if (frame.hasColorTransform === true) flags |= 2;
    out[o++] = flags & 0xff;
    out[o++] = bc & 0xff;
    out[o++] = (bc >>> 8) & 0xff;
    for (let i = 0; i < bc; i++) {
        out[o++] = (baseTypes[i] ?? 0) & 0xff;
    }
    for (let i = 0; i < bc; i++) {
        const labels = Array.isArray(baseLabels[i]) ? baseLabels[i] : [];
        out[o++] = labels.length & 0xff;
        for (let j = 0; j < labels.length; j++) {
            out[o++] = (labels[j] ?? 0) & 0xff;
        }
    }
    out[o++] = transformCount & 0xff;
    out[o++] = (transformCount >>> 8) & 0xff;

    const transformGroups = Array.isArray(frame.transformGroups) ? frame.transformGroups : [];
    const transformX = Array.isArray(frame.transformX) ? frame.transformX : [];
    const transformY = Array.isArray(frame.transformY) ? frame.transformY : [];
    const transformZ = Array.isArray(frame.transformZ) ? frame.transformZ : [];
    const resetOriginGroups = Array.isArray(frame.resetOriginGroups)
        ? frame.resetOriginGroups
        : [];
    const writeI16 = (v: number) => {
        const x = (v | 0) & 0xffff;
        out[o++] = x & 0xff;
        out[o++] = (x >>> 8) & 0xff;
    };
    const writeU16 = (v: number) => {
        const x = (v | 0) & 0xffff;
        out[o++] = x & 0xff;
        out[o++] = (x >>> 8) & 0xff;
    };
    for (let i = 0; i < transformCount; i++) {
        writeU16(transformGroups[i] ?? 0);
        writeI16(transformX[i] ?? 0);
        writeI16(transformY[i] ?? 0);
        writeI16(transformZ[i] ?? 0);
        writeI16(resetOriginGroups[i] ?? -1);
    }
    return o === out.length ? out : out.slice(0, o);
}

function readUnsignedShortBE(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] << 8) | bytes[offset + 1]) & 0xffff;
}

function tryLoadSeqBaseBytesFromLoader(seqBaseLoader: unknown, id: number): Uint8Array | undefined {
    if (!seqBaseLoader || id < 0 || typeof seqBaseLoader !== "object") {
        return undefined;
    }
    const generic = tryLoadTypeBytes(seqBaseLoader, id);
    if (generic) {
        return generic;
    }
    const baseSource = (seqBaseLoader as { baseSource?: { getBytes?: (id: number) => unknown } })
        .baseSource;
    if (!baseSource || typeof baseSource.getBytes !== "function") {
        return undefined;
    }
    try {
        return toUint8ArrayView(baseSource.getBytes(id | 0));
    } catch {
        return undefined;
    }
}

function tryLoadSkeletalSeqBytesFromLoader(
    skeletalSeqLoader: unknown,
    id: number,
): Uint8Array | undefined {
    if (!skeletalSeqLoader || id < 0 || typeof skeletalSeqLoader !== "object") {
        return undefined;
    }
    const generic = tryLoadTypeBytes(skeletalSeqLoader, id);
    if (generic) {
        return generic;
    }
    const loader = skeletalSeqLoader as {
        groupCache?: Map<number, unknown>;
        animGroupProviderFactory?: { getGroup?: (archiveId: number) => unknown };
    };
    const archiveId = (id >> 16) | 0;
    const fileId = id & 0xffff;
    let group = loader.groupCache?.get(archiveId);
    if (!group && typeof loader.animGroupProviderFactory?.getGroup === "function") {
        try {
            group = loader.animGroupProviderFactory.getGroup(archiveId);
        } catch {
            group = undefined;
        }
        if (group && loader.groupCache) {
            loader.groupCache.set(archiveId, group);
        }
    }
    const getBytes = (group as { getBytes?: (id: number) => unknown } | undefined)?.getBytes;
    if (typeof getBytes !== "function") {
        return undefined;
    }
    try {
        return toUint8ArrayView(getBytes(fileId));
    } catch {
        return undefined;
    }
}

function tryGetSeqFrameFromLoader(seqFrameLoader: unknown, frameId: number): unknown {
    if (!seqFrameLoader || frameId < 0 || typeof seqFrameLoader !== "object") {
        return undefined;
    }
    const withTryGet = seqFrameLoader as { tryGet?: (id: number) => unknown };
    if (typeof withTryGet.tryGet === "function") {
        try {
            const frame = withTryGet.tryGet(frameId | 0);
            if (frame) {
                return frame;
            }
        } catch {
            // ignore
        }
    }
    return tryLoadDecoded(seqFrameLoader, frameId);
}

function tryGetSkeletalSeqFromLoader(skeletalSeqLoader: unknown, seqId: number): unknown {
    if (!skeletalSeqLoader || seqId < 0 || typeof skeletalSeqLoader !== "object") {
        return undefined;
    }
    const withTryGet = skeletalSeqLoader as { tryGet?: (id: number) => unknown };
    if (typeof withTryGet.tryGet !== "function") {
        return undefined;
    }
    try {
        return withTryGet.tryGet(seqId | 0);
    } catch {
        return undefined;
    }
}

class TsMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "ts";
    private readonly backend: SdMapRenderDataTsBackend;

    constructor(deps: MapRenderDataBackendDeps) {
        this.backend = new SdMapRenderDataTsBackend(deps);
    }

    buildMapDataPayload(
        input: SdMapLoaderInput,
        options?: BuildMapDataPayloadOptions,
    ): Promise<MapRenderDataPayloadResult> {
        return this.backend.buildMapDataPayload(input, options);
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const payloadResult = await this.buildMapDataPayload(input);
        return payloadResultToRenderDataResult(payloadResult);
    }

    reset(): void {
        this.backend.reset();
    }
}

type CppWasmMapRenderDataBridge = MapRenderRuntimeBridgeV2;

function resolveCppWasmBridgeExport(
    mod: Record<string, unknown>,
): CppWasmMapRenderDataBridge | undefined {
    const runtimeCandidate = mod.mapRenderRuntimeBridge;
    if (runtimeCandidate && typeof runtimeCandidate === "object") {
        const bridge = runtimeCandidate as CppWasmMapRenderDataBridge;
        if (
            typeof bridge.initRuntime === "function" &&
            typeof bridge.createRuntimeWithConfig === "function" &&
            typeof bridge.destroyRuntime === "function" &&
            typeof bridge.resetRuntime === "function" &&
            typeof bridge.cacheSetBuildConfig === "function" &&
            typeof bridge.cacheClearMapSquares === "function" &&
            typeof bridge.cachePutMapSquaresPacked === "function" &&
            typeof bridge.cacheClearTypeKind === "function" &&
            typeof bridge.cachePutTypeEntry === "function" &&
            typeof bridge.collectRequiredExpandedTypeIds === "function" &&
            typeof bridge.cacheSetVarps === "function" &&
            typeof bridge.buildMapPacketFromCache === "function"
        ) {
            return bridge;
        }
    }
    return undefined;
}

async function tryLoadCppWasmBridge(
    moduleUrl?: string,
): Promise<CppWasmMapRenderDataBridge | undefined> {
    const defaultUrl = "../wasm/rs_map_render_backend_runtime.mjs";
    const url = moduleUrl
        ? resolveMapRenderBridgeModuleUrl(moduleUrl, import.meta.url)
        : defaultUrl;
    try {
        const mod = await importMapRenderBridgeModule(moduleUrl, import.meta.url);
        const bridge = resolveCppWasmBridgeExport(mod);
        if (!bridge) {
            console.warn(`[map-render-backend] cpp-wasm module missing bridge export: ${url}`);
        }
        return bridge;
    } catch (e) {
        console.warn(
            `[map-render-backend] failed to load cpp-wasm module ${url}: ${errorToString(e)}`,
        );
        return undefined;
    }
}

class CppWasmMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "cpp-wasm";
    private bridgePromise: Promise<CppWasmMapRenderDataBridge | undefined> | undefined;
    private runtimeInitPromise: Promise<boolean> | undefined;
    private runtimeHandlePromise: Promise<MapRenderRuntimeHandle | undefined> | undefined;
    private runtimeHandle: MapRenderRuntimeHandle | undefined;
    private readonly fallback: TsMapRenderDataBackend;
    private readonly outcomeStats: CppWasmBuildOutcomeStats = createCppWasmBuildOutcomeStats();
    private readonly strictCppWasm: boolean;
    private readonly strictCppWasmPacketGeometry: boolean;
    private readonly mapBytesProvider: MapBytesProvider;
    private readonly cacheGame: number;
    private readonly cacheRevision: number;
    private readonly locTypeLoader: unknown;
    private readonly objTypeLoader: unknown;
    private readonly locModelLoader: unknown;
    private readonly npcTypeLoader: unknown;
    private readonly basTypeLoader: unknown;
    private readonly underlayTypeLoader: unknown;
    private readonly overlayTypeLoader: unknown;
    private readonly varProvider: unknown;
    private readonly objSpawns: ReadonlyArray<ObjSpawn>;
    private uploadedTypeCacheKey = "";
    private readonly uploadedTypeIdsByKind = new Map<number, Set<number>>();
    private buildCalls = 0;

    constructor(
        deps: MapRenderDataBackendDeps,
        private readonly options: MapRenderDataBackendOptions | undefined,
    ) {
        this.mapBytesProvider = deps.mapBytesProvider;
        this.cacheGame = deps.session.cache.info.game;
        this.cacheRevision = deps.session.cache.info.revision;
        this.locTypeLoader = deps.session.loaders.locTypeLoader;
        this.objTypeLoader = deps.session.loaders.objTypeLoader;
        this.locModelLoader = deps.locModelLoader;
        this.npcTypeLoader = deps.session.loaders.npcTypeLoader;
        this.basTypeLoader = deps.session.loaders.basTypeLoader;
        this.underlayTypeLoader = deps.session.loaders.underlayTypeLoader;
        this.overlayTypeLoader = deps.session.loaders.overlayTypeLoader;
        this.varProvider = deps.varProvider;
        this.objSpawns = deps.objSpawns;
        this.strictCppWasm = options?.strictCppWasm === true;
        this.strictCppWasmPacketGeometry =
            options?.strictCppWasmPacketGeometry === true || this.strictCppWasm;
        this.fallback = new TsMapRenderDataBackend({
            ...deps,
            telemetry: options?.telemetry,
            npcSpawnDecodeBackend: {
                name: "cpp-wasm",
                filtersLoginScreenProps: true,
                decodeNpcSpawnsFromBytes: async (
                    tileRenderFlagsLevel1: Uint8Array[],
                    borderSize: number,
                    mapX: number,
                    mapY: number,
                    data: Uint8Array,
                    npcLoginScreenPropsById?: Uint8Array,
                    requiredLoginScreenPropsMask?: number,
                ) => {
                    const bridge = await this.loadBridge();
                    if (!bridge?.decodeNpcSpawnsFromBytes) {
                        if (this.strictCppWasm) {
                            throw new Error(
                                "[map-render-backend][strict-cpp-wasm] decodeNpcSpawns bridgeMissing",
                            );
                        }
                        return undefined;
                    }
                    const decoded = await bridge.decodeNpcSpawnsFromBytes(
                        tileRenderFlagsLevel1,
                        borderSize,
                        mapX,
                        mapY,
                        data,
                        npcLoginScreenPropsById,
                        requiredLoginScreenPropsMask,
                    );
                    if (!decoded && this.strictCppWasm) {
                        throw new Error(
                            "[map-render-backend][strict-cpp-wasm] decodeNpcSpawns bridgeReturnedEmpty",
                        );
                    }
                    return decoded;
                },
            },
        });
    }

    private strictFailure(reason: string, details?: string): never {
        const suffix = details ? ` details=${details}` : "";
        throw new Error(`[map-render-backend][strict-cpp-wasm] ${reason}${suffix}`);
    }

    private loadBridge(): Promise<CppWasmMapRenderDataBridge | undefined> {
        if (!this.bridgePromise) {
            this.bridgePromise = tryLoadCppWasmBridge(this.options?.cppWasmModuleUrl);
        }
        return this.bridgePromise;
    }

    private async ensureRuntimeInitialized(bridge: CppWasmMapRenderDataBridge): Promise<boolean> {
        if (!this.runtimeInitPromise) {
            this.runtimeInitPromise = bridge.initRuntime();
        }
        return this.runtimeInitPromise;
    }

    private async ensureRuntimeHandle(
        bridge: CppWasmMapRenderDataBridge,
    ): Promise<MapRenderRuntimeHandle | undefined> {
        if (!this.runtimeHandlePromise) {
            this.runtimeHandlePromise = bridge.createRuntimeWithConfig({
                cacheGame: this.cacheGame | 0,
                cacheRevision: this.cacheRevision | 0,
                sceneLevels: 4,
                unitsTileHeightBasis: 8,
            } as MapRenderRuntimeCreateConfig);
        }
        const runtimeHandle = await this.runtimeHandlePromise;
        if (runtimeHandle !== undefined) {
            this.runtimeHandle = runtimeHandle;
        }
        return runtimeHandle;
    }

    private createByteDrivenSceneBuildInput(
        input: SdMapLoaderInput,
    ): MapRenderByteDrivenSceneBuildInput {
        return createByteDrivenSceneBuildInput(input, {
            mapBytesProvider: this.mapBytesProvider,
            locTypeLoader: this.locTypeLoader,
            objTypeLoader: this.objTypeLoader,
            locModelLoader: this.locModelLoader,
            npcTypeLoader: this.npcTypeLoader,
            basTypeLoader: this.basTypeLoader,
            underlayTypeLoader: this.underlayTypeLoader,
            overlayTypeLoader: this.overlayTypeLoader,
            varProvider: this.varProvider,
            objSpawns: this.objSpawns,
            cacheGame: this.cacheGame,
            cacheRevision: this.cacheRevision,
        });
    }

    private getUploadedTypeIdSet(kind: number, create: boolean): Set<number> | undefined {
        const normalizedKind = kind | 0;
        let set = this.uploadedTypeIdsByKind.get(normalizedKind);
        if (!set && create) {
            set = new Set<number>();
            this.uploadedTypeIdsByKind.set(normalizedKind, set);
        }
        return set;
    }

    private resetUploadedTypeStateForCache(sceneBuildInput: MapRenderByteDrivenSceneBuildInput): void {
        const cacheKey = `${sceneBuildInput.cacheGame | 0}:${sceneBuildInput.cacheRevision | 0}`;
        if (this.uploadedTypeCacheKey === cacheKey) {
            return;
        }
        this.uploadedTypeCacheKey = cacheKey;
        this.uploadedTypeIdsByKind.clear();
    }

    private async uploadTypeEntriesFromIdsWithByteGetter(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        kind: number,
        ids: ReadonlyArray<number> | undefined,
        tryGetBytes: (id: number) => Uint8Array | undefined,
        options?: Readonly<{ allowEmptyBytes?: boolean; uploadedIdsSet?: Set<number> }>,
    ): Promise<boolean> {
        const uploadedIdsSet = options?.uploadedIdsSet;
        const allowEmptyBytes = options?.allowEmptyBytes === true;
        const sortedIds = sortedUniqueTypeIds(ids);
        for (let i = 0; i < sortedIds.length; i++) {
            const id = sortedIds[i] | 0;
            if (uploadedIdsSet?.has(id)) {
                continue;
            }
            let bytes: Uint8Array | undefined;
            try {
                bytes = toUint8ArrayView(tryGetBytes(id));
            } catch {
                bytes = undefined;
            }
            if (!bytes) {
                continue;
            }
            if (!allowEmptyBytes && bytes.length <= 0) {
                continue;
            }
            const status = await bridge.cachePutTypeEntry(runtimeHandle, kind, id, bytes);
            if (status !== RUNTIME_STATUS_OK) {
                return false;
            }
            uploadedIdsSet?.add(id);
        }
        return true;
    }

    private async uploadTypeEntriesFromLoaderIds(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        kind: number,
        loader: unknown,
        ids: ReadonlyArray<number> | undefined,
        encodeFallback?: (decoded: unknown) => Uint8Array | undefined,
        options?: Readonly<{ allowEmptyBytes?: boolean; uploadedIdsSet?: Set<number> }>,
    ): Promise<boolean> {
        return this.uploadTypeEntriesFromIdsWithByteGetter(
            bridge,
            runtimeHandle,
            kind,
            ids,
            (id) => {
                let bytes = tryLoadTypeBytes(loader, id);
                if (!bytes && encodeFallback) {
                    const decoded = tryLoadDecoded(loader, id);
                    if (decoded) {
                        bytes = encodeFallback(decoded);
                    }
                }
                return bytes;
            },
            options,
        );
    }

    private async uploadRequiredTypeEntriesForBuildRequest(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
        mapEntries?: ReadonlyArray<MapRenderRuntimeMapSquareEntry>,
    ): Promise<boolean> {
        this.resetUploadedTypeStateForCache(sceneBuildInput);

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
        const textureLoader = locModelLoader?.textureLoader as
            | {
                  getTextureIds?: () => number[];
                  isSd?: (id: number) => boolean;
                  isTransparent?: (id: number) => boolean;
              }
            | undefined;
        const seqTypeLoader = locModelLoader?.seqTypeLoader;
        const seqFrameLoader = locModelLoader?.seqFrameLoader;
        const skeletalSeqLoader = locModelLoader?.skeletalSeqLoader;
        const varbitLoader = tryGetVarbitLoader(sceneBuildInput.varProvider);

        const locUploadedIds = this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_LOC_KIND, true);
        const objUploadedIds = this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_OBJ_KIND, true);
        const npcUploadedIds = this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_NPC_KIND, true);

        let expanded: MapRenderRuntimeRequiredTypeIds | undefined;
        for (let pass = 0; pass < 8; pass++) {
            expanded = await bridge.collectRequiredExpandedTypeIds(runtimeHandle, request);
            if (!expanded) {
                return false;
            }
            const beforeLoc = locUploadedIds?.size ?? 0;
            const beforeObj = objUploadedIds?.size ?? 0;
            const beforeNpc = npcUploadedIds?.size ?? 0;
            if (
                !(await this.uploadTypeEntriesFromLoaderIds(
                    bridge,
                    runtimeHandle,
                    RUNTIME_TYPE_BLOB_LOC_KIND,
                    sceneBuildInput.locTypeLoader,
                    expanded.locTypeIds,
                    undefined,
                    { uploadedIdsSet: locUploadedIds },
                ))
            ) {
                return false;
            }
            if (
                !(await this.uploadTypeEntriesFromLoaderIds(
                    bridge,
                    runtimeHandle,
                    RUNTIME_TYPE_BLOB_OBJ_KIND,
                    sceneBuildInput.objTypeLoader,
                    expanded.objTypeIds,
                    undefined,
                    { uploadedIdsSet: objUploadedIds },
                ))
            ) {
                return false;
            }
            if (
                !(await this.uploadTypeEntriesFromLoaderIds(
                    bridge,
                    runtimeHandle,
                    RUNTIME_TYPE_BLOB_NPC_KIND,
                    sceneBuildInput.npcTypeLoader,
                    expanded.npcTypeIds,
                    undefined,
                    { uploadedIdsSet: npcUploadedIds },
                ))
            ) {
                return false;
            }
            const changed =
                (locUploadedIds?.size ?? 0) !== beforeLoc ||
                (objUploadedIds?.size ?? 0) !== beforeObj ||
                (npcUploadedIds?.size ?? 0) !== beforeNpc;
            if (!changed) {
                break;
            }
        }

        expanded = await bridge.collectRequiredExpandedTypeIds(runtimeHandle, request);
        if (!expanded) {
            return false;
        }
        const terrainTypeIds = collectTerrainTypeIdsFromMapEntries(
            mapEntries,
            sceneBuildInput.cacheGame | 0,
            sceneBuildInput.cacheRevision | 0,
        );
        const requiredUnderlayTypeIds = sortedUniqueTypeIds([
            ...(expanded.underlayTypeIds ?? []),
            ...terrainTypeIds.underlayTypeIds,
        ]);
        const requiredOverlayTypeIds = sortedUniqueTypeIds([
            ...(expanded.overlayTypeIds ?? []),
            ...terrainTypeIds.overlayTypeIds,
        ]);

        const sortedSeqIds = sortedUniqueTypeIds(expanded.seqTypeIds);
        const seqFrameIds: number[] = [];
        const skeletalSeqIds: number[] = [];
        for (let i = 0; i < sortedSeqIds.length; i++) {
            const seqType = tryLoadDecoded(seqTypeLoader, sortedSeqIds[i] | 0) as
                | { animMayaId?: number; frameIds?: number[] }
                | undefined;
            if (!seqType) {
                continue;
            }
            const animMayaId = seqType.animMayaId ?? -1;
            if ((animMayaId | 0) >= 0) {
                skeletalSeqIds.push(animMayaId | 0);
            }
            const frameIds = Array.isArray(seqType.frameIds) ? seqType.frameIds : [];
            for (let f = 0; f < frameIds.length; f++) {
                const frameId = frameIds[f] | 0;
                if (frameId >= 0) {
                    seqFrameIds.push(frameId);
                }
            }
        }

        const skeletalSeqBytesById = new Map<number, Uint8Array>();
        const seqBaseIds: number[] = [];
        const sortedSkeletalSeqIds = sortedUniqueTypeIds(skeletalSeqIds);
        for (let i = 0; i < sortedSkeletalSeqIds.length; i++) {
            const id = sortedSkeletalSeqIds[i] | 0;
            const bytes = tryLoadSkeletalSeqBytesFromLoader(skeletalSeqLoader, id);
            if (!bytes || bytes.length < 3) {
                continue;
            }
            skeletalSeqBytesById.set(id, bytes);
            const baseId = readUnsignedShortBE(bytes, 1) | 0;
            if (baseId >= 0) {
                seqBaseIds.push(baseId);
            }
        }

        const transparentTextureIds: number[] = [];
        const sdTextureIds: number[] = [];
        if (
            textureLoader &&
            typeof textureLoader.getTextureIds === "function" &&
            typeof textureLoader.isSd === "function" &&
            typeof textureLoader.isTransparent === "function"
        ) {
            const allTextureIds = textureLoader.getTextureIds();
            if (Array.isArray(allTextureIds)) {
                for (let i = 0; i < allTextureIds.length; i++) {
                    const textureId = allTextureIds[i] | 0;
                    if (textureId < 0) {
                        continue;
                    }
                    if (textureLoader.isTransparent(textureId)) {
                        transparentTextureIds.push(textureId);
                    }
                    if (textureLoader.isSd(textureId) && sdTextureIds.length < SD_TEXTURE_PACK_LIMIT) {
                        sdTextureIds.push(textureId);
                    }
                }
            }
        }

        const seqBaseLoader =
            (skeletalSeqLoader as { baseLoader?: unknown } | undefined)?.baseLoader ??
            (seqFrameLoader as { baseLoader?: unknown } | undefined)?.baseLoader;

        const hasSeqTypeAnimMaya = (seqType: unknown): boolean => {
            const asAny = seqType as { hasAnimMayaSeq?: () => boolean; animMayaId?: number } | undefined;
            if (typeof asAny?.hasAnimMayaSeq === "function") {
                try {
                    return asAny.hasAnimMayaSeq() === true;
                } catch {
                    return (asAny?.animMayaId ?? -1) >= 0;
                }
            }
            return (asAny?.animMayaId ?? -1) >= 0;
        };

        const seqAlphaHintBytesById = new Map<number, Uint8Array>();
        for (let i = 0; i < sortedSeqIds.length; i++) {
            const seqId = sortedSeqIds[i] | 0;
            const seqType = tryLoadDecoded(seqTypeLoader, seqId);
            let hasAlphaTransform = false;
            if (seqType) {
                if (hasSeqTypeAnimMaya(seqType)) {
                    const animMayaId = ((seqType as { animMayaId?: number }).animMayaId ?? -1) | 0;
                    const skeletalSeq = tryGetSkeletalSeqFromLoader(skeletalSeqLoader, animMayaId) as
                        | { hasAlphaTransform?: boolean }
                        | undefined;
                    hasAlphaTransform = skeletalSeq?.hasAlphaTransform === true;
                } else {
                    const frameIds = Array.isArray((seqType as { frameIds?: number[] }).frameIds)
                        ? (seqType as { frameIds: number[] }).frameIds
                        : [];
                    for (let f = 0; f < frameIds.length; f++) {
                        const frameId = frameIds[f] | 0;
                        const seqFrame = tryGetSeqFrameFromLoader(seqFrameLoader, frameId) as
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

        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_LOC_KIND,
                sceneBuildInput.locTypeLoader,
                expanded.locTypeIds,
                undefined,
                { uploadedIdsSet: locUploadedIds },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_VARBIT_KIND,
                varbitLoader,
                expanded.varbitTypeIds,
                (decoded) => encodeVarbitTypeBytes(decoded),
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_VARBIT_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_MODEL_KIND,
                modelLoader,
                expanded.modelIds,
                undefined,
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_MODEL_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_OBJ_KIND,
                sceneBuildInput.objTypeLoader,
                expanded.objTypeIds,
                undefined,
                { uploadedIdsSet: objUploadedIds },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND,
                seqTypeLoader,
                sortedSeqIds,
                undefined,
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_SEQ_FRAME_KIND,
                seqFrameLoader,
                seqFrameIds,
                (decoded) => encodeSeqFrameBytes(decoded),
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_SEQ_FRAME_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromIdsWithByteGetter(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_SEQ_ALPHA_HINT_KIND,
                sortedSeqIds,
                (id) => seqAlphaHintBytesById.get(id | 0),
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_SEQ_ALPHA_HINT_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromIdsWithByteGetter(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_SEQ_BASE_KIND,
                seqBaseIds,
                (id) => tryLoadSeqBaseBytesFromLoader(seqBaseLoader, id),
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_SEQ_BASE_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromIdsWithByteGetter(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_SKELETAL_SEQ_KIND,
                Array.from(skeletalSeqBytesById.keys()),
                (id) => skeletalSeqBytesById.get(id | 0),
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_SKELETAL_SEQ_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_NPC_KIND,
                sceneBuildInput.npcTypeLoader,
                expanded.npcTypeIds,
                undefined,
                { uploadedIdsSet: npcUploadedIds },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_BAS_KIND,
                sceneBuildInput.basTypeLoader,
                expanded.basTypeIds,
                undefined,
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_BAS_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_UNDERLAY_KIND,
                sceneBuildInput.underlayTypeLoader,
                requiredUnderlayTypeIds,
                undefined,
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_UNDERLAY_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromLoaderIds(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_OVERLAY_KIND,
                sceneBuildInput.overlayTypeLoader,
                requiredOverlayTypeIds,
                undefined,
                { uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_OVERLAY_KIND, true) },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromIdsWithByteGetter(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_TEXTURE_TRANSPARENT_KIND,
                transparentTextureIds,
                () => new Uint8Array(0),
                {
                    allowEmptyBytes: true,
                    uploadedIdsSet: this.getUploadedTypeIdSet(
                        RUNTIME_TYPE_BLOB_TEXTURE_TRANSPARENT_KIND,
                        true,
                    ),
                },
            ))
        ) {
            return false;
        }
        if (
            !(await this.uploadTypeEntriesFromIdsWithByteGetter(
                bridge,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_TEXTURE_IDS_KIND,
                sdTextureIds,
                () => new Uint8Array(0),
                {
                    allowEmptyBytes: true,
                    uploadedIdsSet: this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_TEXTURE_IDS_KIND, true),
                },
            ))
        ) {
            return false;
        }

        return true;
    }

    private async uploadRuntimeCacheForBuildRequest(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<boolean> {
        if (
            (await bridge.cacheSetBuildConfig(runtimeHandle, request)) !== RUNTIME_STATUS_OK
        ) {
            return false;
        }
        const mapEntries = collectRuntimeCacheMapSquareEntries(sceneBuildInput);
        if (!mapEntries) {
            return false;
        }
        if ((await bridge.cacheClearMapSquares(runtimeHandle)) !== RUNTIME_STATUS_OK) {
            return false;
        }
        if (
            mapEntries.length > 0 &&
            (await bridge.cachePutMapSquaresPacked(runtimeHandle, mapEntries)) !== RUNTIME_STATUS_OK
        ) {
            return false;
        }
        if (
            (await bridge.cacheClearTypeKind(
                runtimeHandle,
                RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND,
            )) !== RUNTIME_STATUS_OK
        ) {
            return false;
        }
        this.getUploadedTypeIdSet(RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND, false)?.clear();
        const objSpawnTypeEntry = createObjSpawnTypeEntryBytesForBuild(sceneBuildInput);
        if (
            objSpawnTypeEntry &&
            (await bridge.cachePutTypeEntry(
                runtimeHandle,
                RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND,
                objSpawnTypeEntry.typeId,
                objSpawnTypeEntry.bytes,
            )) !== RUNTIME_STATUS_OK
        ) {
            return false;
        }
        if (!(await this.uploadRequiredTypeEntriesForBuildRequest(
            bridge,
            runtimeHandle,
            request,
            sceneBuildInput,
            mapEntries,
        ))) {
            return false;
        }
        if (
            (await bridge.cacheSetVarps(runtimeHandle, sceneBuildInput.varpValues)) !==
            RUNTIME_STATUS_OK
        ) {
            return false;
        }
        return true;
    }

    private async buildWithBridge(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        input: SdMapLoaderInput,
        byteDrivenSceneBuildInput: MapRenderByteDrivenSceneBuildInput,
        basePayload: MapRenderDataPayload,
    ): Promise<MapRenderDataPayload | undefined> {
        const request = createRuntimeCacheBuildRequest(byteDrivenSceneBuildInput);
        if (!request) {
            return undefined;
        }
        const uploaded = await this.uploadRuntimeCacheForBuildRequest(
            bridge,
            runtimeHandle,
            request,
            byteDrivenSceneBuildInput,
        );
        if (!uploaded) {
            return undefined;
        }
        const packet = await bridge.buildMapPacketFromCache(runtimeHandle, request);
        let npcPacket: MapRenderRuntimePacket | undefined;
        try {
            let payload = runtimePacketToPayload(packet, payloadToScaffold(basePayload), {
                requirePacketGeometry: this.strictCppWasmPacketGeometry,
            });
            if (!payload) {
                return undefined;
            }

            if (input.loadNpcs && typeof bridge.buildNpcPacketFromCache === "function") {
                npcPacket = await bridge.buildNpcPacketFromCache(runtimeHandle, request);
                const npcGeometry =
                    npcPacket?.npcVertices instanceof Uint8Array &&
                    npcPacket?.npcIndices instanceof Int32Array &&
                    npcPacket?.npcDrawRangesBase instanceof Int32Array &&
                    npcPacket.npcVertices.length > 0 &&
                    npcPacket.npcIndices.length > 0 &&
                    npcPacket.npcDrawRangesBase.length > 0
                        ? {
                              drawRangesBase: new Int32Array(npcPacket.npcDrawRangesBase),
                              drawRangesAlpha:
                                  npcPacket.npcDrawRangesAlpha instanceof Int32Array
                                      ? new Int32Array(npcPacket.npcDrawRangesAlpha)
                                      : undefined,
                              vertices: new Uint8Array(npcPacket.npcVertices),
                              indices: new Int32Array(npcPacket.npcIndices),
                              orderKeys:
                                  npcPacket.npcOrderKeys instanceof Int32Array
                                      ? new Int32Array(npcPacket.npcOrderKeys)
                                      : undefined,
                          }
                        : undefined;
                if (npcGeometry) {
                    payload = {
                        ...payload,
                        npcGeometry,
                    };
                }
            }

            return payload;
        } finally {
            if (typeof bridge.releasePacket === "function") {
                bridge.releasePacket(packet);
                bridge.releasePacket(npcPacket);
            }
        }
    }

    private validateBridgePayload(payload: MapRenderDataPayload): string | undefined {
        const validationIssues = validateMapRenderPayload(payload);
        if (validationIssues.length > 0) {
            return validationIssues[0];
        }
        return undefined;
    }

    // Active cpp-wasm path must only use TS payload as scaffold; geometry/heightmap come from C++.
    private validateActiveBasePayloadScaffold(payload: MapRenderDataPayload): string | undefined {
        if ((payload.heightMapTextureData?.length | 0) !== 0) {
            return "heightMapTextureData must be empty in active cpp-wasm scaffold path";
        }
        for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_KEYS.length; i++) {
            const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
            const drawLen = payload.drawRanges[key]?.length ?? 0;
            if ((drawLen | 0) !== 0) {
                return `drawRanges.${key} must be empty in active cpp-wasm scaffold path`;
            }
            const modelInfoLen = payload.modelInfoTextures[key]?.length ?? 0;
            if ((modelInfoLen | 0) !== 0) {
                return `modelInfoTextures.${key} must be empty in active cpp-wasm scaffold path`;
            }
        }
        return undefined;
    }

    private buildPayloadOptionsForActiveBase(): BuildMapDataPayloadOptions {
        return {
            preferWasmPacking: true,
            includeMinimapBlob: false,
            includeLoadedTextures: true,
            includeNpcAnimationFrames: false,
        };
    }

    private trackOutcome(
        outcome: CppWasmBuildOutcome,
        input: SdMapLoaderInput,
        totalMs?: number,
        details?: string,
    ): void {
        this.outcomeStats[outcome]++;
        this.buildCalls++;
        if (!this.options?.telemetry) {
            return;
        }
        const suffix = details ? ` details=${details}` : "";
        const timing = totalMs !== undefined ? ` totalMs=${totalMs.toFixed(1)}` : "";
        console.log(
            `[map-render] square=${input.mapX},${input.mapY} backend=cpp-wasm outcome=${outcome}${timing}${suffix}`,
        );
        if (this.buildCalls % 25 === 0) {
            const summary = CPP_WASM_OUTCOME_KEYS.map((k) => `${k}=${this.outcomeStats[k]}`).join(
                " ",
            );
            console.log(`[map-render] backend=cpp-wasm outcomes ${summary}`);
        }
    }

    private async buildMapDataActive(
        input: SdMapLoaderInput,
        t0: number | undefined,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const bridge = await this.loadBridge();
        if (!bridge) {
            if (this.strictCppWasm) {
                this.strictFailure("bridgeMissing");
            }
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return this.fallback.buildMapData(input);
        }
        if (!(await this.ensureRuntimeInitialized(bridge))) {
            if (this.strictCppWasm) {
                this.strictFailure("runtimeInitFailed");
            }
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                "runtimeInitFailed",
            );
            return this.fallback.buildMapData(input);
        }
        const runtimeHandle = await this.ensureRuntimeHandle(bridge);
        if (runtimeHandle === undefined) {
            if (this.strictCppWasm) {
                this.strictFailure("runtimeHandleMissing");
            }
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                "runtimeHandleMissing",
            );
            return this.fallback.buildMapData(input);
        }
        const tsBasePayloadResult = await this.fallback.buildMapDataPayload(
            input,
            this.buildPayloadOptionsForActiveBase(),
        );
        if (!tsBasePayloadResult.data) {
            this.trackOutcome(
                "tsPayloadEmpty",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsBasePayloadResult);
        }
        const scaffoldIssue = this.validateActiveBasePayloadScaffold(tsBasePayloadResult.data);
        if (scaffoldIssue) {
            if (this.strictCppWasm) {
                this.strictFailure("tsBasePayloadScaffoldInvalid", scaffoldIssue);
            }
            this.trackOutcome(
                "validationFailed",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                scaffoldIssue,
            );
            console.warn(`[map-render-backend] invalid active scaffold payload: ${scaffoldIssue}`);
            return this.fallback.buildMapData(input);
        }
        const byteDrivenSceneBuildInput = this.createByteDrivenSceneBuildInput(input);
        try {
            const bridgePayload = await this.buildWithBridge(
                bridge,
                runtimeHandle,
                input,
                byteDrivenSceneBuildInput,
                tsBasePayloadResult.data,
            );
            if (!bridgePayload) {
                if (this.strictCppWasm) {
                    this.strictFailure("bridgeReturnedEmpty");
                }
                this.trackOutcome(
                    "bridgeReturnedEmpty",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                    this.strictCppWasmPacketGeometry
                        ? "runtimePacketMissingOrIncompleteGeometry=true"
                        : "cacheUploadOrBuildFailed=true",
                );
                return this.fallback.buildMapData(input);
            }
            const validationIssue = this.validateBridgePayload(bridgePayload);
            if (validationIssue) {
                if (this.strictCppWasm) {
                    this.strictFailure("validationFailed", validationIssue);
                }
                console.warn(
                    `[map-render-backend] invalid payload from cpp-wasm backend: ${validationIssue}`,
                );
                this.trackOutcome(
                    "validationFailed",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                    validationIssue,
                );
                return this.fallback.buildMapData(input);
            }
            this.trackOutcome(
                "success",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult({ data: bridgePayload });
        } catch (e) {
            if (this.strictCppWasm) {
                this.strictFailure("bridgeError", errorToString(e));
            }
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            this.trackOutcome(
                "bridgeError",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                errorToString(e),
            );
            return this.fallback.buildMapData(input);
        }
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const t0 = this.options?.telemetry ? performance.now() : undefined;
        return this.buildMapDataActive(input, t0);
    }

    reset(): void {
        this.fallback.reset();
        this.uploadedTypeCacheKey = "";
        this.uploadedTypeIdsByKind.clear();
        this.runtimeInitPromise = undefined;
        const runtimeHandle = this.runtimeHandle;
        this.runtimeHandle = undefined;
        this.runtimeHandlePromise = undefined;
        if (this.bridgePromise) {
            this.bridgePromise.then((bridge) => {
                if (!bridge) {
                    return;
                }
                if (runtimeHandle !== undefined) {
                    bridge.resetRuntime(runtimeHandle);
                    bridge.destroyRuntime(runtimeHandle);
                }
                bridge.reset?.();
            });
        }
    }
}

export async function uploadRuntimeCacheForBuildRequestWithBridge(
    bridge: MapRenderRuntimeBridgeV2,
    runtimeHandle: MapRenderRuntimeHandle,
    request: MapRenderRuntimeBuildRequest,
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    scratchState: MapRenderRuntimeUploadScratchState,
): Promise<boolean> {
    // Avoid intersecting types with private members on the backend class; this is a lightweight
    // "borrow a method + scratch fields" helper for scripts/worker codepaths.
    const helper: any = Object.create(CppWasmMapRenderDataBackend.prototype);
    helper.uploadedTypeCacheKey = scratchState.uploadedTypeCacheKey;
    helper.uploadedTypeIdsByKind = scratchState.uploadedTypeIdsByKind;
    const ok = await helper.uploadRuntimeCacheForBuildRequest(
        bridge,
        runtimeHandle,
        request,
        sceneBuildInput,
    );
    scratchState.uploadedTypeCacheKey = String(helper.uploadedTypeCacheKey ?? "");
    scratchState.uploadedTypeIdsByKind = helper.uploadedTypeIdsByKind ?? new Map();
    return ok;
}

export function createMapRenderDataBackend(
    kind: MapRenderDataBackendKind,
    deps: MapRenderDataBackendDeps,
    options?: MapRenderDataBackendOptions,
): MapRenderDataBackend {
    if (kind === "cpp-wasm") {
        return new CppWasmMapRenderDataBackend(deps, options);
    }
    return new TsMapRenderDataBackend({
        ...deps,
        telemetry: options?.telemetry,
    });
}
