import type { SdMapData } from "../payload/SdMapData";
import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRenderDrawBucketKey,
} from "../payload/SdRenderableData";
import type { MapRenderRuntimePacket } from "../../wasm/MapRenderRuntimeBridgeAbi";

export type MapRenderPayloadOverlay = Readonly<
    Pick<SdMapData, "heightMapTextureData" | "drawRanges" | "modelInfoTextures">
>;

const MAP_RENDER_DRAW_BUCKET_COUNT = MAP_RENDER_DRAW_BUCKET_KEYS.length;
const EMPTY_I32_ARRAY = new Int32Array(0);
const EMPTY_U16_ARRAY = new Uint16Array(0);

export function runtimePacketToPayloadOverlay(
    packet: MapRenderRuntimePacket | undefined,
): MapRenderPayloadOverlay | undefined {
    if (!packet) {
        return undefined;
    }
    const bucketCmdCounts = packet.bucketCmdCounts;
    const drawRangesPacked = packet.drawRangesPacked;
    const modelInfoTextureBuckets = packet.modelInfoTextureBuckets;
    const heightMapTextureData = packet.heightMapTextureData;

    if (
        !(bucketCmdCounts instanceof Int32Array) ||
        bucketCmdCounts.length !== MAP_RENDER_DRAW_BUCKET_COUNT ||
        !(drawRangesPacked instanceof Int32Array) ||
        !(heightMapTextureData instanceof Int16Array) ||
        !Array.isArray(modelInfoTextureBuckets) ||
        modelInfoTextureBuckets.length !== MAP_RENDER_DRAW_BUCKET_COUNT
    ) {
        return undefined;
    }

    let totalCmdCount = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const cmdCount = bucketCmdCounts[i] | 0;
        if (cmdCount < 0) {
            return undefined;
        }
        totalCmdCount += cmdCount;
    }
    if (drawRangesPacked.length !== totalCmdCount * 3) {
        return undefined;
    }

    const drawRanges = {} as Record<MapRenderDrawBucketKey, Int32Array>;
    const modelInfoTextures = {} as Record<MapRenderDrawBucketKey, Uint16Array>;

    let drawRangeCursor = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const cmdCount = bucketCmdCounts[i] | 0;
        const bucketRangeLen = cmdCount * 3;
        drawRanges[key] =
            bucketRangeLen > 0
                ? drawRangesPacked.subarray(drawRangeCursor, drawRangeCursor + bucketRangeLen)
                : EMPTY_I32_ARRAY;
        drawRangeCursor += bucketRangeLen;

        const packetBucketModelInfo = modelInfoTextureBuckets[i];
        modelInfoTextures[key] =
            packetBucketModelInfo instanceof Uint16Array ? packetBucketModelInfo : EMPTY_U16_ARRAY;
    }

    return {
        heightMapTextureData,
        drawRanges: drawRanges as SdMapData["drawRanges"],
        modelInfoTextures: modelInfoTextures as SdMapData["modelInfoTextures"],
    };
}
