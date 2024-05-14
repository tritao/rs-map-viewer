import { CollisionData } from "../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";
import { MapData } from "./MapData";

export class SdMapData implements MapData {

    constructor(
        readonly mapX: number,
        readonly mapY: number,

        readonly cacheName: string,

        readonly maxLevel: number,
        readonly loadObjs: boolean,
        readonly loadNpcs: boolean,
        readonly loadLocs: boolean,

        readonly smoothTerrain: boolean,

        readonly borderSize: number,

        readonly tileRenderFlags: Uint8Array[][],
        readonly collisionDatas: CollisionData[],

        readonly minimapBlob: Blob,

        readonly vertices: Uint8Array,
        readonly indices: Int32Array,

        readonly modelTextureData: Uint16Array,
        readonly modelTextureDataAlpha: Uint16Array,

        readonly modelTextureDataLod: Uint16Array,
        readonly modelTextureDataLodAlpha: Uint16Array,

        readonly modelTextureDataInteract: Uint16Array,
        readonly modelTextureDataInteractAlpha: Uint16Array,

        readonly modelTextureDataInteractLod: Uint16Array,
        readonly modelTextureDataInteractLodAlpha: Uint16Array,

        readonly heightMapTextureData: Int16Array,

        readonly drawRanges: DrawRange[],
        readonly drawRangesAlpha: DrawRange[],

        readonly drawRangesLod: DrawRange[],
        readonly drawRangesLodAlpha: DrawRange[],

        readonly drawRangesInteract: DrawRange[],
        readonly drawRangesInteractAlpha: DrawRange[],

        readonly drawRangesInteractLod: DrawRange[],
        readonly drawRangesInteractLodAlpha: DrawRange[],

        readonly locsAnimated: LocAnimatedData[],
        readonly npcs: NpcData[],

        readonly loadedTextures: Map<number, Int32Array>,
    ) {
    }
};
