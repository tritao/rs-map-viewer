import { XteaMap } from "../../util/Caches";
import { MapFileLoader } from "./MapFileLoader";

export interface MapBytesProvider {
    getTerrainBytes(mapX: number, mapY: number): Uint8Array | undefined;
    getLocBytes(mapX: number, mapY: number): Uint8Array | undefined;
    getNpcSpawnBytes(mapX: number, mapY: number): Uint8Array | undefined;
}

export class MapFileBytesProvider implements MapBytesProvider {
    constructor(
        readonly mapFileLoader: MapFileLoader,
        readonly xteasMap: XteaMap,
    ) {}

    getTerrainBytes(mapX: number, mapY: number): Uint8Array | undefined {
        return this.mapFileLoader.getTerrainData(mapX, mapY);
    }

    getLocBytes(mapX: number, mapY: number): Uint8Array | undefined {
        return this.mapFileLoader.getLocData(mapX, mapY, this.xteasMap);
    }

    getNpcSpawnBytes(mapX: number, mapY: number): Uint8Array | undefined {
        return this.mapFileLoader.getNpcSpawnData(mapX, mapY, this.xteasMap);
    }
}

