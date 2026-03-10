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

export type SdRenderableModelInfoTextures = Readonly<
    Record<MapRenderDrawBucketKey, Uint16Array>
>;

export type SdRenderableDrawRanges = Readonly<Record<MapRenderDrawBucketKey, Int32Array>>;

export type MapObjStateModelInfoTextures = Readonly<
    Record<MapRenderDrawBucketKey, Uint16Array>
>;

export type MapObjStateDrawRanges = Readonly<Record<MapRenderDrawBucketKey, Int32Array>>;

export type MapObjStateModelInfoIndices = Readonly<Record<MapRenderDrawBucketKey, Int32Array>>;

export type ObjRenderData = Readonly<{
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: SdRenderableModelInfoTextures;
    modelInfoIndices: MapObjStateModelInfoIndices;
    drawRanges: SdRenderableDrawRanges;
    usedTextureIds: Int32Array;
    objTypeIds: Int32Array;
}>;

export type SdRenderableData = {
    readonly cacheName: string;

    readonly borderSize: number;
    readonly tileRenderFlags: Uint8Array[][];

    readonly vertices: Uint8Array;
    readonly indices: Int32Array;

    readonly modelInfoTextures: SdRenderableModelInfoTextures;
    readonly drawRanges: SdRenderableDrawRanges;

    readonly loadedTextures: Map<number, Int32Array>;
    readonly npcDrawRangesBase?: Int32Array;
    readonly npcDrawRangesAlpha?: Int32Array;
    readonly npcVertices?: Uint8Array;
    readonly npcIndices?: Int32Array;
};

export interface MapData {
    mapX: number;
    mapY: number;

    cacheName: string;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;
    loadLocs: boolean;

    smoothTerrain: boolean;

    minimapBlob: Blob;
}

export type SdMapData = MapData &
    SdRenderableData & {
        readonly mapId: number;
        readonly heightMapTextureData: Int16Array;
        readonly usedTextureIds: Int32Array;
    };
