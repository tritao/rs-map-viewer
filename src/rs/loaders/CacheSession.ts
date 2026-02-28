import { LoadedCache } from "../../util/Caches";
import { Result, err, ok } from "../../util/Result";
import { CacheInfo } from "../cache/CacheInfo";
import { DatConfigArchiveId } from "../cache/ConfigArchiveId";
import { CacheIndex } from "../cache/CacheIndex";
import { Dat2IndexId, DatIndexId } from "../cache/IndexId";
import { CacheSystem } from "../cache/CacheSystem";
import { CacheType, detectCacheType } from "../cache/CacheType";
import { Archive } from "../cache/format/Archive";
import { createCacheSystemFromFiles } from "../cache/platform/CacheStoreFromFiles";
import { CompressionHandler } from "../compression/CompressionHandler";
import { VarManager } from "../config/vartype/VarManager";
import { EnumeratingBytesProvider, IndexFileBytesProvider } from "../io/BytesProvider";
import {
    InitError,
    createFailed,
    initErrorToString,
    unexpected,
} from "../loaders/InitError";
import {
    Loaders,
    clearLoaderCaches,
    getQuestTypeLoader,
    getSkeletalSeqLoader,
} from "../loaders/Loaders";
import { tryCreateDat2LoaderSources, tryCreateDat2LoadersFromSources } from "./Dat2Loaders";
import { tryCreateDatLoaderSources, tryCreateDatLoadersFromSources } from "./DatLoaders";
import { tryCreateLegacyLoaderSources, tryCreateLegacyLoadersFromSources } from "./LegacyLoaders";
import { MapFileIndex } from "../map/MapFileIndex";

export type CacheSession = {
    cache: LoadedCache;
    cacheSystem: CacheSystem;
    loaders: Loaders;
    varManager: VarManager;
    mapFileIndex: MapFileIndex;
    tryGetIndex(indexId: number): CacheIndex | undefined;
    tryGetDat2SpriteSource(): EnumeratingBytesProvider | undefined;
    tryGetDatMediaArchive(): Archive | undefined;
    hasQuestTypeLoader(): boolean;
    hasSkeletalSeqLoader(): boolean;
    hasDistinctUnderlayTypeLoader(): boolean;
    getQuestTypeLoader(): ReturnType<typeof getQuestTypeLoader>;
    getSkeletalSeqLoader(): ReturnType<typeof getSkeletalSeqLoader>;
    getTextureLoader(): Loaders["textureLoader"];
    getModelLoader(): Loaders["modelLoader"];
    getSeqTypeLoader(): Loaders["seqTypeLoader"];
    getNpcTypeLoader(): Loaders["npcTypeLoader"];
    getBasTypeLoader(): Loaders["basTypeLoader"];
    getSeqFrameLoader(): Loaders["seqFrameLoader"];
    getMapFileLoader(): Loaders["mapFileLoader"];
    tryLoadUnderlayType(id: number): ReturnType<Loaders["underlayTypeLoader"]["tryLoad"]>;
    tryLoadOverlayType(id: number): ReturnType<Loaders["overlayTypeLoader"]["tryLoad"]>;
    tryLoadVarBitType(id: number): ReturnType<Loaders["varBitTypeLoader"]["tryLoad"]>;
    tryLoadLocType(id: number): ReturnType<Loaders["locTypeLoader"]["tryLoad"]>;
    tryLoadNpcType(id: number): ReturnType<Loaders["npcTypeLoader"]["tryLoad"]>;
    tryLoadObjType(id: number): ReturnType<Loaders["objTypeLoader"]["tryLoad"]>;
    tryLoadSeqType(id: number): ReturnType<Loaders["seqTypeLoader"]["tryLoad"]>;
    /**
     * Clears any in-memory caches (decoded types, loader error sets, etc.) while
     * keeping the underlying cache store/index tables intact.
     */
    clearCaches(): void;
    /**
     * Creates a new session that shares the same cache store/index tables, but has
     * fresh loader caches. This mirrors a "thread-local context" in a future C++ port.
     */
    tryFork(): Result<CacheSession, InitError>;
};

export function createCacheSession(
    cache: LoadedCache,
    compressionHandler: CompressionHandler,
): CacheSession {
    const result = tryCreateCacheSession(cache, compressionHandler);
    if (!result.ok) {
        throw new Error(initErrorToString(result.error));
    }
    return result.value;
}

export function tryCreateCacheSession(
    cache: LoadedCache,
    compressionHandler: CompressionHandler,
): Result<CacheSession, InitError> {
    try {
        const cacheSystem = createCacheSystemFromFiles(
            cache.type,
            cache.bundle,
            compressionHandler,
        );
        return tryCreateCacheSessionFromSystem(cache, cacheSystem);
    } catch (e) {
        return err(createFailed("cache system", e));
    }
}

