import { XteaMap } from "../../util/Caches";
import { CacheIndex } from "../cache/CacheIndex";
import { Bzip2 } from "../compression/Bzip2";
import { ByteBuffer } from "../io/ByteBuffer";
import { MapFileIndex } from "./MapFileIndex";

export interface MapIndexBytesProvider {
    tryGetArchiveId(name: string): number | undefined;
    tryGetFile(archiveId: number, fileId: number): Uint8Array | undefined;
    tryGetFileKey(archiveId: number, fileId: number, key: number[] | null): Uint8Array | undefined;
}

/** Adapter for when you still have a `CacheIndex` at the boundary. */
export class CacheIndexMapBytesProvider implements MapIndexBytesProvider {
    constructor(readonly index: CacheIndex) {}

    tryGetArchiveId(name: string): number | undefined {
        return this.index.tryGetArchiveId(name);
    }

    tryGetFile(archiveId: number, fileId: number): Uint8Array | undefined {
        return this.index.tryGetFile(archiveId, fileId)?.data;
    }

    tryGetFileKey(archiveId: number, fileId: number, key: number[] | null): Uint8Array | undefined {
        return this.index.tryGetFileKey(archiveId, fileId, key)?.data;
    }
}

export class MapFileLoader {
    constructor(
        readonly mapSource: MapIndexBytesProvider,
        readonly mapFileIndex: MapFileIndex,
    ) {}

    getTerrainData(mapX: number, mapY: number): Uint8Array | undefined {
        const archiveId = this.mapFileIndex.tryGetTerrainArchiveId(mapX, mapY);
        if (archiveId === undefined) return undefined;
        return this.mapSource.tryGetFile(archiveId, 0);
    }

    getLocData(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const archiveId = this.mapFileIndex.tryGetLocArchiveId(mapX, mapY);
        if (archiveId === undefined) return undefined;
        const key = xteasMap.get(archiveId);
        return this.mapSource.tryGetFileKey(archiveId, 0, key ? key : null);
    }

    getNpcSpawnData(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const locArchiveId = this.mapFileIndex.tryGetLocArchiveId(mapX, mapY);
        const archiveId = this.mapSource.tryGetArchiveId(`n${mapX}_${mapY}`);
        if (locArchiveId === undefined || archiveId === undefined) {
            return undefined;
        }
        const key = xteasMap.get(locArchiveId);
        return this.mapSource.tryGetFileKey(archiveId, 0, key ? key : null);
    }
}

export class LegacyMapFileLoader extends MapFileLoader {
    private readonly terrainDecompressErrors: Set<number> = new Set();
    private readonly locDecompressErrors: Set<number> = new Set();

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
            const mapId = (mapX << 8) + mapY;
            if (!this.terrainDecompressErrors.has(mapId)) {
                console.error("Failed decompressing terrain data", mapX, mapY, data.length, e);
                this.terrainDecompressErrors.add(mapId);
            }
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
            const mapId = (mapX << 8) + mapY;
            if (!this.locDecompressErrors.has(mapId)) {
                console.error("Failed decompressing loc data", mapX, mapY, data.length, data, e);
                this.locDecompressErrors.add(mapId);
            }
            return undefined;
        }
    }
}
