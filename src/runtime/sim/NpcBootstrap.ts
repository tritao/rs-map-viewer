import { type NpcSpawn, getNpcSpawnsUrl } from "../../data/npc/NpcSpawn";
import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import type { NpcData } from "../entities/NpcData";
import {
    type NpcBootstrapData,
    createNpcBootstrapData,
    createNpcBootstrapDataFromSpawns,
} from "./NpcBootstrapData";
import type { NpcSpawnEvent } from "./NpcEvents";

type ResolveDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    cacheInfo: CacheInfo;
    npcTypeLoader: NpcTypeLoader;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
}>;

type ResolveInput = Readonly<{
    mapId: number;
    maxLevel: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    npcOrderKeys: Int32Array;
}>;

type CreateInput = Readonly<{
    mapId: number;
    npcsIn: ReadonlyArray<NpcData>;
    npcOrderKeys?: Int32Array;
}>;

export type BootstrapSource = "mapBytes" | "fallbackDataset";

export type ResolvedBootstrapData = Readonly<{
    spawnEvents: NpcSpawnEvent[];
    source: BootstrapSource;
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

type FallbackDebugStats = Readonly<{
    fallbackUrl: string;
    fallbackCacheKey: string;
    fallbackTotalSpawns: number;
    fallbackMapSpawnsCount: number;
    fallbackMapSpawnsAllLevelsCount: number;
}>;

function buildFallbackDebugStats(
    cacheInfo: CacheInfo,
    fallbackSpawns: ReadonlyArray<NpcSpawn>,
    mapX: number,
    mapY: number,
    maxLevel: number,
): FallbackDebugStats {
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
        if ((spawn.level | 0) <= (maxLevel | 0)) {
            debugMapSpawns.push(spawn);
        }
    }
    return {
        fallbackUrl: getNpcSpawnsUrl(cacheInfo),
        fallbackCacheKey: `${cacheInfo.game}:${cacheInfo.revision}:${cacheInfo.name}`,
        fallbackTotalSpawns: fallbackSpawns.length | 0,
        fallbackMapSpawnsCount: debugMapSpawns.length | 0,
        fallbackMapSpawnsAllLevelsCount: mapSpawnsAllLevelsCount | 0,
    };
}

export function createBootstrapData(input: CreateInput): NpcBootstrapData {
    return createNpcBootstrapData(input);
}

export async function resolveBootstrapData(
    npcSpawnResolver: NpcSpawnResolver,
    deps: ResolveDeps,
    input: ResolveInput,
): Promise<ResolvedBootstrapData> {
    const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
    const cacheDecoded = await npcSpawnResolver.tryDecodeCacheSpawns(
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

    const fallbackSpawns = deps.fallbackNpcSpawns;
    const resolvedMapSpawns = await npcSpawnResolver.resolveFallbackSpawns(
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
    const debugStats = buildFallbackDebugStats(
        deps.cacheInfo,
        fallbackSpawns,
        mapX,
        mapY,
        input.maxLevel,
    );

    if ((resolvedMapSpawns.length | 0) <= 0) {
        return {
            spawnEvents: [],
            source: "fallbackDataset",
            ...debugStats,
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
        ...debugStats,
    };
}
