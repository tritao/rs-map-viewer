import { Archive } from "../cache/format/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { ByteBuffer } from "../io/ByteBuffer";
import { MapSquareId, asMapSquareId } from "../ids/Ids";

export function getMapSquareId(mapX: number, mapY: number): MapSquareId {
    return asMapSquareId((mapX << 8) + mapY);
}

export interface MapFileIndex {
    tryGetTerrainArchiveId(mapX: number, mapY: number): number | undefined;
    tryGetLocArchiveId(mapX: number, mapY: number): number | undefined;
}

class MapSquare {
    constructor(
        readonly mapId: number,
        readonly terrainArchiveId: number,
        readonly locArchiveId: number,
        readonly members: boolean,
    ) {}
}

export class DatMapFileIndex implements MapFileIndex {
    static create(versionListArchive: Archive): DatMapFileIndex {
        const file = versionListArchive.getFileNamed("map_index");
        if (!file) {
            throw new Error("map_index not found");
        }
        const buffer = new ByteBuffer(file.data);

        const mapSquares = new Map<number, MapSquare>();

        const count = (buffer.remaining / 7) | 0;
        for (let i = 0; i < count; i++) {
            const mapId = buffer.readUnsignedShort();
            const terrainArchiveId = buffer.readUnsignedShort();
            const locArchiveId = buffer.readUnsignedShort();
            const members = buffer.readUnsignedByte() === 1;
            mapSquares.set(mapId, new MapSquare(mapId, terrainArchiveId, locArchiveId, members));
        }

        return new DatMapFileIndex(mapSquares);
    }

    constructor(readonly mapSquares: Map<number, MapSquare>) {}

    tryGetTerrainArchiveId(mapX: number, mapY: number): number | undefined {
        return this.mapSquares.get(getMapSquareId(mapX, mapY))?.terrainArchiveId;
    }

    tryGetLocArchiveId(mapX: number, mapY: number): number | undefined {
        return this.mapSquares.get(getMapSquareId(mapX, mapY))?.locArchiveId;
    }
}

export class Dat2MapIndex implements MapFileIndex {
    constructor(readonly mapIndex: CacheIndex) {}

    tryGetTerrainArchiveId(mapX: number, mapY: number): number | undefined {
        return this.mapIndex.tryGetArchiveId(`m${mapX}_${mapY}`);
    }

    tryGetLocArchiveId(mapX: number, mapY: number): number | undefined {
        return this.mapIndex.tryGetArchiveId(`l${mapX}_${mapY}`);
    }
}
