import { DrawRange } from "../../../renderer/DrawRange";
import { MapData } from "../../../renderer/loader/MapData";
import { CollisionData } from "../../../rs/scene/CollisionMap";

export interface SceneData {
    levels: number;
    sizeX: number;
    sizeY: number;

    // Terrain
    tileHeights: Int32Array[][];

    tileRenderFlags: Uint8Array[][];
    tileUnderlays: Uint16Array[][];
    tileOverlays: Int16Array[][];
    tileShapes: Uint8Array[][];
    tileRotations: Uint8Array[][];

    // Terrain light
    tileLightOcclusions: Uint8Array[][];

    tileLights: Int32Array[][];

    // Underlays
    tileBlendedColors: Int32Array[][];
}

export class EditorMapData implements MapData {
    loadObjs: boolean = false;
    loadNpcs: boolean = false;
    smoothTerrain: boolean = false;
    minimapBlob: Blob = new Blob();
    maxLevel: number;
    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];

    constructor(
        readonly mapX: number,
        readonly mapY: number,
        readonly borderSize: number,

        readonly cacheName: string,

        readonly scene: SceneData,

        readonly vertices: Uint8Array,
        readonly indices: Int32Array,

        readonly terrainDrawRanges: DrawRange[],
        readonly heightMapTextureData: Float32Array,
    ) {
        this.maxLevel = scene.levels;
        this.tileRenderFlags = scene.tileRenderFlags;
        this.collisionDatas = [];
    }
}
