import { DrawRange } from "../../../renderer/DrawRange";
import { MapData } from "../../../renderer/loader/MapData";
import { CollisionData } from "../../../rs/scene/CollisionMap";

export class EditorMapData implements MapData {
    loadObjs: boolean = false;
    loadNpcs: boolean = false;
    smoothTerrain: boolean = false;
    minimapBlob: Blob = new Blob();

    constructor(
        readonly mapX: number,
        readonly mapY: number,
        readonly borderSize: number,

        readonly cacheName: string,
        readonly maxLevel: number,

        readonly tileRenderFlags: Uint8Array[][],
        readonly collisionDatas: CollisionData[],

        readonly vertices: Uint8Array,
        readonly indices: Int32Array,

        readonly terrainDrawRanges: DrawRange[],
        readonly heightMapTextureData: Float32Array,
    ) { }
}
