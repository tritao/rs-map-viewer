import { LoadedCache } from "../../util/Caches";
import { Result, err, ok } from "../../util/Result";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheSystem } from "../cache/CacheSystem";
import { createCacheSystemFromFiles } from "../cache/platform/CacheStoreFromFiles";
import { CompressionHandler } from "../compression/CompressionHandler";
import { VarManager } from "../config/vartype/VarManager";
import { InitError, createFailed, initErrorToString } from "../loaders/InitError";
import {
    clearLoaderCaches,
    getQuestTypeLoader,
    getSkeletalSeqLoader,
    Loaders,
} from "../loaders/Loaders";
import { tryCreateLoaders } from "../loaders/createLoaders";
import { MapFileIndex } from "../map/MapFileIndex";

export type CacheSession = {
    cache: LoadedCache;
    cacheSystem: CacheSystem;
    loaders: Loaders;
    varManager: VarManager;
    mapFileIndex: MapFileIndex;
    tryGetIndex(indexId: number): CacheIndex | undefined;
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
    const loadersResult = tryCreateLoaders(cache.info, cacheSystem);
    if (!loadersResult.ok) {
        return loadersResult;
    }
    const loaders = loadersResult.value;

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
        hasQuestTypeLoader: () => loaders.capabilities.hasQuestTypeLoader,
        hasSkeletalSeqLoader: () => loaders.capabilities.hasSkeletalSeqLoader,
        hasDistinctUnderlayTypeLoader: () =>
            loaders.capabilities.hasDistinctUnderlayTypeLoader,
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
        tryFork: () => tryCreateCacheSessionFromSystem(cache, cacheSystem),
    };

    return ok(session);
}
