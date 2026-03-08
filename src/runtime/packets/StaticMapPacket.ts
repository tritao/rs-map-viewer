import type { SdMapData } from "../../maprender/MapRenderPayload";
import type { LocAnimatedData } from "../LocAnimatedData";
import type { NpcTypeAnimationEntry } from "../NpcTypeAnimationTable";

const STATIC_MAP_DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
] as const;

type StaticMapDrawBucketKey = (typeof STATIC_MAP_DRAW_BUCKET_KEYS)[number];

type StaticMapModelInfoTextures = Readonly<Record<StaticMapDrawBucketKey, Uint16Array>>;

type StaticMapDrawRanges = Readonly<Record<StaticMapDrawBucketKey, Int32Array>>;

export type MapRuntimeRegistration = Readonly<{
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

export type MapObjStateModelInfoTextures = Readonly<
    Record<StaticMapDrawBucketKey, Uint16Array>
>;

export type MapObjStateDrawRanges = Readonly<Record<StaticMapDrawBucketKey, Int32Array>>;

export type MapObjState = Readonly<{
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: MapObjStateModelInfoTextures;
    drawRanges: MapObjStateDrawRanges;
    usedTextureIds: Int32Array;
}>;

export type MapRuntimeBootstrap = Readonly<{
    npcOrderKeys: Int32Array;
    mapObjState?: MapObjState;
}>;

export function buildMapRuntimeRegistration(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
}): MapRuntimeRegistration {
    return {
        borderSize: input.borderSize | 0,
        tileRenderFlagsLevel1: input.tileRenderFlags[1] ?? [],
        locsAnimated: input.locsAnimated,
        npcTypeAnimationTable: input.npcTypeAnimationTable ?? [],
    };
}

export function buildMapRuntimeBootstrap(input: {
    npcOrderKeys?: Int32Array;
    mapObjState?: MapObjState;
}): MapRuntimeBootstrap {
    return {
        npcOrderKeys: input.npcOrderKeys ?? new Int32Array(0),
        mapObjState: input.mapObjState,
    };
}

export function buildMapRuntimePayloads(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
    npcOrderKeys?: Int32Array;
    mapObjState?: MapObjState;
}): Readonly<{
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}> {
    return {
        runtimeRegistration: buildMapRuntimeRegistration({
            borderSize: input.borderSize,
            tileRenderFlags: input.tileRenderFlags,
            locsAnimated: input.locsAnimated,
            npcTypeAnimationTable: input.npcTypeAnimationTable,
        }),
        runtimeBootstrap: buildMapRuntimeBootstrap({
            npcOrderKeys: input.npcOrderKeys,
            mapObjState: input.mapObjState,
        }),
    };
}

export type StaticMapPacket = Readonly<{
    mapData: SdMapData;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}>;

type StaticMapWireDrawRanges = Readonly<{
    drawRangeBucketLengths: Int32Array;
    drawRangesPacked: Int32Array;
}>;

type StaticMapDataWire = Omit<SdMapData, "drawRanges"> & StaticMapWireDrawRanges;

type StaticMapObjStateWire = Omit<MapObjState, "drawRanges"> & StaticMapWireDrawRanges;

export type StaticMapWirePacket = Readonly<{
    mapData: StaticMapDataWire;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: Omit<MapRuntimeBootstrap, "mapObjState"> & {
        mapObjState?: StaticMapObjStateWire;
    };
}>;

const NPC_DRAW_RANGE_STRIDE = 3;

function pushTransferableUnique(
    out: Transferable[],
    seen: Set<Transferable>,
    transferable: Transferable | undefined,
): void {
    if (!transferable || seen.has(transferable)) {
        return;
    }
    seen.add(transferable);
    out.push(transferable);
}

function packBucketedInt32Arrays<K extends string>(
    keys: ReadonlyArray<K>,
    buckets: Readonly<Record<K, Int32Array>>,
): Readonly<{
    bucketLengths: Int32Array;
    packed: Int32Array;
}> {
    const lengths = new Int32Array(keys.length);
    let totalLength = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const bucket = buckets[key];
        const len = bucket?.length ?? 0;
        lengths[i] = len | 0;
        totalLength += len | 0;
    }
    const packed = new Int32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const bucket = buckets[key];
        if (!(bucket instanceof Int32Array) || bucket.length <= 0) {
            continue;
        }
        packed.set(bucket, offset);
        offset += bucket.length | 0;
    }
    return { bucketLengths: lengths, packed };
}

