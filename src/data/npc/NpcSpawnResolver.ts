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

type DecodedNpcSpawns = Readonly<{ decodedSpawnsCount: number; spawns: NpcSpawn[] }>;

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

async function decodeMapNpcSpawnsFromCacheBytes(
    data: Uint8Array,
    deps: ResolveNpcSpawnsDeps,
    input: ResolveNpcSpawnsInput,
    npcLoginScreenPropsById?: Uint8Array,
): Promise<NpcSpawn[] | undefined> {
    return deps.npcSpawnDecodeBackend
        ? deps.npcSpawnDecodeBackend.decodeNpcSpawnsFromBytes(
              input.tileRenderFlagsLevel1,
              input.borderSize,
              input.mapX,
              input.mapY,
              data,
              npcLoginScreenPropsById,
              0x1,
          )
        : decodeNpcSpawnsFromBytes(
              input.tileRenderFlagsLevel1,
              input.borderSize,
              input.mapX,
              input.mapY,
              data,
          );
}

function filterDecodedCacheNpcSpawns(
    decoded: ReadonlyArray<NpcSpawn>,
    input: ResolveNpcSpawnsInput,
    deps: ResolveNpcSpawnsDeps,
): NpcSpawn[] {
    if (deps.npcSpawnDecodeBackend?.filtersLoginScreenProps) {
        return Array.from(decoded);
    }
    return decoded.filter((spawn) => matchesRenderableNpcType(input.npcTypeLoader, spawn));
}

function resolveFallbackMapNpcSpawns(
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>,
    input: ResolveNpcSpawnsInput,
): NpcSpawn[] {
    return getMapNpcSpawns(
        Array.from(fallbackNpcSpawns),
        input.maxLevel,
        input.mapX,
        input.mapY,
    ).filter((spawn) => matchesFallbackNpcName(input.npcTypeLoader, spawn));
}

function shouldResolveFallbackSpawns(
    input: ResolveNpcSpawnsInput,
    cacheDecoded: DecodedNpcSpawns | undefined,
): boolean {
    if (!cacheDecoded) {
        return true;
    }
    if ((cacheDecoded.spawns.length | 0) <= 0) {
        return true;
    }
    return (
        input.fallbackOnEmptyCacheDecode === true && (cacheDecoded.decodedSpawnsCount | 0) <= 0
    );
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
    ): Promise<DecodedNpcSpawns | undefined> {
        const npcSpawnBytes = deps.mapBytesProvider.getNpcSpawnBytes(input.mapX, input.mapY);
        if (!(npcSpawnBytes instanceof Uint8Array) || npcSpawnBytes.length === 0) {
            return undefined;
        }

        const decodeStart = deps.telemetry?.now() ?? 0;
        const cacheKey = NpcSpawnResolver.createCacheKey(deps.cacheInfo);
        const npcLoginScreenPropsById = deps.npcSpawnDecodeBackend
            ? this.getNpcLoginScreenPropsById(input.npcTypeLoader, cacheKey)
            : undefined;
        const decoded = await decodeMapNpcSpawnsFromCacheBytes(
            npcSpawnBytes,
            deps,
            input,
            npcLoginScreenPropsById,
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

        const spawns = filterDecodedCacheNpcSpawns(decoded, input, deps);

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
        return resolveFallbackMapNpcSpawns(fallbackNpcSpawns, input);
    }

    async resolveSpawns(deps: ResolveNpcSpawnsDeps, input: ResolveNpcSpawnsInput): Promise<NpcSpawn[]> {
        if (!input.loadNpcs) {
            return [];
        }

        const cacheDecoded = await this.tryDecodeCacheSpawns(deps, input);
        if (shouldResolveFallbackSpawns(input, cacheDecoded)) {
            return this.resolveFallbackSpawns(deps, input);
        }

        if (!cacheDecoded) {
            return [];
        }
        return cacheDecoded.spawns;
    }
}
