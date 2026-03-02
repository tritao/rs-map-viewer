import { SdMapData } from "./payload/SdMapData";
import type {
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "./payload/SdRenderableData";

export type MapRenderCommandStreamRuntimeInput = Readonly<{
    sceneTileHeights: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    cmdBucketIndices: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    cmdPackedInstances: Int32Array;
}>;

export const MAP_RENDER_DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
] as const;

export type MapRenderDrawBucketKey = (typeof MAP_RENDER_DRAW_BUCKET_KEYS)[number];
const MAP_RENDER_DRAW_BUCKET_COUNT = MAP_RENDER_DRAW_BUCKET_KEYS.length;
const EMPTY_I32_ARRAY = new Int32Array(0);
const EMPTY_U16_ARRAY = new Uint16Array(0);

export type MapRenderPayloadOverlay = Readonly<
    Pick<SdMapData, "heightMapTextureData" | "drawRanges" | "modelInfoTextures">
>;

export type MapRenderRuntimePacket = Readonly<{
    packetVersion: number;
    bucketCmdCounts: Int32Array;
    bucketModelInfoLengths: Int32Array;
    drawRangesPacked: Int32Array;
    modelInfoTextureBuckets: ReadonlyArray<Uint16Array>;
    heightMapTextureData: Int16Array;
    vertices: Uint8Array;
    indices: Int32Array;
    usedTextureIds: Int32Array;
    npcDrawRangesBase?: Int32Array;
    npcDrawRangesAlpha?: Int32Array;
    npcVertices?: Uint8Array;
    npcIndices?: Int32Array;
    npcOrderKeys?: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    totalModelInfoLength: number;
}>;

type RuntimePacketOverlayFailure = Readonly<{
    reason: string;
    detail?: Readonly<Record<string, unknown>>;
}>;

type ValidatedRuntimePacketOverlayInput = Readonly<{
    bucketCmdCounts: Int32Array;
    bucketModelInfoLengths: Int32Array;
    drawRangesPacked: Int32Array;
    modelInfoTextureBuckets: ReadonlyArray<Uint16Array>;
    heightMapTextureData: Int16Array;
}>;

function valueTypeTag(value: unknown): string {
    return Object.prototype.toString.call(value);
}

function validateRuntimePacketForOverlay(
    packet: MapRenderRuntimePacket,
    failureOut?: { value?: RuntimePacketOverlayFailure },
): ValidatedRuntimePacketOverlayInput | undefined {
    const fail = (reason: string, detail?: Readonly<Record<string, unknown>>) => {
        if (failureOut) {
            failureOut.value = { reason, detail };
        }
        return undefined;
    };
    const packetVersion = packet.packetVersion | 0;
    if (packetVersion !== 1 && packetVersion !== 2 && packetVersion !== 3) {
        return fail("unsupported_packet_version", { packetVersion });
    }
    const bucketCmdCounts = packet.bucketCmdCounts;
    const bucketModelInfoLengths = packet.bucketModelInfoLengths;
    const drawRangesPacked = packet.drawRangesPacked;
    const modelInfoTextureBuckets = packet.modelInfoTextureBuckets;
    const heightMapTextureData = packet.heightMapTextureData;

    if (
        bucketCmdCounts.length !== MAP_RENDER_DRAW_BUCKET_COUNT ||
        bucketModelInfoLengths.length !== MAP_RENDER_DRAW_BUCKET_COUNT
    ) {
        return fail("bucket_lengths_invalid", {
            bucketCmdCountsLength: bucketCmdCounts.length | 0,
            bucketModelInfoLengthsLength: bucketModelInfoLengths.length | 0,
            expected: MAP_RENDER_DRAW_BUCKET_COUNT | 0,
        });
    }

    let totalCmdCount = 0;
    let totalModelInfoLength = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const cmdCount = bucketCmdCounts[i] | 0;
        const modelInfoLength = bucketModelInfoLengths[i] | 0;
        if (cmdCount < 0 || modelInfoLength < 0) {
            return fail("negative_bucket_values", {
                bucketIndex: i,
                bucketKey: MAP_RENDER_DRAW_BUCKET_KEYS[i],
                cmdCount,
                modelInfoLength,
            });
        }
        totalCmdCount += cmdCount;
        totalModelInfoLength += modelInfoLength;
    }
    if ((packet.totalModelInfoLength | 0) !== totalModelInfoLength) {
        return fail("total_model_info_length_mismatch", {
            packetTotalModelInfoLength: packet.totalModelInfoLength | 0,
            computedTotalModelInfoLength: totalModelInfoLength | 0,
        });
    }
    if (
        !(drawRangesPacked instanceof Int32Array) ||
        drawRangesPacked.length !== totalCmdCount * 3
    ) {
        return fail("draw_ranges_packed_invalid", {
            drawRangesPackedType: valueTypeTag(drawRangesPacked),
            drawRangesPackedLength:
                drawRangesPacked instanceof Int32Array ? drawRangesPacked.length | 0 : -1,
            expectedLength: (totalCmdCount * 3) | 0,
        });
    }
    if (
        !Array.isArray(modelInfoTextureBuckets) ||
        modelInfoTextureBuckets.length !== MAP_RENDER_DRAW_BUCKET_COUNT
    ) {
        return fail("model_info_buckets_shape_invalid", {
            modelInfoTextureBucketsType: valueTypeTag(modelInfoTextureBuckets),
            modelInfoTextureBucketsLength: Array.isArray(modelInfoTextureBuckets)
                ? modelInfoTextureBuckets.length | 0
                : -1,
            expected: MAP_RENDER_DRAW_BUCKET_COUNT | 0,
        });
    }

    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const modelInfoLength = bucketModelInfoLengths[i] | 0;
        const packetBucketModelInfo = modelInfoTextureBuckets[i];
        if (
            !(packetBucketModelInfo instanceof Uint16Array) ||
            packetBucketModelInfo.length !== modelInfoLength
        ) {
            return fail("model_info_bucket_invalid", {
                bucketIndex: i,
                bucketKey: key,
                modelInfoLengthExpected: modelInfoLength,
                modelInfoTypeActual: valueTypeTag(packetBucketModelInfo),
                modelInfoLengthActual:
                    packetBucketModelInfo instanceof Uint16Array
                        ? packetBucketModelInfo.length | 0
                        : -1,
            });
        }
    }
    return {
        bucketCmdCounts,
        bucketModelInfoLengths,
        drawRangesPacked,
        modelInfoTextureBuckets,
        heightMapTextureData,
    };
}

