import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRuntimeBootstrap,
    type MapRuntimeRegistration,
    type ObjRenderData,
    type SdMapData,
    type SdRenderableDrawRanges,
} from "../../maprender/MapRenderPayload";
import {
    packBucketedInt32Arrays,
    unpackBucketedInt32Arrays,
} from "./BucketArrayTransport";

export type DecodedStaticMapPacket = Readonly<{
    mapData: SdMapData;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}>;

export type StaticMapWirePacket = Readonly<{
    mapData: Omit<SdMapData, "drawRanges"> & {
        drawRangeBucketLengths: Int32Array;
        drawRangesPacked: Int32Array;
    };
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: Omit<MapRuntimeBootstrap, "objRenderData"> & {
        objRenderData?: Omit<ObjRenderData, "drawRanges"> & {
            drawRangeBucketLengths: Int32Array;
            drawRangesPacked: Int32Array;
        };
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

export function encodeStaticMapWirePacket(
    mapData: SdMapData,
    runtimeRegistration: MapRuntimeRegistration,
    runtimeBootstrap: MapRuntimeBootstrap,
): StaticMapWirePacket {
    const { drawRanges, ...restMapData } = mapData;
    const packedDrawRanges = packDrawRanges(drawRanges);
    const objRenderData = runtimeBootstrap.objRenderData;
    return {
        mapData: {
            ...restMapData,
            ...packedDrawRanges,
        },
        runtimeRegistration,
        runtimeBootstrap: {
            ...runtimeBootstrap,
            objRenderData: objRenderData
                ? {
                      ...objRenderData,
                      ...packDrawRanges(objRenderData.drawRanges),
                  }
                : undefined,
        },
    };
}

export function decodeStaticMapWirePacket(packet: StaticMapWirePacket): DecodedStaticMapPacket {
    const { drawRangeBucketLengths, drawRangesPacked, ...restMapData } = packet.mapData;
    const objRenderData = packet.runtimeBootstrap.objRenderData;
    return {
        mapData: {
            ...restMapData,
            drawRanges: unpackDrawRanges(drawRangeBucketLengths, drawRangesPacked),
        },
        runtimeRegistration: packet.runtimeRegistration,
        runtimeBootstrap: {
            ...packet.runtimeBootstrap,
            objRenderData: objRenderData
                ? {
                      ...objRenderData,
                      drawRanges: unpackDrawRanges(
                          objRenderData.drawRangeBucketLengths,
                          objRenderData.drawRangesPacked,
                      ),
                  }
                : undefined,
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
    const objRenderData = packet.runtimeBootstrap.objRenderData;
    if (objRenderData) {
        pushTransferableUnique(transferables, seen, objRenderData.vertices.buffer as Transferable);
        pushTransferableUnique(transferables, seen, objRenderData.indices.buffer as Transferable);
        pushTransferableUnique(
            transferables,
            seen,
            objRenderData.usedTextureIds.buffer as Transferable,
        );
        pushTransferableUnique(
            transferables,
            seen,
            objRenderData.drawRangeBucketLengths.buffer as Transferable,
        );
        pushTransferableUnique(
            transferables,
            seen,
            objRenderData.drawRangesPacked.buffer as Transferable,
        );
        for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
            pushTransferableUnique(
                transferables,
                seen,
                objRenderData.modelInfoTextures[key].buffer as Transferable,
            );
        }
    }
    return transferables;
}
