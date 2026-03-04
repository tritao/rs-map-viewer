import { type NpcSpawn, fetchNpcSpawns, getNpcSpawnsUrl } from "../../data/npc/NpcSpawn";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { decodeNpcSpawnsFromBytes } from "../../rs/scene/decodeNpcSpawns";
import { type NpcBootstrapData, createNpcBootstrapDataFromSpawns } from "./NpcBootstrapData";

type ResolveNpcBootstrapDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    cacheInfo: CacheInfo;
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
    data: NpcBootstrapData;
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
    private fallbackNpcSpawnsPromise: Promise<NpcSpawn[]> | undefined;
    private fallbackNpcSpawnsCacheKey: string | undefined;

    reset(): void {
        this.fallbackNpcSpawnsPromise = undefined;
        this.fallbackNpcSpawnsCacheKey = undefined;
    }

    private getFallbackNpcSpawns(cacheInfo: CacheInfo): Promise<NpcSpawn[]> {
        const cacheKey = `${cacheInfo.game}:${cacheInfo.revision}:${cacheInfo.name}`;
        if (this.fallbackNpcSpawnsPromise && this.fallbackNpcSpawnsCacheKey === cacheKey) {
            return this.fallbackNpcSpawnsPromise;
        }
        const url = getNpcSpawnsUrl(cacheInfo);
        const promise = fetchNpcSpawns(url).catch((error: unknown) => {
            console.error("[map-render][npc-spawns] failed to fetch fallback spawn dataset", {
                cacheKey,
                url,
                error,
            });
            if (this.fallbackNpcSpawnsCacheKey === cacheKey) {
                this.fallbackNpcSpawnsPromise = undefined;
                this.fallbackNpcSpawnsCacheKey = undefined;
            }
            return [];
        });
        this.fallbackNpcSpawnsPromise = promise;
        this.fallbackNpcSpawnsCacheKey = cacheKey;
        return promise;
    }

    async resolve(
        deps: ResolveNpcBootstrapDeps,
        input: ResolveNpcBootstrapInput,
    ): Promise<ResolvedNpcBootstrapData> {
        const fromMapBytes = tryHydrateNpcBootstrapFromMapBytes(deps, input);
        if (fromMapBytes) {
            return {
                data: createNpcBootstrapDataFromSpawns(
                    input.mapId | 0,
                    fromMapBytes.spawns,
                    input.npcOrderKeys,
                ),
                source: "mapBytes",
                decodedSpawnsCount: fromMapBytes.decodedSpawnsCount | 0,
            };
        }

        const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
        const fallbackCacheKey = `${deps.cacheInfo.game}:${deps.cacheInfo.revision}:${deps.cacheInfo.name}`;
        const fallbackUrl = getNpcSpawnsUrl(deps.cacheInfo);
        const fallbackSpawns = await this.getFallbackNpcSpawns(deps.cacheInfo);
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
                data: {
                    spawnEvents: [],
                    npcTypeAnimationTable: [],
                },
                source: "fallbackDataset",
                fallbackUrl,
                fallbackCacheKey,
                fallbackTotalSpawns: fallbackSpawns.length | 0,
                fallbackMapSpawnsCount: 0,
                fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
            };
        }
        return {
            data: createNpcBootstrapDataFromSpawns(input.mapId | 0, mapSpawns, input.npcOrderKeys),
            source: "fallbackDataset",
            fallbackUrl,
            fallbackCacheKey,
            fallbackTotalSpawns: fallbackSpawns.length | 0,
            fallbackMapSpawnsCount: mapSpawns.length | 0,
            fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
        };
    }
}
