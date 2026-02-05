import { XteaMap } from "../../util/Caches";
import { CacheIndex } from "../cache/CacheIndex";
import { Bzip2 } from "../compression/Bzip2";
import { ByteBuffer } from "../io/ByteBuffer";
import { MapFileIndex } from "./MapFileIndex";

export class MapFileLoader {
    constructor(
        readonly mapIndex: CacheIndex,
        readonly mapFileIndex: MapFileIndex,
    ) {}

    getTerrainData(mapX: number, mapY: number): Uint8Array | undefined {
        const archiveId = this.mapFileIndex.tryGetTerrainArchiveId(mapX, mapY);
        if (archiveId === undefined) return undefined;
        return this.mapIndex.tryGetFile(archiveId, 0)?.data;
    }

    getLocData(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const archiveId = this.mapFileIndex.tryGetLocArchiveId(mapX, mapY);
        if (archiveId === undefined) return undefined;
        const key = xteasMap.get(archiveId);
        return this.mapIndex.tryGetFileKey(archiveId, 0, key ? key : null)?.data;
    }

    getNpcSpawnData(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const locArchiveId = this.mapFileIndex.tryGetLocArchiveId(mapX, mapY);
        const archiveId = this.mapIndex.tryGetArchiveId(`n${mapX}_${mapY}`);
        if (locArchiveId === undefined || archiveId === undefined) {
            return undefined;
        }
        const key = xteasMap.get(locArchiveId);
        return this.mapIndex.tryGetFileKey(archiveId, 0, key ? key : null)?.data;
    }
}

export class LegacyMapFileLoader extends MapFileLoader {
    decompress(data: Uint8Array): Uint8Array {
        const buffer = new ByteBuffer(data);
        const actualSize = buffer.readInt();
        const compressed = buffer.readUnsignedBytes(buffer.remaining);
        const decompressed = Bzip2.decompress(compressed, actualSize);
        return decompressed;
    }

    override getTerrainData(mapX: number, mapY: number): Uint8Array | undefined {
        const data = super.getTerrainData(mapX, mapY);
        if (!data) {
            return undefined;
        }
        try {
            return this.decompress(data);
        } catch (e) {
            console.error("Failed decompressing terrain data", mapX, mapY, data.length, e);
            return undefined;
        }
    }

    override getLocData(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const data = super.getLocData(mapX, mapY, xteasMap);
        if (!data) {
            return undefined;
        }
        try {
            return this.decompress(data);
        } catch (e) {
            console.error("Failed decompressing loc data", mapX, mapY, data.length, data, e);
            return undefined;
        }
    }
}
