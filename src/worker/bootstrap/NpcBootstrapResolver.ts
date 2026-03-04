import { type NpcSpawn, getNpcSpawnsUrl } from "../../data/npc/NpcSpawn";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { decodeNpcSpawnsFromBytes } from "../../rs/scene/decodeNpcSpawns";
import { createNpcBootstrapDataFromSpawns } from "../../runtime/sim/NpcBootstrapData";
import type { NpcSpawnEvent } from "../../runtime/sim/NpcEvents";

type ResolveNpcBootstrapDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    cacheInfo: CacheInfo;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
}>;

type ResolveNpcBootstrapInput = Readonly<{
    mapId: number;
    maxLevel: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    npcOrderKeys: Int32Array;
}>;

export type NpcBootstrapSource = "mapBytes" | "fallbackDataset";

export type ResolvedNpcBootstrapData = Readonly<{
    spawnEvents: NpcSpawnEvent[];
    source: NpcBootstrapSource;
    decodedSpawnsCount?: number;
    fallbackUrl?: string;
    fallbackCacheKey?: string;
    fallbackTotalSpawns?: number;
    fallbackMapSpawnsCount?: number;
    fallbackMapSpawnsAllLevelsCount?: number;
}>;

function decodeMapSquareFromId(mapId: number): Readonly<{ mapX: number; mapY: number }> {
    return {
        mapX: (mapId >> 8) & 0xff,
        mapY: mapId & 0xff,
    };
}

function tryHydrateNpcBootstrapFromMapBytes(
    deps: ResolveNpcBootstrapDeps,
    input: ResolveNpcBootstrapInput,
): Readonly<{ spawns: NpcSpawn[]; decodedSpawnsCount: number }> | undefined {
    const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
    const npcSpawnBytes = deps.mapBytesProvider.getNpcSpawnBytes(mapX, mapY);
    if (!(npcSpawnBytes instanceof Uint8Array) || npcSpawnBytes.length === 0) {
        return undefined;
    }
    const decodedSpawns = decodeNpcSpawnsFromBytes(
        input.tileRenderFlagsLevel1,
        input.borderSize,
        mapX,
        mapY,
        npcSpawnBytes,
    );
    if (!decodedSpawns || (decodedSpawns.length | 0) <= 0) {
        return undefined;
    }
    return {
        spawns: decodedSpawns,
        decodedSpawnsCount: decodedSpawns.length | 0,
    };
}

export class NpcBootstrapResolver {
    reset(): void {
        // no-op: fallback spawns are injected from worker bootstrap, not fetched here
    }

    async resolve(
        deps: ResolveNpcBootstrapDeps,
        input: ResolveNpcBootstrapInput,
    ): Promise<ResolvedNpcBootstrapData> {
        const fromMapBytes = tryHydrateNpcBootstrapFromMapBytes(deps, input);
        if (fromMapBytes) {
            const bootstrapData = createNpcBootstrapDataFromSpawns(
                input.mapId | 0,
                fromMapBytes.spawns,
                input.npcOrderKeys,
            );
            return {
                spawnEvents: bootstrapData.spawnEvents,
                source: "mapBytes",
                decodedSpawnsCount: fromMapBytes.decodedSpawnsCount | 0,
            };
        }

        const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
        const fallbackCacheKey = `${deps.cacheInfo.game}:${deps.cacheInfo.revision}:${deps.cacheInfo.name}`;
        const fallbackUrl = getNpcSpawnsUrl(deps.cacheInfo);
        const fallbackSpawns = deps.fallbackNpcSpawns;
        const mapSpawns: NpcSpawn[] = [];
        let mapSpawnsAllLevelsCount = 0;
        for (let i = 0; i < fallbackSpawns.length; i++) {
            const spawn = fallbackSpawns[i]!;
            const npcMapX = (spawn.x / 64) | 0;
            const npcMapY = (spawn.y / 64) | 0;
            if (mapX !== npcMapX || mapY !== npcMapY) {
                continue;
            }
            mapSpawnsAllLevelsCount = (mapSpawnsAllLevelsCount + 1) | 0;
            if ((spawn.level | 0) <= (input.maxLevel | 0)) {
                mapSpawns.push(spawn);
            }
        }
        if ((mapSpawns.length | 0) <= 0) {
            return {
                spawnEvents: [],
                source: "fallbackDataset",
                fallbackUrl,
                fallbackCacheKey,
                fallbackTotalSpawns: fallbackSpawns.length | 0,
                fallbackMapSpawnsCount: 0,
                fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
            };
        }
        const bootstrapData = createNpcBootstrapDataFromSpawns(
            input.mapId | 0,
            mapSpawns,
            input.npcOrderKeys,
        );
        return {
            spawnEvents: bootstrapData.spawnEvents,
            source: "fallbackDataset",
            fallbackUrl,
            fallbackCacheKey,
            fallbackTotalSpawns: fallbackSpawns.length | 0,
            fallbackMapSpawnsCount: mapSpawns.length | 0,
            fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
        };
    }
}