function unpackBucketedInt32Arrays<K extends string>(
    keys: ReadonlyArray<K>,
    bucketLengths: Int32Array,
    packed: Int32Array,
    errorContext: string,
): Record<K, Int32Array> {
    const buckets = {} as Record<K, Int32Array>;
    let offset = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const len = bucketLengths[i] | 0;
        if (len < 0 || offset + len > packed.length) {
            throw new Error(`${errorContext}: invalid packed bucket for key=${key}`);
        }
        buckets[key] = packed.subarray(offset, offset + len);
        offset += len;
    }
    if (offset !== packed.length) {
        throw new Error(`${errorContext}: packed bucket length mismatch`);
    }
    return buckets;
}

function packDrawRanges(drawRanges: StaticMapDrawRanges): Readonly<{
    drawRangeBucketLengths: Int32Array;
    drawRangesPacked: Int32Array;
}> {
    const { bucketLengths, packed } = packBucketedInt32Arrays(
        STATIC_MAP_DRAW_BUCKET_KEYS,
        drawRanges,
    );
    return {
        drawRangeBucketLengths: bucketLengths,
        drawRangesPacked: packed,
    };
}

function unpackDrawRanges(
    drawRangeBucketLengths: Int32Array,
    drawRangesPacked: Int32Array,
): StaticMapDrawRanges {
    return unpackBucketedInt32Arrays(
        STATIC_MAP_DRAW_BUCKET_KEYS,
        drawRangeBucketLengths,
        drawRangesPacked,
        "StaticMapWirePacket",
    ) as StaticMapDrawRanges;
}

type MapObjRenderDataLike = Readonly<{
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: StaticMapModelInfoTextures;
    drawRanges: StaticMapDrawRanges;
    usedTextureIds: Int32Array;
}>;

export function mapObjStateFromRenderData(
    objRenderData: MapObjRenderDataLike | undefined,
): MapObjState | undefined {
    if (!objRenderData) {
        return undefined;
    }
    return {
        vertices: objRenderData.vertices,
        indices: objRenderData.indices,
        modelInfoTextures: objRenderData.modelInfoTextures,
        drawRanges: objRenderData.drawRanges,
        usedTextureIds: objRenderData.usedTextureIds,
    };
}

export function mapObjStateToRenderData(
    mapObjState: MapObjState | undefined,
): MapObjRenderDataLike | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        vertices: mapObjState.vertices,
        indices: mapObjState.indices,
        modelInfoTextures: mapObjState.modelInfoTextures,
        drawRanges: mapObjState.drawRanges,
        usedTextureIds: mapObjState.usedTextureIds,
    };
}

function encodeMapObjStateWire(mapObjState: MapObjState | undefined): StaticMapObjStateWire | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        ...mapObjState,
        ...packDrawRanges(mapObjState.drawRanges),
    };
}

function decodeMapObjStateWire(
    mapObjState: StaticMapObjStateWire | undefined,
): MapObjState | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        ...mapObjState,
        drawRanges: unpackDrawRanges(
            mapObjState.drawRangeBucketLengths,
            mapObjState.drawRangesPacked,
        ),
    };
}

export function encodeStaticMapWirePacket(
    mapData: SdMapData,
    runtimeRegistration: MapRuntimeRegistration,
    runtimeBootstrap: MapRuntimeBootstrap,
): StaticMapWirePacket {
    const { drawRanges, ...restMapData } = mapData;
    const packedDrawRanges = packDrawRanges(drawRanges);
    return {
        mapData: {
            ...restMapData,
            ...packedDrawRanges,
        },
        runtimeRegistration,
        runtimeBootstrap: {
            ...runtimeBootstrap,
            mapObjState: encodeMapObjStateWire(runtimeBootstrap.mapObjState),
        },
    };
}

export function decodeStaticMapWirePacket(packet: StaticMapWirePacket): StaticMapPacket {
    const { drawRangeBucketLengths, drawRangesPacked, ...restMapData } = packet.mapData;
    return {
        mapData: {
            ...restMapData,
            drawRanges: unpackDrawRanges(drawRangeBucketLengths, drawRangesPacked),
        },
        runtimeRegistration: packet.runtimeRegistration,
        runtimeBootstrap: {
            ...packet.runtimeBootstrap,
            mapObjState: decodeMapObjStateWire(packet.runtimeBootstrap.mapObjState),
        },
    };
}

