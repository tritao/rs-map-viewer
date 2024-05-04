import { CollisionData } from "../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";

export type SdModelData = {
    modelId: number;

    cacheName: string;

    borderSize: number;

    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];

    vertices: Uint8Array;
    indices: Int32Array;

    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;

    modelTextureDataLod: Uint16Array;
    modelTextureDataLodAlpha: Uint16Array;

    modelTextureDataInteract: Uint16Array;
    modelTextureDataInteractAlpha: Uint16Array;

    modelTextureDataInteractLod: Uint16Array;
    modelTextureDataInteractLodAlpha: Uint16Array;

    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];

    drawRangesLod: DrawRange[];
    drawRangesLodAlpha: DrawRange[];

    drawRangesInteract: DrawRange[];
    drawRangesInteractAlpha: DrawRange[];

    drawRangesInteractLod: DrawRange[];
    drawRangesInteractLodAlpha: DrawRange[];

    locsAnimated: LocAnimatedData[];

    loadedTextures: Map<number, Int32Array>;
};
