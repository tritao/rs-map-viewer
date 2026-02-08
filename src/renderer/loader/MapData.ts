import { CollisionData } from "../../rs/scene/CollisionMap";

export interface MapData {
    mapX: number;
    mapY: number;

    cacheName: string;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    minimapBlob: Blob;
}
