import { RenderableType } from "../../renderer/Renderer";
import { LocAnimatedData } from "../../runtime/entities/LocAnimatedData";

export type SdRenderableModelInfoTextures = {
    readonly base: Uint16Array;
    readonly alpha: Uint16Array;

    readonly lod: Uint16Array;
    readonly lodAlpha: Uint16Array;

    readonly interact: Uint16Array;
    readonly interactAlpha: Uint16Array;

    readonly interactLod: Uint16Array;
    readonly interactLodAlpha: Uint16Array;
};

export type SdRenderableDrawRanges = {
    readonly base: Int32Array;
    readonly alpha: Int32Array;

    readonly lod: Int32Array;
    readonly lodAlpha: Int32Array;

    readonly interact: Int32Array;
    readonly interactAlpha: Int32Array;

    readonly interactLod: Int32Array;
    readonly interactLodAlpha: Int32Array;
};

export type SdRenderableData = {
    readonly type: RenderableType;

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
    readonly npcOrderKeys?: Int32Array;
};
