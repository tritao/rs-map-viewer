import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { CollisionData } from "../../rs/scene/CollisionMap";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";
import { RenderableType } from "../Renderer";
import { MapData } from "./MapData";
import { SdRenderableData, SdRenderableDrawRanges, SdRenderableModelInfoTextures } from "./SdRenderableData";

export class SdMapData extends SdRenderableData implements MapData {

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

        readonly modelInfoTextures: SdRenderableModelInfoTextures,

        readonly heightMapTextureData: Int16Array,

        readonly drawRanges: SdRenderableDrawRanges,

        readonly locsAnimated: LocAnimatedData[],
        readonly npcs: NpcData[],

        readonly loadedTextures: Map<number, Int32Array>,
    ) {
        super(RenderableType.Map, getMapSquareId(mapX, mapY), cacheName, tileRenderFlags,
            collisionDatas, vertices, indices,
            modelInfoTextures, drawRanges, locsAnimated, npcs,
            loadedTextures);
    }
};
