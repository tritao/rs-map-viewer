import { CacheIndex } from "../cache/CacheIndex";
import { MapSquareId, asMapSquareId } from "../ids/Ids";
import { ByteBuffer } from "../io/ByteBuffer";

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
    static decodeMapIndex(bytes: Uint8Array): DatMapFileIndex {
        const buffer = new ByteBuffer(bytes);

        const mapSquares = new Map<number, MapSquare>();

        const count = Math.trunc(buffer.remaining / 7);
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
