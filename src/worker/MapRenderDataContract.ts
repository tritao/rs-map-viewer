import { SdMapData } from "../renderer/loader/SdMapData";
import {
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
    SdRenderableNpcPacketGeometry,
} from "../renderer/loader/SdRenderableData";
import { LocAnimatedData } from "../renderer/loc/LocAnimatedData";
import { NpcData } from "../renderer/npc/NpcData";
import { CollisionData } from "../rs/scene/CollisionMap";
import type { RenderDataResult } from "./RenderDataLoader";

export type MapRenderCommandRuntimeInstance = Readonly<{
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    contourGround: number;
    priority: number;
    interactType: number;
    interactId: number;
}>;

export type MapRenderCommandRuntimeBucketEntry = Readonly<{
    offset: number;
    elements: number;
    instances: ReadonlyArray<MapRenderCommandRuntimeInstance>;
}>;

export type MapRenderCommandBucketsRuntimeInput = Readonly<{
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    buckets: Readonly<{
        base: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        alpha: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        lod: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        lodAlpha: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        interact: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        interactAlpha: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        interactLod: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
        interactLodAlpha: ReadonlyArray<MapRenderCommandRuntimeBucketEntry>;
    }>;
}>;

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
    Pick<MapRenderDataPayload, "heightMapTextureData" | "drawRanges" | "modelInfoTextures">
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
    __packetHandle?: number;
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

    const drawRanges = {
        base: new Int32Array(0),
        alpha: new Int32Array(0),
        lod: new Int32Array(0),
        lodAlpha: new Int32Array(0),
        interact: new Int32Array(0),
        interactAlpha: new Int32Array(0),
        interactLod: new Int32Array(0),
        interactLodAlpha: new Int32Array(0),
    };

    const modelInfoTextures = {
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
        const bucketRanges = new Int32Array(bucketRangeLen);
        if (bucketRangeLen > 0) {
            bucketRanges.set(
                drawRangesPacked.subarray(drawRangeCursor, drawRangeCursor + bucketRangeLen),
            );
        }
        drawRanges[key] = bucketRanges;
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
        const bucketModelInfo = new Uint16Array(modelInfoLength);
        bucketModelInfo.set(packetBucketModelInfo);
        modelInfoTextures[key] = bucketModelInfo;
    }

    const copiedHeightMapTextureData = new Int16Array(heightMapTextureData.length);
    if (heightMapTextureData.length > 0) {
        copiedHeightMapTextureData.set(heightMapTextureData);
    }
    return {
        heightMapTextureData: copiedHeightMapTextureData,
        drawRanges,
        modelInfoTextures,
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

export type MapRenderDataPayloadScaffold = Readonly<
    Omit<MapRenderDataPayload, "heightMapTextureData" | "drawRanges" | "modelInfoTextures">
>;

export function payloadToScaffold(data: MapRenderDataPayload): MapRenderDataPayloadScaffold {
    const {
        heightMapTextureData: _height,
        drawRanges: _drawRanges,
        modelInfoTextures: _modelInfo,
        ...scaffold
    } = data;
    void _height;
    void _drawRanges;
    void _modelInfo;
    return scaffold;
}

export type RuntimePacketToPayloadOptions = Readonly<{
    requirePacketGeometry?: boolean;
}>;

export type RuntimePacketToPayloadFailure = Readonly<{
    stage: "overlay" | "geometry";
    reason: string;
    detail?: Readonly<Record<string, unknown>>;
}>;

export function diagnoseRuntimePacketToPayloadFailure(
    packet: MapRenderRuntimePacket | undefined,
    options?: RuntimePacketToPayloadOptions,
): RuntimePacketToPayloadFailure | undefined {
    if (!packet) {
        return {
            stage: "overlay",
            reason: "packet_missing",
        };
    }
    const overlayFailure: { value?: RuntimePacketOverlayFailure } = {};
    const overlay = buildOverlayFromRuntimePacket(packet, overlayFailure);
    if (!overlay) {
        return {
            stage: "overlay",
            reason: overlayFailure.value?.reason ?? "overlay_build_failed",
            detail: overlayFailure.value?.detail,
        };
    }
    const packetVertices = packet.vertices;
    const packetIndices = packet.indices;
    const hasCompletePacketGeometry =
        packetVertices instanceof Uint8Array &&
        packetVertices.length > 0 &&
        packetIndices instanceof Int32Array &&
        packetIndices.length > 0;
    if (options?.requirePacketGeometry === true && !hasCompletePacketGeometry) {
        return {
            stage: "geometry",
            reason: "required_packet_geometry_missing_or_empty",
            detail: {
                verticesType: valueTypeTag(packetVertices),
                verticesLength: packetVertices instanceof Uint8Array ? packetVertices.length | 0 : -1,
                indicesType: valueTypeTag(packetIndices),
                indicesLength: packetIndices instanceof Int32Array ? packetIndices.length | 0 : -1,
            },
        };
    }
    return undefined;
}

export function runtimePacketToPayload(
    packet: MapRenderRuntimePacket | undefined,
    scaffold: MapRenderDataPayloadScaffold,
    options?: RuntimePacketToPayloadOptions,
): MapRenderDataPayload | undefined {
    const overlay = runtimePacketToPayloadOverlay(packet);
    if (!overlay) {
        return undefined;
    }
    const packetVertices = packet?.vertices;
    const packetIndices = packet?.indices;
    const hasCompletePacketGeometry =
        packetVertices instanceof Uint8Array &&
        packetVertices.length > 0 &&
        packetIndices instanceof Int32Array &&
        packetIndices.length > 0;
    if (options?.requirePacketGeometry === true && !hasCompletePacketGeometry) {
        return undefined;
    }
    const vertices = hasCompletePacketGeometry ? new Uint8Array(packetVertices) : scaffold.vertices;
    const indices = hasCompletePacketGeometry ? new Int32Array(packetIndices) : scaffold.indices;
    // Packet geometry must not reuse TS loc animation ranges: those ranges are offset-coupled to
    // the geometry buffer they were built against and will corrupt render patches if mixed.
    const packetLocsAnimated = (
        packet as Readonly<{ locsAnimated?: LocAnimatedData[] }> | undefined
    )?.locsAnimated;
    const locsAnimated = hasCompletePacketGeometry
        ? Array.isArray(packetLocsAnimated)
            ? packetLocsAnimated
            : []
        : scaffold.locsAnimated;
    const npcGeometry: SdRenderableNpcPacketGeometry | undefined =
        packet?.npcVertices instanceof Uint8Array &&
        packet?.npcIndices instanceof Int32Array &&
        packet?.npcDrawRangesBase instanceof Int32Array &&
        packet.npcVertices.length > 0 &&
        packet.npcIndices.length > 0 &&
        packet.npcDrawRangesBase.length > 0
            ? {
                  drawRangesBase: new Int32Array(packet.npcDrawRangesBase),
                  drawRangesAlpha:
                      packet.npcDrawRangesAlpha instanceof Int32Array
                          ? new Int32Array(packet.npcDrawRangesAlpha)
                          : undefined,
                  vertices: new Uint8Array(packet.npcVertices),
                  indices: new Int32Array(packet.npcIndices),
                  orderKeys:
                      packet.npcOrderKeys instanceof Int32Array
                          ? new Int32Array(packet.npcOrderKeys)
                          : undefined,
              }
            : scaffold.npcGeometry;

    return {
        ...scaffold,
        vertices,
        indices,
        heightMapTextureData: overlay.heightMapTextureData,
        drawRanges: overlay.drawRanges,
        modelInfoTextures: overlay.modelInfoTextures,
        locsAnimated,
        npcGeometry,
    };
}

export type MapRenderDataPayload = Readonly<{
    mapX: number;
    mapY: number;
    cacheName: string;
    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;
    loadLocs: boolean;
    smoothTerrain: boolean;
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];
    minimapBlob: Blob;
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: SdRenderableModelInfoTextures;
    heightMapTextureData: Int16Array;
    drawRanges: SdRenderableDrawRanges;
    locsAnimated: LocAnimatedData[];
    npcs: NpcData[];
    npcGeometry?: SdRenderableNpcPacketGeometry;
    usedTextureIds: Int32Array;
    loadedTextures: ReadonlyArray<readonly [number, Int32Array]>;
}>;

