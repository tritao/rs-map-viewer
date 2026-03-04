import {
    type NpcSpawn,
    fetchNpcSpawns,
    getMapNpcSpawns,
    getNpcSpawnsUrl,
} from "./NpcSpawn";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { decodeNpcSpawnsFromBytes } from "../../rs/scene/decodeNpcSpawns";

type NpcSpawnDecodeBackendLike = Readonly<{
    name: string;
    filtersLoginScreenProps?: boolean;
    decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1: Uint8Array[],
        borderSize: number,
        mapX: number,
        mapY: number,
        data: Uint8Array,
        npcLoginScreenPropsById?: Uint8Array,
        requiredLoginScreenPropsMask?: number,
    ): Promise<NpcSpawn[] | undefined>;
}>;

export type ResolveNpcSpawnsDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    cacheInfo: CacheInfo;
    npcSpawnDecodeBackend?: NpcSpawnDecodeBackendLike;
    fallbackNpcSpawns?: ReadonlyArray<NpcSpawn>;
    telemetry?: boolean;
}>;

export type ResolveNpcSpawnsInput = Readonly<{
    loadNpcs: boolean;
    mapX: number;
    mapY: number;
    maxLevel: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    npcTypeLoader: NpcTypeLoader;
}>;

function matchesRenderableNpcType(npcTypeLoader: NpcTypeLoader, spawn: NpcSpawn): boolean {
    const npcResult = npcTypeLoader.tryLoad(spawn.id);
    if (!npcResult.ok) {
        return false;
    }
    return (npcResult.value.loginScreenProps & 0x1) > 0;
}

function matchesFallbackNpcName(npcTypeLoader: NpcTypeLoader, spawn: NpcSpawn): boolean {
    const npcResult = npcTypeLoader.tryLoad(spawn.id);
    if (!npcResult.ok) {
        return false;
    }
    if (spawn.name === undefined) {
        return true;
    }
    return spawn.name === npcResult.value.name;
}

export class NpcSpawnResolver {
    private cachedNpcLoginScreenPropsById?: Uint8Array;
    private cachedNpcLoginScreenPropsCacheKey?: string;
    private fallbackNpcSpawnsPromise?: Promise<NpcSpawn[]>;
    private fallbackNpcSpawnsCacheKey?: string;

    reset(): void {
        this.cachedNpcLoginScreenPropsById = undefined;
        this.cachedNpcLoginScreenPropsCacheKey = undefined;
        this.fallbackNpcSpawnsPromise = undefined;
        this.fallbackNpcSpawnsCacheKey = undefined;
    }

    private static createCacheKey(cacheInfo: CacheInfo): string {
        return `${cacheInfo.game}:${cacheInfo.revision}:${cacheInfo.name}`;
    }

    private getNpcLoginScreenPropsById(
        npcTypeLoader: NpcTypeLoader,
        cacheKey: string,
    ): Uint8Array {
        if (
            this.cachedNpcLoginScreenPropsById &&
            this.cachedNpcLoginScreenPropsCacheKey === cacheKey
        ) {
            return this.cachedNpcLoginScreenPropsById;
        }

        const count = npcTypeLoader.getCount() | 0;
        const props = new Uint8Array(count);
        for (let id = 0; id < count; id++) {
            const npcResult = npcTypeLoader.tryLoad(id);
            if (npcResult.ok) {
                props[id] = npcResult.value.loginScreenProps & 0xff;
            }
        }

        this.cachedNpcLoginScreenPropsById = props;
        this.cachedNpcLoginScreenPropsCacheKey = cacheKey;
        return props;
    }

    private async getFallbackNpcSpawns(
        cacheInfo: CacheInfo,
        fallbackNpcSpawns?: ReadonlyArray<NpcSpawn>,
    ): Promise<NpcSpawn[]> {
        if (fallbackNpcSpawns) {
            return fallbackNpcSpawns as NpcSpawn[];
        }

        const cacheKey = NpcSpawnResolver.createCacheKey(cacheInfo);
        if (
            this.fallbackNpcSpawnsPromise &&
            this.fallbackNpcSpawnsCacheKey === cacheKey
        ) {
            return this.fallbackNpcSpawnsPromise;
        }

        const url = getNpcSpawnsUrl(cacheInfo);
        this.fallbackNpcSpawnsCacheKey = cacheKey;
        this.fallbackNpcSpawnsPromise = fetchNpcSpawns(url).catch((error: unknown) => {
            this.fallbackNpcSpawnsPromise = undefined;
            this.fallbackNpcSpawnsCacheKey = undefined;
            throw error;
        });
        return this.fallbackNpcSpawnsPromise;
    }

    async resolveSpawns(deps: ResolveNpcSpawnsDeps, input: ResolveNpcSpawnsInput): Promise<NpcSpawn[]> {
        if (!input.loadNpcs) {
            return [];
        }

        const npcSpawnBytes = deps.mapBytesProvider.getNpcSpawnBytes(input.mapX, input.mapY);
        let cacheNpcSpawns: NpcSpawn[] | undefined;
        if (npcSpawnBytes) {
            const decodeStart = performance.now();
            const cacheKey = NpcSpawnResolver.createCacheKey(deps.cacheInfo);
            const npcLoginScreenPropsById = deps.npcSpawnDecodeBackend
                ? this.getNpcLoginScreenPropsById(input.npcTypeLoader, cacheKey)
                : undefined;
            cacheNpcSpawns = deps.npcSpawnDecodeBackend
                ? await deps.npcSpawnDecodeBackend.decodeNpcSpawnsFromBytes(
                      input.tileRenderFlagsLevel1,
                      input.borderSize,
                      input.mapX,
                      input.mapY,
                      npcSpawnBytes,
                      npcLoginScreenPropsById,
                      0x1,
                  )
                : decodeNpcSpawnsFromBytes(
                      input.tileRenderFlagsLevel1,
                      input.borderSize,
                      input.mapX,
                      input.mapY,
                      npcSpawnBytes,
                  );
            if (deps.telemetry) {
                const decodeMs = performance.now() - decodeStart;
                console.log(
                    `[map-render] square=${input.mapX},${input.mapY} npcDecodeBackend=${
                        deps.npcSpawnDecodeBackend?.name ?? "ts"
                    } decoded=${cacheNpcSpawns?.length ?? 0} ms=${decodeMs.toFixed(1)}`,
                );
            }
        }

        if (cacheNpcSpawns) {
            if (deps.npcSpawnDecodeBackend?.filtersLoginScreenProps) {
                return cacheNpcSpawns;
            }
            return cacheNpcSpawns.filter((spawn) => matchesRenderableNpcType(input.npcTypeLoader, spawn));
        }

        const fallbackNpcSpawns = await this.getFallbackNpcSpawns(
            deps.cacheInfo,
            deps.fallbackNpcSpawns,
        );
        return getMapNpcSpawns(fallbackNpcSpawns, input.maxLevel, input.mapX, input.mapY).filter(
            (spawn) => matchesFallbackNpcName(input.npcTypeLoader, spawn),
        );
    }
}