export function tryCreateCacheSessionFromSystem(
    cache: LoadedCache,
    cacheSystem: CacheSystem,
): Result<CacheSession, InitError> {
    function createSessionFromLoaders(
        loaders: Loaders,
        tryFork: () => Result<CacheSession, InitError>,
    ): Result<CacheSession, InitError> {
        const varManager = new VarManager(loaders.varBitTypeLoader);
        const questTypeLoader = getQuestTypeLoader(loaders);
        if (questTypeLoader) {
            varManager.setQuestsCompleted(questTypeLoader);
        }

        const session: CacheSession = {
            cache,
            cacheSystem,
            loaders,
            varManager,
            mapFileIndex: loaders.mapFileLoader.mapFileIndex,
            tryGetIndex: (indexId: number) => cacheSystem.tryGetIndex(indexId),
            tryGetDat2SpriteSource: () => {
                const index = cacheSystem.tryGetIndex(Dat2IndexId.sprites);
                if (!index) {
                    return undefined;
                }
                return new IndexFileBytesProvider(index, 0);
            },
            tryGetDatMediaArchive: () => {
                const configIndex = cacheSystem.tryGetIndex(DatIndexId.configs);
                if (!configIndex) {
                    return undefined;
                }
                return configIndex.tryGetArchive(DatConfigArchiveId.media);
            },
            hasQuestTypeLoader: () => loaders.capabilities.hasQuestTypeLoader,
            hasSkeletalSeqLoader: () => loaders.capabilities.hasSkeletalSeqLoader,
            hasDistinctUnderlayTypeLoader: () => loaders.capabilities.hasDistinctUnderlayTypeLoader,
            getQuestTypeLoader: () => getQuestTypeLoader(loaders),
            getSkeletalSeqLoader: () => getSkeletalSeqLoader(loaders),
            getTextureLoader: () => loaders.textureLoader,
            getModelLoader: () => loaders.modelLoader,
            getSeqTypeLoader: () => loaders.seqTypeLoader,
            getNpcTypeLoader: () => loaders.npcTypeLoader,
            getBasTypeLoader: () => loaders.basTypeLoader,
            getSeqFrameLoader: () => loaders.seqFrameLoader,
            getMapFileLoader: () => loaders.mapFileLoader,
            tryLoadUnderlayType: (id: number) => loaders.underlayTypeLoader.tryLoad(id),
            tryLoadOverlayType: (id: number) => loaders.overlayTypeLoader.tryLoad(id),
            tryLoadVarBitType: (id: number) => loaders.varBitTypeLoader.tryLoad(id),
            tryLoadLocType: (id: number) => loaders.locTypeLoader.tryLoad(id),
            tryLoadNpcType: (id: number) => loaders.npcTypeLoader.tryLoad(id),
            tryLoadObjType: (id: number) => loaders.objTypeLoader.tryLoad(id),
            tryLoadSeqType: (id: number) => loaders.seqTypeLoader.tryLoad(id),
            clearCaches: () => clearLoaderCaches(loaders),
            tryFork,
        };

        return ok(session);
    }

    try {
        const cacheType = detectCacheType(cache.info);
        switch (cacheType) {
            case CacheType.Legacy: {
                const sourcesResult = tryCreateLegacyLoaderSources(cacheSystem);
                if (!sourcesResult.ok) return sourcesResult;
                const sources = sourcesResult.value;

                function createFromSources(): Result<CacheSession, InitError> {
                    const loadersResult = tryCreateLegacyLoadersFromSources(cache.info, sources);
                    if (!loadersResult.ok) return loadersResult;
                    return createSessionFromLoaders(loadersResult.value, createFromSources);
                }

                return createFromSources();
            }
            case CacheType.Dat: {
                const sourcesResult = tryCreateDatLoaderSources(cache.info, cacheSystem);
                if (!sourcesResult.ok) return sourcesResult;
                const sources = sourcesResult.value;

                function createFromSources(): Result<CacheSession, InitError> {
                    const loadersResult = tryCreateDatLoadersFromSources(cache.info, cacheType, sources);
                    if (!loadersResult.ok) return loadersResult;
                    return createSessionFromLoaders(loadersResult.value, createFromSources);
                }

                return createFromSources();
            }
            case CacheType.Dat2: {
                const sourcesResult = tryCreateDat2LoaderSources(cache.info, cacheSystem);
                if (!sourcesResult.ok) return sourcesResult;
                const sources = sourcesResult.value;

                function createFromSources(): Result<CacheSession, InitError> {
                    const loadersResult = tryCreateDat2LoadersFromSources(cache.info, cacheType, sources);
                    if (!loadersResult.ok) return loadersResult;
                    return createSessionFromLoaders(loadersResult.value, createFromSources);
                }

                return createFromSources();
            }
        }
        return err(unexpected("Not implemented"));
    } catch (e) {
        return err(unexpected(e));
    }
}
