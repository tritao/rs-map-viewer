import type { SceneLocPlacementOverride } from "../rs/scene/buildSceneFromMapBytesProvider";

export {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapData,
    type MapObjStateDrawRanges,
    type MapObjStateModelInfoIndices,
    type MapObjStateModelInfoTextures,
    type MapRenderDrawBucketKey,
    type ObjRenderData,
    type SdMapData,
    type SdRenderableData,
    type SdRenderableDrawRanges,
    type SdRenderableModelInfoTextures,
} from "./MapRenderData";

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
    locPlacementOverrides?: ReadonlyArray<SceneLocPlacementOverride>;
}>;