export type MapRenderDataPayloadResult = Readonly<{
    data: MapRenderDataPayload | undefined;
}>;

const DRAW_BUCKET_KEYS = MAP_RENDER_DRAW_BUCKET_KEYS;

function modelInfoLengthFromCount(cmdCount: number, totalInstances: number): number {
    const dataLength = Math.ceil((cmdCount * 4 + totalInstances) / 16) * 16;
    return Math.max(dataLength, 16) * 4;
}

function modelInfoLengthFromDrawRanges(drawRanges: ArrayLike<number>): number {
    const cmdCount = (drawRanges.length / 3) | 0;
    let totalInstances = 0;
    for (let i = 2; i < drawRanges.length; i += 3) {
        totalInstances += drawRanges[i] | 0;
    }
    return modelInfoLengthFromCount(cmdCount, totalInstances);
}

export function validateMapRenderPayload(data: MapRenderDataPayload): string[] {
    const issues: string[] = [];

    const levelsFromFlags = data.tileRenderFlags.length | 0;
    const sizeXFromFlags = data.tileRenderFlags[0]?.length ?? 0;
    const sizeYFromFlags = data.tileRenderFlags[0]?.[0]?.length ?? 0;
    const expectedHeightMapLengthFromFlags = levelsFromFlags * sizeXFromFlags * sizeYFromFlags;
    if (data.heightMapTextureData.length !== expectedHeightMapLengthFromFlags) {
        issues.push(
            `heightMapTextureData length mismatch expected=${expectedHeightMapLengthFromFlags} got=${data.heightMapTextureData.length}`,
        );
    }

    for (const key of DRAW_BUCKET_KEYS) {
        const drawRanges = data.drawRanges[key];
        const modelInfoTexture = data.modelInfoTextures[key];
        const expectedModelInfoLength = modelInfoLengthFromDrawRanges(drawRanges);
        if (modelInfoTexture.length !== expectedModelInfoLength) {
            issues.push(
                `modelInfoTextures.${key} length mismatch expected=${expectedModelInfoLength} got=${modelInfoTexture.length}`,
            );
        }
    }

    // Geometry sanity: catches draw-range/indices corruption that manifests as flicker/black triangles.
    if (data.vertices.length % 16 !== 0) {
        issues.push(`vertices length must be multiple of 16 (got=${data.vertices.length})`);
    }
    const vertexCount = (data.vertices.length / 16) | 0;
    if (vertexCount <= 0) {
        issues.push(`vertexCount must be > 0 (got=${vertexCount})`);
    }
    if (!(data.indices instanceof Int32Array)) {
        issues.push(`indices must be Int32Array`);
    } else {
        let minIndex = 2147483647;
        let maxIndex = -2147483648;
        for (let i = 0; i < data.indices.length; i++) {
            const v = data.indices[i] | 0;
            if (v < minIndex) minIndex = v;
            if (v > maxIndex) maxIndex = v;
        }
        if (minIndex < 0) {
            issues.push(`indices contain negative value min=${minIndex}`);
        }
        if (vertexCount > 0 && maxIndex >= vertexCount) {
            issues.push(`indices out of range max=${maxIndex} vertexCount=${vertexCount}`);
        }
    }

    for (const key of DRAW_BUCKET_KEYS) {
        const ranges = data.drawRanges[key];
        if (ranges.length % 3 !== 0) {
            issues.push(`drawRanges.${key} length must be multiple of 3`);
            continue;
        }
        for (let i = 0; i < ranges.length; i += 3) {
            const offsetBytes = ranges[i] | 0;
            const elements = ranges[i + 1] | 0;
            const instances = ranges[i + 2] | 0;
            if ((offsetBytes & 3) !== 0) {
                issues.push(
                    `drawRanges.${key}[${
                        i / 3
                    }].offset not 4-byte aligned offsetBytes=${offsetBytes}`,
                );
                break;
            }
            if (offsetBytes < 0 || elements < 0) {
                issues.push(
                    `drawRanges.${key}[${
                        i / 3
                    }] has negative offset/elements offsetBytes=${offsetBytes} elements=${elements}`,
                );
                break;
            }
            if (instances < 0) {
                issues.push(`drawRanges.${key}[${i / 3}] has negative instances=${instances}`);
                break;
            }
            const offset = (offsetBytes / 4) | 0;
            if (offset > data.indices.length || elements > data.indices.length - offset) {
                issues.push(
                    `drawRanges.${key}[${
                        i / 3
                    }] out of bounds offset=${offset} elements=${elements} indicesLength=${
                        data.indices.length
                    }`,
                );
                break;
            }
        }
    }

    const baseCmdCount = (data.drawRanges.base.length / 3) | 0;
    const alphaCmdCount = (data.drawRanges.alpha.length / 3) | 0;
    const lodCmdCount = (data.drawRanges.lod.length / 3) | 0;
    const lodAlphaCmdCount = (data.drawRanges.lodAlpha.length / 3) | 0;
    const interactCmdCount = (data.drawRanges.interact.length / 3) | 0;
    const interactAlphaCmdCount = (data.drawRanges.interactAlpha.length / 3) | 0;
    const interactLodCmdCount = (data.drawRanges.interactLod.length / 3) | 0;
    const interactLodAlphaCmdCount = (data.drawRanges.interactLodAlpha.length / 3) | 0;

    const validateLocCmdIndex = (index: number, count: number, name: string, locIndex: number) => {
        const value = index | 0;
        if (value < 0 || value >= count) {
            issues.push(
                "locsAnimated[" +
                    locIndex +
                    "]." +
                    name +
                    " out of bounds index=" +
                    value +
                    " count=" +
                    count,
            );
        }
    };

    const validateAnimRange = (
        range: ReadonlyArray<number>,
        frameType: string,
        locIndex: number,
        frameIndex: number,
    ) => {
        const offsetBytes = range[0] | 0;
        const elements = range[1] | 0;
        if ((offsetBytes & 3) !== 0) {
            issues.push(
                "locsAnimated[" +
                    locIndex +
                    "]." +
                    frameType +
                    "[" +
                    frameIndex +
                    "] offset not 4-byte aligned offsetBytes=" +
                    offsetBytes,
            );
            return;
        }
        if (offsetBytes < 0 || elements < 0) {
            issues.push(
                "locsAnimated[" +
                    locIndex +
                    "]." +
                    frameType +
                    "[" +
                    frameIndex +
                    "] has negative offset/elements offsetBytes=" +
                    offsetBytes +
                    " elements=" +
                    elements,
            );
            return;
        }
        const offset = (offsetBytes / 4) | 0;
        if (offset > data.indices.length || elements > data.indices.length - offset) {
            issues.push(
                "locsAnimated[" +
                    locIndex +
                    "]." +
                    frameType +
                    "[" +
                    frameIndex +
                    "] out of bounds offset=" +
                    offset +
                    " elements=" +
                    elements +
                    " indicesLength=" +
                    data.indices.length,
            );
        }
    };

    for (let locIndex = 0; locIndex < data.locsAnimated.length; locIndex++) {
        const loc = data.locsAnimated[locIndex];
        validateLocCmdIndex(loc.drawRangeIndex, baseCmdCount, "drawRangeIndex", locIndex);
        validateLocCmdIndex(
            loc.drawRangeInteractIndex,
            interactCmdCount,
            "drawRangeInteractIndex",
            locIndex,
        );

        if ((loc.drawRangeLodIndex | 0) >= 0) {
            validateLocCmdIndex(loc.drawRangeLodIndex, lodCmdCount, "drawRangeLodIndex", locIndex);
            validateLocCmdIndex(
                loc.drawRangeInteractLodIndex,
                interactLodCmdCount,
                "drawRangeInteractLodIndex",
                locIndex,
            );
        }

        if (loc.anim.framesAlpha) {
            validateLocCmdIndex(
                loc.drawRangeAlphaIndex,
                alphaCmdCount,
                "drawRangeAlphaIndex",
                locIndex,
            );
            validateLocCmdIndex(
                loc.drawRangeInteractAlphaIndex,
                interactAlphaCmdCount,
                "drawRangeInteractAlphaIndex",
                locIndex,
            );
            if ((loc.drawRangeLodAlphaIndex | 0) >= 0) {
                validateLocCmdIndex(
                    loc.drawRangeLodAlphaIndex,
                    lodAlphaCmdCount,
                    "drawRangeLodAlphaIndex",
                    locIndex,
                );
                validateLocCmdIndex(
                    loc.drawRangeInteractLodAlphaIndex,
                    interactLodAlphaCmdCount,
                    "drawRangeInteractLodAlphaIndex",
                    locIndex,
                );
            }
        }

        for (let frameIndex = 0; frameIndex < loc.anim.frames.length; frameIndex++) {
            validateAnimRange(loc.anim.frames[frameIndex], "anim.frames", locIndex, frameIndex);
        }
        if (loc.anim.framesAlpha) {
            for (let frameIndex = 0; frameIndex < loc.anim.framesAlpha.length; frameIndex++) {
                validateAnimRange(
                    loc.anim.framesAlpha[frameIndex],
                    "anim.framesAlpha",
                    locIndex,
                    frameIndex,
                );
            }
        }
    }

    if (data.npcGeometry) {
        if (data.npcGeometry.drawRangesBase.length % 3 !== 0) {
            issues.push(`npcGeometry.drawRangesBase length must be multiple of 3`);
        }
        if (data.npcGeometry.drawRangesAlpha && data.npcGeometry.drawRangesAlpha.length % 3 !== 0) {
            issues.push(`npcGeometry.drawRangesAlpha length must be multiple of 3`);
        }
        if (
            data.npcGeometry.orderKeys instanceof Int32Array &&
            data.npcGeometry.orderKeys.length !== data.npcGeometry.drawRangesBase.length / 3
        ) {
            issues.push(`npcGeometry.orderKeys length mismatch with drawRangesBase`);
        }
    }

    return issues;
}

