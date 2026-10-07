import type {
    WorldChunkData,
    WorldChunkRequest,
    WorldChunkSource,
} from "../../core/content/WorldChunkSource";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";

function decodeMapSquareFromId(chunkId: number): Readonly<{ mapX: number; mapY: number }> {
    return {
        mapX: (chunkId >> 8) & 0xff,
        mapY: chunkId & 0xff,
    };
}

export class RunescapeWorldChunkSource implements MapBytesProvider, WorldChunkSource {
    constructor(private readonly mapBytesProvider: MapBytesProvider) {}

    getTerrainBytes(mapX: number, mapY: number): Uint8Array | undefined {
        return this.mapBytesProvider.getTerrainBytes(mapX, mapY);
    }

    getLocBytes(mapX: number, mapY: number): Uint8Array | undefined {
        return this.mapBytesProvider.getLocBytes(mapX, mapY);
    }

    getNpcSpawnBytes(mapX: number, mapY: number): Uint8Array | undefined {
        return this.mapBytesProvider.getNpcSpawnBytes(mapX, mapY);
    }

    async loadChunk(request: WorldChunkRequest): Promise<WorldChunkData | undefined> {
        const chunkId = request.chunkId | 0;
        const { mapX, mapY } = decodeMapSquareFromId(chunkId);
        const terrain = this.getTerrainBytes(mapX, mapY);
        const staticInstances = this.getLocBytes(mapX, mapY);
        const actorSpawns = this.getNpcSpawnBytes(mapX, mapY);
        if (!terrain && !staticInstances && !actorSpawns) {
            return undefined;
        }
        return {
            chunkId,
            terrain,
            staticInstances,
            actorSpawns,
            metadata: {
                mapX,
                mapY,
                lod: request.lod,
            },
        };
    }
}

export function requireRunescapeWorldChunkSource(
    chunkSource: WorldChunkSource,
): RunescapeWorldChunkSource {
    if (chunkSource instanceof RunescapeWorldChunkSource) {
        return chunkSource;
    }
    throw new Error("Expected RunescapeWorldChunkSource");
}
