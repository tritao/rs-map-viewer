import { type NpcSpawn, getNpcSpawnsUrl } from "../../data/npc/NpcSpawn";
import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { createNpcBootstrapDataFromSpawns } from "../../runtime/sim/NpcBootstrapData";
import type { NpcSpawnEvent } from "../../runtime/sim/NpcEvents";

type ResolveNpcBootstrapDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    cacheInfo: CacheInfo;
    npcTypeLoader: NpcTypeLoader;
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

export class NpcBootstrapResolver {
    private readonly npcSpawnResolver = new NpcSpawnResolver();

    reset(): void {
        this.npcSpawnResolver.reset();
    }

    async resolve(
        deps: ResolveNpcBootstrapDeps,
        input: ResolveNpcBootstrapInput,
    ): Promise<ResolvedNpcBootstrapData> {
        const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
        const cacheDecoded = await this.npcSpawnResolver.tryDecodeCacheSpawns(
            {
                mapBytesProvider: deps.mapBytesProvider,
                cacheInfo: deps.cacheInfo,
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel: input.maxLevel,
                borderSize: input.borderSize,
                tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
                npcTypeLoader: deps.npcTypeLoader,
            },
        );

        if (cacheDecoded && (cacheDecoded.decodedSpawnsCount | 0) > 0) {
            const bootstrapData = createNpcBootstrapDataFromSpawns(
                input.mapId | 0,
                cacheDecoded.spawns,
                input.npcOrderKeys,
            );
            return {
                spawnEvents: bootstrapData.spawnEvents,
                source: "mapBytes",
                decodedSpawnsCount: cacheDecoded.decodedSpawnsCount | 0,
            };
        }

        const fallbackCacheKey = `${deps.cacheInfo.game}:${deps.cacheInfo.revision}:${deps.cacheInfo.name}`;
        const fallbackUrl = getNpcSpawnsUrl(deps.cacheInfo);
        const fallbackSpawns = deps.fallbackNpcSpawns;
        const resolvedMapSpawns = await this.npcSpawnResolver.resolveFallbackSpawns(
            {
                mapBytesProvider: deps.mapBytesProvider,
                cacheInfo: deps.cacheInfo,
                fallbackNpcSpawns: deps.fallbackNpcSpawns,
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel: input.maxLevel,
                borderSize: input.borderSize,
                tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
                npcTypeLoader: deps.npcTypeLoader,
            },
        );

        const debugMapSpawns: NpcSpawn[] = [];
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
                debugMapSpawns.push(spawn);
            }
        }
        if ((resolvedMapSpawns.length | 0) <= 0) {
            return {
                spawnEvents: [],
                source: "fallbackDataset",
                fallbackUrl,
                fallbackCacheKey,
                fallbackTotalSpawns: fallbackSpawns.length | 0,
                fallbackMapSpawnsCount: debugMapSpawns.length | 0,
                fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
            };
        }
        const bootstrapData = createNpcBootstrapDataFromSpawns(
            input.mapId | 0,
            resolvedMapSpawns,
            input.npcOrderKeys,
        );
        return {
            spawnEvents: bootstrapData.spawnEvents,
            source: "fallbackDataset",
            fallbackUrl,
            fallbackCacheKey,
            fallbackTotalSpawns: fallbackSpawns.length | 0,
            fallbackMapSpawnsCount: debugMapSpawns.length | 0,
            fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
        };
    }
}
