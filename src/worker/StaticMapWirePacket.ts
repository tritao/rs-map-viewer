import type {
    MapObjStateDrawRanges,
    MapObjStateModelInfoIndices,
    MapObjStateModelInfoTextures,
    SdMapData,
    SdRenderableDrawRanges,
} from "../maprender/MapRenderData";
import { MAP_RENDER_DRAW_BUCKET_KEYS } from "../maprender/MapRenderData";
import type {
    MapObjState,
    StaticMapObjState,
} from "../maprender/MapObjState";
import type {
    MapRuntimeBootstrap,
    MapRuntimeRegistration,
    StaticMapPacket,
} from "../runtime/MapRuntimePayload";

type StaticMapWireDrawRanges = Readonly<{
    drawRangeBucketLengths: Int32Array;
    drawRangesPacked: Int32Array;
}>;

type StaticMapDataWire = Omit<SdMapData, "drawRanges"> & StaticMapWireDrawRanges;

type StaticMapObjRenderStateWire = Omit<StaticMapObjState, "renderState"> &
    StaticMapWireDrawRanges &
    Readonly<{
        modelInfoTextures: MapObjStateModelInfoTextures;
        modelInfoIndexBucketLengths: Int32Array;
        modelInfoIndicesPacked: Int32Array;
    }>;

type StaticMapObjStateWire = Readonly<{
    staticState?: StaticMapObjRenderStateWire;
}>;

export type StaticMapWirePacket = Readonly<{
    mapData: StaticMapDataWire;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: Omit<MapRuntimeBootstrap, "mapObjState"> & {
        mapObjState?: StaticMapObjStateWire;
    };
}>;

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

function packDrawRanges(drawRanges: SdRenderableDrawRanges): Readonly<{
    drawRangeBucketLengths: Int32Array;
    drawRangesPacked: Int32Array;
}> {
    const { bucketLengths, packed } = packBucketedInt32Arrays(
        MAP_RENDER_DRAW_BUCKET_KEYS,
        drawRanges,
    );
    return {
        drawRangeBucketLengths: bucketLengths,
        drawRangesPacked: packed,
    };
}

function packModelInfoIndices(
    modelInfoIndices: MapObjStateModelInfoIndices,
): Readonly<{
    modelInfoIndexBucketLengths: Int32Array;
    modelInfoIndicesPacked: Int32Array;
}> {
    const { bucketLengths, packed } = packBucketedInt32Arrays(
        MAP_RENDER_DRAW_BUCKET_KEYS,
        modelInfoIndices,
    );
    return {
        modelInfoIndexBucketLengths: bucketLengths,
        modelInfoIndicesPacked: packed,
    };
}

function unpackDrawRanges(
    drawRangeBucketLengths: Int32Array,
    drawRangesPacked: Int32Array,
): SdRenderableDrawRanges {
    return unpackBucketedInt32Arrays(
        MAP_RENDER_DRAW_BUCKET_KEYS,
        drawRangeBucketLengths,
        drawRangesPacked,
        "StaticMapWirePacket",
    ) as SdRenderableDrawRanges;
}

function encodeMapObjRenderStateWire(
    mapObjState: StaticMapObjState | undefined,
): StaticMapObjRenderStateWire | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        vertices: mapObjState.vertices,
        indices: mapObjState.indices,
        modelInfoTextures: mapObjState.renderState.modelInfoTextures,
        usedTextureIds: mapObjState.usedTextureIds,
        objTypeIds: mapObjState.objTypeIds,
        ...packModelInfoIndices(mapObjState.renderState.modelInfoIndices),
        ...packDrawRanges(mapObjState.renderState.drawRanges),
    };
}

function decodeMapObjRenderStateWire(
    mapObjState: StaticMapObjRenderStateWire | undefined,
): StaticMapObjState | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        vertices: mapObjState.vertices,
        indices: mapObjState.indices,
        renderState: {
            modelInfoTextures: mapObjState.modelInfoTextures,
            modelInfoIndices: unpackBucketedInt32Arrays(
                MAP_RENDER_DRAW_BUCKET_KEYS,
                mapObjState.modelInfoIndexBucketLengths,
                mapObjState.modelInfoIndicesPacked,
                "StaticMapObjStateWire",
            ) as MapObjStateModelInfoIndices,
            drawRanges: unpackDrawRanges(
                mapObjState.drawRangeBucketLengths,
                mapObjState.drawRangesPacked,
            ) as MapObjStateDrawRanges,
        },
        usedTextureIds: mapObjState.usedTextureIds,
        objTypeIds: mapObjState.objTypeIds,
    };
}

function encodeMapObjStateWire(mapObjState: MapObjState | undefined): StaticMapObjStateWire | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        staticState: encodeMapObjRenderStateWire(mapObjState.staticState),
    };
}

function decodeMapObjStateWire(
    mapObjState: StaticMapObjStateWire | undefined,
): MapObjState | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        staticState: decodeMapObjRenderStateWire(mapObjState.staticState),
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
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
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
    const states: Array<StaticMapObjRenderStateWire | undefined> = [mapObjState.staticState];
    for (let index = 0; index < states.length; index++) {
        const state = states[index];
        if (!state) {
            continue;
        }
        pushTransferableUnique(out, seen, state.vertices.buffer as Transferable);
        pushTransferableUnique(out, seen, state.indices.buffer as Transferable);
        pushTransferableUnique(out, seen, state.usedTextureIds.buffer as Transferable);
        pushTransferableUnique(out, seen, state.objTypeIds.buffer as Transferable);
        pushTransferableUnique(out, seen, state.modelInfoIndexBucketLengths.buffer as Transferable);
        pushTransferableUnique(out, seen, state.modelInfoIndicesPacked.buffer as Transferable);
        pushTransferableUnique(out, seen, state.drawRangeBucketLengths.buffer as Transferable);
        pushTransferableUnique(out, seen, state.drawRangesPacked.buffer as Transferable);
        for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
            pushTransferableUnique(out, seen, state.modelInfoTextures[key].buffer as Transferable);
        }
    }
}
