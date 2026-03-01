import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { CollisionData } from "../../rs/scene/CollisionMap";
import { RenderableType } from "../../renderer/Renderer";
import { LocAnimatedData } from "../../runtime/entities/LocAnimatedData";
import { NpcData } from "../../runtime/entities/NpcData";
import { MapData } from "./MapData";
import {
    SdRenderableData,
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "./SdRenderableData";

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

        readonly usedTextureIds: Int32Array,
        readonly loadedTextures: Map<number, Int32Array>,
        readonly npcDrawRangesBase?: Int32Array,
        readonly npcDrawRangesAlpha?: Int32Array,
        readonly npcVertices?: Uint8Array,
        readonly npcIndices?: Int32Array,
        readonly npcOrderKeys?: Int32Array,
    ) {
        super(
            RenderableType.Map,
            getMapSquareId(mapX, mapY),
            cacheName,
            borderSize,
            tileRenderFlags,
            vertices,
            indices,
            modelInfoTextures,
            drawRanges,
            locsAnimated,
            npcs,
            loadedTextures,
            npcDrawRangesBase,
            npcDrawRangesAlpha,
            npcVertices,
            npcIndices,
            npcOrderKeys,
        );
    }
}
