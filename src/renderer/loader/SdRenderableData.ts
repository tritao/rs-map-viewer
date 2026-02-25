import { CollisionData } from "../../rs/scene/CollisionMap";
import { RenderableType } from "../Renderer";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";

export type SdRenderableNpcPacketGeometry = Readonly<{
    drawRangesBase: Int32Array;
    drawRangesAlpha?: Int32Array;
    vertices: Uint8Array;
    indices: Int32Array;
    orderKeys?: Int32Array;
}>;

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

export class SdRenderableData {
    constructor(
        readonly type: RenderableType,
        readonly ids: number,

        readonly cacheName: string,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],
        readonly collisionDatas: CollisionData[],

        readonly vertices: Uint8Array,
        readonly indices: Int32Array,

        readonly modelInfoTextures: SdRenderableModelInfoTextures,
        readonly drawRanges: SdRenderableDrawRanges,

        readonly locsAnimated: LocAnimatedData[],
        readonly npcs: NpcData[],

        readonly loadedTextures: Map<number, Int32Array>,
        readonly npcGeometry?: SdRenderableNpcPacketGeometry,
    ) {}
}
