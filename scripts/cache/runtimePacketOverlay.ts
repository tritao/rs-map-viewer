import type { SdMapData } from "../../src/maprender/MapRenderPayload";
import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRenderDrawBucketKey,
} from "../../src/maprender/MapRenderPayload";
import type { MapRenderRuntimePacket } from "../../src/wasm/MapRenderRuntimeBridgeAbi";

type OverlayFailure = Readonly<{
    reason: string;
    detail?: Readonly<Record<string, unknown>>;
}>;

export type RuntimeOverlay = Readonly<
    Pick<SdMapData, "heightMapTextureData" | "drawRanges" | "modelInfoTextures">
>;

const MAP_RENDER_DRAW_BUCKET_COUNT = MAP_RENDER_DRAW_BUCKET_KEYS.length;
const EMPTY_I32_ARRAY = new Int32Array(0);
const EMPTY_U16_ARRAY = new Uint16Array(0);

function valueTypeTag(value: unknown): string {
    return Object.prototype.toString.call(value);
}

function validatePacket(packet: MapRenderRuntimePacket): OverlayFailure | undefined {
    if (!(packet.bucketCmdCounts instanceof Int32Array)) {
        return { reason: "invalid_bucket_cmd_counts", detail: { type: valueTypeTag(packet.bucketCmdCounts) } };
    }
    if ((packet.bucketCmdCounts.length | 0) !== MAP_RENDER_DRAW_BUCKET_COUNT) {
        return {
            reason: "invalid_bucket_cmd_counts_length",
            detail: { length: packet.bucketCmdCounts.length | 0, expected: MAP_RENDER_DRAW_BUCKET_COUNT },
        };
    }
    if (!(packet.bucketModelInfoLengths instanceof Int32Array)) {
        return {
            reason: "invalid_bucket_model_info_lengths",
            detail: { type: valueTypeTag(packet.bucketModelInfoLengths) },
        };
    }
    if ((packet.bucketModelInfoLengths.length | 0) !== MAP_RENDER_DRAW_BUCKET_COUNT) {
        return {
            reason: "invalid_bucket_model_info_lengths_length",
            detail: { length: packet.bucketModelInfoLengths.length | 0, expected: MAP_RENDER_DRAW_BUCKET_COUNT },
        };
    }
    if (!(packet.drawRangesPacked instanceof Int32Array)) {
        return { reason: "invalid_draw_ranges_packed", detail: { type: valueTypeTag(packet.drawRangesPacked) } };
    }
    if (!Array.isArray(packet.modelInfoTextureBuckets)) {
        return {
            reason: "invalid_model_info_texture_buckets",
            detail: { type: valueTypeTag(packet.modelInfoTextureBuckets) },
        };
    }
    if ((packet.modelInfoTextureBuckets.length | 0) !== MAP_RENDER_DRAW_BUCKET_COUNT) {
        return {
            reason: "invalid_model_info_texture_buckets_length",
            detail: { length: packet.modelInfoTextureBuckets.length | 0, expected: MAP_RENDER_DRAW_BUCKET_COUNT },
        };
    }
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const bucket = packet.modelInfoTextureBuckets[i];
        if (!(bucket instanceof Uint16Array)) {
            return {
                reason: "invalid_model_info_texture_bucket",
                detail: { index: i | 0, type: valueTypeTag(bucket) },
            };
        }
    }
    if (!(packet.heightMapTextureData instanceof Int16Array)) {
        return {
            reason: "invalid_height_map_texture_data",
            detail: { type: valueTypeTag(packet.heightMapTextureData) },
        };
    }

    let expectedDrawRangeLen = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        expectedDrawRangeLen += (packet.bucketCmdCounts[i] | 0) * 3;
    }
    if ((packet.drawRangesPacked.length | 0) !== (expectedDrawRangeLen | 0)) {
        return {
            reason: "invalid_draw_ranges_packed_length",
            detail: { length: packet.drawRangesPacked.length | 0, expected: expectedDrawRangeLen | 0 },
        };
    }

    return undefined;
}

export function runtimePacketToPayloadOverlay(
    packet: MapRenderRuntimePacket | undefined,
): RuntimeOverlay | undefined {
    if (!packet) {
        return undefined;
    }
    const failure = validatePacket(packet);
    if (failure) {
        return undefined;
    }

    const drawRanges = {} as Record<MapRenderDrawBucketKey, Int32Array>;
    const modelInfoTextures = {} as Record<MapRenderDrawBucketKey, Uint16Array>;

    let drawRangeCursor = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const cmdCount = packet.bucketCmdCounts[i] | 0;
        const bucketRangeLen = cmdCount * 3;
        drawRanges[key] =
            bucketRangeLen > 0
                ? packet.drawRangesPacked.slice(drawRangeCursor, drawRangeCursor + bucketRangeLen)
                : EMPTY_I32_ARRAY;
        drawRangeCursor += bucketRangeLen;

        const modelInfoLength = packet.bucketModelInfoLengths[i] | 0;
        const packetBucketModelInfo = packet.modelInfoTextureBuckets[i];
        modelInfoTextures[key] = modelInfoLength > 0 ? packetBucketModelInfo : EMPTY_U16_ARRAY;
    }

    return {
        heightMapTextureData: packet.heightMapTextureData,
        drawRanges: drawRanges as SdMapData["drawRanges"],
        modelInfoTextures: modelInfoTextures as SdMapData["modelInfoTextures"],
    };
}

export function runtimePacketToPayloadOverlayDiagnostic(
    packet: MapRenderRuntimePacket | undefined,
): Readonly<{ overlay?: RuntimeOverlay; failure?: OverlayFailure }> {
    if (!packet) {
        return { failure: { reason: "missing_packet" } };
    }
    const failure = validatePacket(packet);
    if (failure) {
        return { failure };
    }
    return { overlay: runtimePacketToPayloadOverlay(packet) };
}
