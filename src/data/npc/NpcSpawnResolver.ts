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

export type NpcSpawnTelemetry = Readonly<{
    now(): number;
    log(message: string): void;
}>;

export type ResolveNpcSpawnsDeps = Readonly<{
    mapBytesProvider: MapBytesProvider;
    cacheInfo: CacheInfo;
    npcSpawnDecodeBackend?: NpcSpawnDecodeBackendLike;
    fallbackNpcSpawns?: ReadonlyArray<NpcSpawn>;
    telemetry?: NpcSpawnTelemetry;
}>;

export type ResolveNpcSpawnsInput = Readonly<{
    loadNpcs: boolean;
    mapX: number;
    mapY: number;
    maxLevel: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    npcTypeLoader: NpcTypeLoader;
    fallbackOnEmptyCacheDecode?: boolean;
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

    async tryDecodeCacheSpawns(
        deps: ResolveNpcSpawnsDeps,
        input: ResolveNpcSpawnsInput,
    ): Promise<Readonly<{ decodedSpawnsCount: number; spawns: NpcSpawn[] }> | undefined> {
        const npcSpawnBytes = deps.mapBytesProvider.getNpcSpawnBytes(input.mapX, input.mapY);
        if (!(npcSpawnBytes instanceof Uint8Array) || npcSpawnBytes.length === 0) {
            return undefined;
        }

        const decodeStart = deps.telemetry?.now() ?? 0;
        const cacheKey = NpcSpawnResolver.createCacheKey(deps.cacheInfo);
        const npcLoginScreenPropsById = deps.npcSpawnDecodeBackend
            ? this.getNpcLoginScreenPropsById(input.npcTypeLoader, cacheKey)
            : undefined;
        const decoded = deps.npcSpawnDecodeBackend
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

        const decodedSpawnsCount = decoded ? decoded.length | 0 : 0;
        if (deps.telemetry) {
            const decodeMs = deps.telemetry.now() - decodeStart;
            deps.telemetry.log(
                `[map-render] square=${input.mapX},${input.mapY} npcDecodeBackend=${
                    deps.npcSpawnDecodeBackend?.name ?? "ts"
                } decoded=${decodedSpawnsCount} ms=${decodeMs.toFixed(1)}`,
            );
        }

        if (!decoded) {
            return undefined;
        }

        const spawns = deps.npcSpawnDecodeBackend?.filtersLoginScreenProps
            ? decoded
            : decoded.filter((spawn) => matchesRenderableNpcType(input.npcTypeLoader, spawn));

        return { decodedSpawnsCount, spawns };
    }

    async resolveFallbackSpawns(
        deps: ResolveNpcSpawnsDeps,
        input: ResolveNpcSpawnsInput,
    ): Promise<NpcSpawn[]> {
        const fallbackNpcSpawns = await this.getFallbackNpcSpawns(
            deps.cacheInfo,
            deps.fallbackNpcSpawns,
        );
        return getMapNpcSpawns(fallbackNpcSpawns, input.maxLevel, input.mapX, input.mapY).filter(
            (spawn) => matchesFallbackNpcName(input.npcTypeLoader, spawn),
        );
    }

    async resolveSpawns(deps: ResolveNpcSpawnsDeps, input: ResolveNpcSpawnsInput): Promise<NpcSpawn[]> {
        if (!input.loadNpcs) {
            return [];
        }

        const cacheDecoded = await this.tryDecodeCacheSpawns(deps, input);
        if (cacheDecoded) {
            if (
                input.fallbackOnEmptyCacheDecode === true &&
                (cacheDecoded.decodedSpawnsCount | 0) <= 0
            ) {
                return this.resolveFallbackSpawns(deps, input);
            }
            return cacheDecoded.spawns;
        }

        return this.resolveFallbackSpawns(deps, input);
    }
}
