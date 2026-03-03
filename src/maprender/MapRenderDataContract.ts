import type { SdMapData } from "./payload/SdMapData";
export {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRenderDrawBucketKey,
} from "./payload/SdRenderableData";

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