export function sdMapDataToPayload(data: SdMapData): MapRenderDataPayload {
    return {
        mapX: data.mapX,
        mapY: data.mapY,
        cacheName: data.cacheName,
        maxLevel: data.maxLevel,
        loadObjs: data.loadObjs,
        loadNpcs: data.loadNpcs,
        loadLocs: data.loadLocs,
        smoothTerrain: data.smoothTerrain,
        borderSize: data.borderSize,
        tileRenderFlags: data.tileRenderFlags,
        collisionDatas: data.collisionDatas,
        minimapBlob: data.minimapBlob,
        vertices: data.vertices,
        indices: data.indices,
        modelInfoTextures: data.modelInfoTextures,
        heightMapTextureData: data.heightMapTextureData,
        drawRanges: data.drawRanges,
        locsAnimated: data.locsAnimated,
        npcs: data.npcs,
        npcGeometry: data.npcGeometry,
        usedTextureIds: data.usedTextureIds,
        loadedTextures: Array.from(data.loadedTextures.entries()),
    };
}

export function payloadToSdMapData(data: MapRenderDataPayload): SdMapData {
    return new SdMapData(
        data.mapX,
        data.mapY,
        data.cacheName,
        data.maxLevel,
        data.loadObjs,
        data.loadNpcs,
        data.loadLocs,
        data.smoothTerrain,
        data.borderSize,
        data.tileRenderFlags,
        data.collisionDatas,
        data.minimapBlob,
        data.vertices,
        data.indices,
        data.modelInfoTextures,
        data.heightMapTextureData,
        data.drawRanges,
        data.locsAnimated,
        data.npcs,
        data.usedTextureIds,
        new Map<number, Int32Array>(data.loadedTextures),
        data.npcGeometry,
    );
}

export function payloadTransferables(data: MapRenderDataPayload): Transferable[] {
    return [
        ...data.tileRenderFlags.flat().map((buf) => buf.buffer as Transferable),
        ...data.collisionDatas.map((collision) => collision.flags.buffer as Transferable),
        ...data.loadedTextures.map(([, pixels]) => pixels.buffer as Transferable),
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
        ...(data.npcGeometry
            ? [
                  data.npcGeometry.vertices.buffer as Transferable,
                  data.npcGeometry.indices.buffer as Transferable,
                  data.npcGeometry.drawRangesBase.buffer as Transferable,
                  ...(data.npcGeometry.drawRangesAlpha
                      ? [data.npcGeometry.drawRangesAlpha.buffer as Transferable]
                      : []),
                  ...(data.npcGeometry.orderKeys
                      ? [data.npcGeometry.orderKeys.buffer as Transferable]
                      : []),
              ]
            : []),
    ];
}

export function payloadResultToRenderDataResult(
    result: MapRenderDataPayloadResult,
): RenderDataResult<SdMapData | undefined> {
    if (!result.data) {
        return {
            data: undefined,
            transferables: [],
        };
    }
    return {
        data: payloadToSdMapData(result.data),
        transferables: payloadTransferables(result.data),
    };
}
