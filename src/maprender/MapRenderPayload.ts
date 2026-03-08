import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/contracts/LocAnimatedData";

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

export type ObjRenderData = Readonly<{
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: SdRenderableModelInfoTextures;
    drawRanges: SdRenderableDrawRanges;
    usedTextureIds: Int32Array;
}>;

export type SdRenderableData = {
    readonly cacheName: string;

    readonly borderSize: number;
    readonly tileRenderFlags: Uint8Array[][];

    readonly vertices: Uint8Array;
    readonly indices: Int32Array;

    readonly modelInfoTextures: SdRenderableModelInfoTextures;
    readonly drawRanges: SdRenderableDrawRanges;

    readonly locsAnimated: LocAnimatedData[];

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

export type MapRuntimeRegistration = Readonly<{
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

export type MapRuntimeBootstrap = Readonly<{
    npcOrderKeys: Int32Array;
    objRenderData?: ObjRenderData;
}>;

export type SdMapData = MapData &
    SdRenderableData & {
        readonly mapId: number;
        readonly heightMapTextureData: Int16Array;
        readonly usedTextureIds: Int32Array;
    };

export function buildMapRuntimeRegistration(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
}): MapRuntimeRegistration {
    return {
        borderSize: input.borderSize | 0,
        tileRenderFlagsLevel1: input.tileRenderFlags[1] ?? [],
        locsAnimated: input.locsAnimated,
        npcTypeAnimationTable: input.npcTypeAnimationTable ?? [],
    };
}

export function buildMapRuntimeBootstrap(input: {
    npcOrderKeys?: Int32Array;
    objRenderData?: ObjRenderData;
}): MapRuntimeBootstrap {
    return {
        npcOrderKeys: input.npcOrderKeys ?? new Int32Array(0),
        objRenderData: input.objRenderData,
    };
}

export function buildMapRuntimePayloads(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
    npcOrderKeys?: Int32Array;
    objRenderData?: ObjRenderData;
}): Readonly<{
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}> {
    return {
        runtimeRegistration: buildMapRuntimeRegistration({
            borderSize: input.borderSize,
            tileRenderFlags: input.tileRenderFlags,
            locsAnimated: input.locsAnimated,
            npcTypeAnimationTable: input.npcTypeAnimationTable,
        }),
        runtimeBootstrap: buildMapRuntimeBootstrap({
            npcOrderKeys: input.npcOrderKeys,
            objRenderData: input.objRenderData,
        }),
    };
}

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
