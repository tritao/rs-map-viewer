import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRuntimeBootstrap,
    type MapRuntimeRegistration,
    type SdMapData,
    type SdRenderableDrawRanges,
} from "../../maprender/MapRenderPayload";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import {
    packBucketedInt32Arrays,
    unpackBucketedInt32Arrays,
} from "./BucketArrayTransport";
import { buildStaticMapPacket, type StaticMapPacket } from "./StaticMapPacket";

export type StaticMapWirePacket = Readonly<{
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
    return {
        mapId: getMapSquareId(mapData.mapX, mapData.mapY),
        mapData: {
            ...restMapData,
            ...packedDrawRanges,
        },
        runtimeRegistration,
        runtimeBootstrap,
    };
}

export function decodeStaticMapWirePacket(packet: StaticMapWirePacket): StaticMapPacket {
    const { drawRangeBucketLengths, drawRangesPacked, ...restMapData } = packet.mapData;
    return buildStaticMapPacket({
        ...restMapData,
        drawRanges: unpackDrawRanges(drawRangeBucketLengths, drawRangesPacked),
    }, packet.runtimeRegistration, packet.runtimeBootstrap);
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
    return transferables;
}
