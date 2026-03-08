export {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapData,
    type MapRenderDrawBucketKey,
    type ObjRenderData,
    type SdMapData,
    type SdRenderableData,
    type SdRenderableDrawRanges,
    type SdRenderableModelInfoTextures,
} from "../shared/StaticMapPacket";

export type SdMapLoaderInput = Readonly<{
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;
    loadLocs: boolean;

    smoothTerrain: boolean;

    minimizeDrawCalls: boolean;

    loadedTextureIds: Int32Array;
}>;
