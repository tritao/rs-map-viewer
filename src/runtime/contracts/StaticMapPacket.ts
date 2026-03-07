import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type SdMapData,
    type SdRenderableDrawRanges,
    type MapRuntimeBootstrap,
    type MapRuntimeRegistration,
    buildMapRuntimeBootstrap,
    buildMapRuntimeRegistration,
} from "../../maprender/MapRenderPayload";
import { getMapSquareId } from "../../rs/map/MapFileIndex";

export type StaticMapPacket = Readonly<{
    mapId: number;
    mapData: SdMapData;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}>;

export type SerializedStaticMapPacket = Readonly<{
    mapId: number;
    mapData: Omit<SdMapData, "drawRanges"> & {
        drawRangeBucketLengths: Int32Array;
        drawRangesPacked: Int32Array;
    };
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
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

function packDrawRanges(drawRanges: SdRenderableDrawRanges): Readonly<{
    drawRangeBucketLengths: Int32Array;
    drawRangesPacked: Int32Array;
}> {
    const lengths = new Int32Array(MAP_RENDER_DRAW_BUCKET_KEYS.length);
    let totalLength = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_KEYS.length; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const bucket = drawRanges[key];
        const len = bucket?.length ?? 0;
        lengths[i] = len | 0;
        totalLength += len | 0;
    }
    const packed = new Int32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_KEYS.length; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const bucket = drawRanges[key];
        if (!(bucket instanceof Int32Array) || bucket.length <= 0) {
            continue;
        }
        packed.set(bucket, offset);
        offset += bucket.length | 0;
    }
    return {
        drawRangeBucketLengths: lengths,
        drawRangesPacked: packed,
    };
}

function unpackDrawRanges(
    drawRangeBucketLengths: Int32Array,
    drawRangesPacked: Int32Array,
): SdRenderableDrawRanges {
    const drawRanges = {} as Record<(typeof MAP_RENDER_DRAW_BUCKET_KEYS)[number], Int32Array>;
    let offset = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_KEYS.length; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const len = drawRangeBucketLengths[i] | 0;
        if (len < 0 || offset + len > drawRangesPacked.length) {
            throw new Error(`StaticMapPacket: invalid draw range transport for bucket=${key}`);
        }
        drawRanges[key] = drawRangesPacked.subarray(offset, offset + len);
        offset += len;
    }
    if (offset !== drawRangesPacked.length) {
        throw new Error("StaticMapPacket: draw range transport length mismatch");
    }
    return drawRanges as SdRenderableDrawRanges;
}

export function buildSerializedStaticMapPacket(mapData: SdMapData): SerializedStaticMapPacket {
    const { drawRanges, ...restMapData } = mapData;
    const packedDrawRanges = packDrawRanges(drawRanges);
    return {
        mapId: getMapSquareId(mapData.mapX, mapData.mapY),
        mapData: {
            ...restMapData,
            ...packedDrawRanges,
        },
        runtimeRegistration: buildMapRuntimeRegistration(mapData),
        runtimeBootstrap: buildMapRuntimeBootstrap(mapData),
    };
}

export function hydrateStaticMapPacket(packet: SerializedStaticMapPacket): StaticMapPacket {
    const { drawRangeBucketLengths, drawRangesPacked, ...restMapData } = packet.mapData;
    return {
        mapId: packet.mapId | 0,
        mapData: {
            ...restMapData,
            drawRanges: unpackDrawRanges(drawRangeBucketLengths, drawRangesPacked),
        },
        runtimeRegistration: packet.runtimeRegistration,
        runtimeBootstrap: packet.runtimeBootstrap,
    };
}

export function staticMapPacketTransferables(packet: SerializedStaticMapPacket): Transferable[] {
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
        if (mapData.npcOrderKeys) {
            pushTransferableUnique(
                transferables,
                seen,
                mapData.npcOrderKeys.buffer as Transferable,
            );
        }
    }
    pushTransferableUnique(
        transferables,
        seen,
        packet.runtimeBootstrap.npcOrderKeys.buffer as Transferable,
    );
    return transferables;
}