export function getStaticMapNpcSlotCount(packet: StaticMapPacket): number {
    const mapData = packet.mapData;
    const npcDrawRangeInts = mapData.npcDrawRangesBase?.length ?? 0;
    if (npcDrawRangeInts % NPC_DRAW_RANGE_STRIDE !== 0) {
        throw new Error(
            `[map-render][npc] invalid npcDrawRangesBase length for map ${mapData.mapX},${mapData.mapY}: ` +
                `len=${npcDrawRangeInts} stride=${NPC_DRAW_RANGE_STRIDE}`,
        );
    }
    return (npcDrawRangeInts / NPC_DRAW_RANGE_STRIDE) | 0;
}

export function getValidatedStaticMapNpcOrderKeys(packet: StaticMapPacket): Int32Array {
    const npcOrderKeys = packet.runtimeBootstrap.npcOrderKeys;
    const npcSlotCount = getStaticMapNpcSlotCount(packet);
    if ((npcOrderKeys.length | 0) !== (npcSlotCount | 0)) {
        throw new Error(
            `[map-render][npc] npc slot metadata mismatch for mapId=${packet.mapData.mapId | 0}: ` +
                `orderKeys=${npcOrderKeys.length | 0} slots=${npcSlotCount | 0}`,
        );
    }
    return npcOrderKeys;
}

export function collectStaticMapWirePacketTransferables(
    packet: StaticMapWirePacket,
): Transferable[] {
    const transferables: Transferable[] = [];
    const seen = new Set<Transferable>();
    const mapData = packet.mapData;
    for (const tileFlags of mapData.tileRenderFlags.flat()) {
        pushTransferableUnique(transferables, seen, tileFlags.buffer as Transferable);
    }
    for (const pixels of mapData.loadedTextures.values()) {
        pushTransferableUnique(transferables, seen, pixels.buffer as Transferable);
    }
    pushTransferableUnique(transferables, seen, mapData.vertices.buffer as Transferable);
    pushTransferableUnique(transferables, seen, mapData.indices.buffer as Transferable);
    pushTransferableUnique(
        transferables,
        seen,
        mapData.heightMapTextureData.buffer as Transferable,
    );
    pushTransferableUnique(transferables, seen, mapData.usedTextureIds.buffer as Transferable);
    pushTransferableUnique(
        transferables,
        seen,
        mapData.drawRangeBucketLengths.buffer as Transferable,
    );
    pushTransferableUnique(transferables, seen, mapData.drawRangesPacked.buffer as Transferable);
    for (const key of STATIC_MAP_DRAW_BUCKET_KEYS) {
        pushTransferableUnique(
            transferables,
            seen,
            mapData.modelInfoTextures[key].buffer as Transferable,
        );
    }
    if (
        mapData.npcVertices instanceof Uint8Array &&
        mapData.npcIndices instanceof Int32Array &&
        mapData.npcDrawRangesBase instanceof Int32Array
    ) {
        pushTransferableUnique(transferables, seen, mapData.npcVertices.buffer as Transferable);
        pushTransferableUnique(transferables, seen, mapData.npcIndices.buffer as Transferable);
        pushTransferableUnique(
            transferables,
            seen,
            mapData.npcDrawRangesBase.buffer as Transferable,
        );
        if (mapData.npcDrawRangesAlpha) {
            pushTransferableUnique(
                transferables,
                seen,
                mapData.npcDrawRangesAlpha.buffer as Transferable,
            );
        }
    }
    pushTransferableUnique(
        transferables,
        seen,
        packet.runtimeBootstrap.npcOrderKeys.buffer as Transferable,
    );
    collectMapObjStateWireTransferables(
        transferables,
        seen,
        packet.runtimeBootstrap.mapObjState,
    );
    return transferables;
}

function collectMapObjStateWireTransferables(
    out: Transferable[],
    seen: Set<Transferable>,
    mapObjState: StaticMapObjStateWire | undefined,
): void {
    if (!mapObjState) {
        return;
    }
    pushTransferableUnique(out, seen, mapObjState.vertices.buffer as Transferable);
    pushTransferableUnique(out, seen, mapObjState.indices.buffer as Transferable);
    pushTransferableUnique(out, seen, mapObjState.usedTextureIds.buffer as Transferable);
    pushTransferableUnique(out, seen, mapObjState.drawRangeBucketLengths.buffer as Transferable);
    pushTransferableUnique(out, seen, mapObjState.drawRangesPacked.buffer as Transferable);
    for (const key of STATIC_MAP_DRAW_BUCKET_KEYS) {
        pushTransferableUnique(
            out,
            seen,
            mapObjState.modelInfoTextures[key].buffer as Transferable,
        );
    }
}
