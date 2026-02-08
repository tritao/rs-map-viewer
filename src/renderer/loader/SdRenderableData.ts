import { CollisionData } from "../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { RenderableType } from "../Renderer";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";

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
    readonly base: DrawRange[];
    readonly alpha: DrawRange[];

    readonly lod: DrawRange[];
    readonly lodAlpha: DrawRange[];

    readonly interact: DrawRange[];
    readonly interactAlpha: DrawRange[];

    readonly interactLod: DrawRange[];
    readonly interactLodAlpha: DrawRange[];
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
    ) {}
}