function buildOverlayFromValidatedRuntimePacket(
    input: ValidatedRuntimePacketOverlayInput,
): MapRenderPayloadOverlay {
    const drawRanges = {} as Record<MapRenderDrawBucketKey, Int32Array>;
    const modelInfoTextures = {} as Record<MapRenderDrawBucketKey, Uint16Array>;

    let drawRangeCursor = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const cmdCount = input.bucketCmdCounts[i] | 0;
        const bucketRangeLen = cmdCount * 3;
        drawRanges[key] =
            bucketRangeLen > 0
                ? input.drawRangesPacked.slice(drawRangeCursor, drawRangeCursor + bucketRangeLen)
                : EMPTY_I32_ARRAY;
        drawRangeCursor += bucketRangeLen;

        const modelInfoLength = input.bucketModelInfoLengths[i] | 0;
        const packetBucketModelInfo = input.modelInfoTextureBuckets[i];
        modelInfoTextures[key] = modelInfoLength > 0 ? packetBucketModelInfo : EMPTY_U16_ARRAY;
    }

    return {
        heightMapTextureData: input.heightMapTextureData,
        drawRanges: drawRanges as SdRenderableDrawRanges,
        modelInfoTextures: modelInfoTextures as SdRenderableModelInfoTextures,
    };
}

export function runtimePacketToPayloadOverlay(
    packet: MapRenderRuntimePacket | undefined,
): MapRenderPayloadOverlay | undefined {
    if (!packet) {
        return undefined;
    }
    const validated = validateRuntimePacketForOverlay(packet);
    return validated ? buildOverlayFromValidatedRuntimePacket(validated) : undefined;
}

export function runtimePacketToPayloadOverlayDiagnostic(
    packet: MapRenderRuntimePacket | undefined,
): Readonly<{ overlay?: MapRenderPayloadOverlay; failure?: RuntimePacketOverlayFailure }> {
    if (!packet) {
        return { overlay: undefined, failure: { reason: "packet_missing" } };
    }
    const out: { value?: RuntimePacketOverlayFailure } = {};
    const validated = validateRuntimePacketForOverlay(packet, out);
    const overlay = validated ? buildOverlayFromValidatedRuntimePacket(validated) : undefined;
    return { overlay, failure: out.value };
}

export function sdMapDataTransferables(data: SdMapData): Transferable[] {
    const loadedTextureBuffers = Array.from(data.loadedTextures.values()).map(
        (pixels) => pixels.buffer as Transferable,
    );
    const transferables: Transferable[] = [
        ...data.tileRenderFlags.flat().map((buf) => buf.buffer as Transferable),
        ...loadedTextureBuffers,
        data.vertices.buffer as Transferable,
        data.indices.buffer as Transferable,
        data.heightMapTextureData.buffer as Transferable,
        data.usedTextureIds.buffer as Transferable,
    ];
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
        transferables.push(data.modelInfoTextures[key].buffer as Transferable);
    }
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
        transferables.push(data.drawRanges[key].buffer as Transferable);
    }
    if (
        data.npcVertices instanceof Uint8Array &&
        data.npcIndices instanceof Int32Array &&
        data.npcDrawRangesBase instanceof Int32Array
    ) {
        transferables.push(
            data.npcVertices.buffer as Transferable,
            data.npcIndices.buffer as Transferable,
            data.npcDrawRangesBase.buffer as Transferable,
        );
        if (data.npcDrawRangesAlpha) {
            transferables.push(data.npcDrawRangesAlpha.buffer as Transferable);
        }
        if (data.npcOrderKeys) {
            transferables.push(data.npcOrderKeys.buffer as Transferable);
        }
    }
    return transferables;
}
