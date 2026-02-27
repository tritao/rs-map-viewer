import { SdMapData } from "../renderer/loader/SdMapData";
import type {
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "../renderer/loader/SdRenderableData";

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

function valueTypeTag(value: unknown): string {
    return Object.prototype.toString.call(value);
}

function buildOverlayFromRuntimePacket(
    packet: MapRenderRuntimePacket,
    failureOut?: { value?: RuntimePacketOverlayFailure },
): MapRenderPayloadOverlay | undefined {
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
        bucketCmdCounts.length !== MAP_RENDER_DRAW_BUCKET_KEYS.length ||
        bucketModelInfoLengths.length !== MAP_RENDER_DRAW_BUCKET_KEYS.length
    ) {
        return fail("bucket_lengths_invalid", {
            bucketCmdCountsLength: bucketCmdCounts.length | 0,
            bucketModelInfoLengthsLength: bucketModelInfoLengths.length | 0,
            expected: MAP_RENDER_DRAW_BUCKET_KEYS.length | 0,
        });
    }

    let totalCmdCount = 0;
    let totalModelInfoLength = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_KEYS.length; i++) {
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
        modelInfoTextureBuckets.length !== MAP_RENDER_DRAW_BUCKET_KEYS.length
    ) {
        return fail("model_info_buckets_shape_invalid", {
            modelInfoTextureBucketsType: valueTypeTag(modelInfoTextureBuckets),
            modelInfoTextureBucketsLength: Array.isArray(modelInfoTextureBuckets)
                ? modelInfoTextureBuckets.length | 0
                : -1,
            expected: MAP_RENDER_DRAW_BUCKET_KEYS.length | 0,
        });
    }

    const drawRanges: Record<MapRenderDrawBucketKey, Int32Array> = {
        base: new Int32Array(0),
        alpha: new Int32Array(0),
        lod: new Int32Array(0),
        lodAlpha: new Int32Array(0),
        interact: new Int32Array(0),
        interactAlpha: new Int32Array(0),
        interactLod: new Int32Array(0),
        interactLodAlpha: new Int32Array(0),
    };

    const modelInfoTextures: Record<MapRenderDrawBucketKey, Uint16Array> = {
        base: new Uint16Array(0),
        alpha: new Uint16Array(0),
        lod: new Uint16Array(0),
        lodAlpha: new Uint16Array(0),
        interact: new Uint16Array(0),
        interactAlpha: new Uint16Array(0),
        interactLod: new Uint16Array(0),
        interactLodAlpha: new Uint16Array(0),
    };

    let drawRangeCursor = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_KEYS.length; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const cmdCount = bucketCmdCounts[i] | 0;
        const bucketRangeLen = cmdCount * 3;
        drawRanges[key] =
            bucketRangeLen > 0
                ? drawRangesPacked.slice(drawRangeCursor, drawRangeCursor + bucketRangeLen)
                : new Int32Array(0);
        drawRangeCursor += bucketRangeLen;

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
        modelInfoTextures[key] = packetBucketModelInfo;
    }

    return {
        heightMapTextureData,
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
    return buildOverlayFromRuntimePacket(packet);
}

export function sdMapDataTransferables(data: SdMapData): Transferable[] {
    const loadedTextureBuffers = Array.from(data.loadedTextures.values()).map(
        (pixels) => pixels.buffer as Transferable,
    );
    return [
        ...data.tileRenderFlags.flat().map((buf) => buf.buffer as Transferable),
        ...data.collisionDatas.map((collision) => collision.flags.buffer as Transferable),
        ...loadedTextureBuffers,
        data.vertices.buffer as Transferable,
        data.indices.buffer as Transferable,
        data.heightMapTextureData.buffer as Transferable,
        data.usedTextureIds.buffer as Transferable,
        data.modelInfoTextures.base.buffer as Transferable,
        data.modelInfoTextures.alpha.buffer as Transferable,
        data.modelInfoTextures.lod.buffer as Transferable,
        data.modelInfoTextures.lodAlpha.buffer as Transferable,
        data.modelInfoTextures.interact.buffer as Transferable,
        data.modelInfoTextures.interactAlpha.buffer as Transferable,
        data.modelInfoTextures.interactLod.buffer as Transferable,
        data.modelInfoTextures.interactLodAlpha.buffer as Transferable,
        data.drawRanges.base.buffer as Transferable,
        data.drawRanges.alpha.buffer as Transferable,
        data.drawRanges.lod.buffer as Transferable,
        data.drawRanges.lodAlpha.buffer as Transferable,
        data.drawRanges.interact.buffer as Transferable,
        data.drawRanges.interactAlpha.buffer as Transferable,
        data.drawRanges.interactLod.buffer as Transferable,
        data.drawRanges.interactLodAlpha.buffer as Transferable,
        ...(data.npcVertices instanceof Uint8Array &&
        data.npcIndices instanceof Int32Array &&
        data.npcDrawRangesBase instanceof Int32Array
            ? [
                  data.npcVertices.buffer as Transferable,
                  data.npcIndices.buffer as Transferable,
                  data.npcDrawRangesBase.buffer as Transferable,
                  ...(data.npcDrawRangesAlpha
                      ? [data.npcDrawRangesAlpha.buffer as Transferable]
                      : []),
                  ...(data.npcOrderKeys ? [data.npcOrderKeys.buffer as Transferable] : []),
              ]
            : []),
    ];
}
