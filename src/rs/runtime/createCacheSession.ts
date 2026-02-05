import { LoadedCache } from "../../util/Caches";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheSystem } from "../cache/CacheSystem";
import { createCacheSystemFromFiles } from "../cache/platform/CacheStoreFromFiles";
import { CompressionHandler } from "../compression/CompressionHandler";
import { VarManager } from "../config/vartype/VarManager";
import { MapFileIndex } from "../map/MapFileIndex";
import { tryCreateLoaders } from "../loaders/createLoaders";
import { Loaders } from "../loaders/Loaders";
import { err, ok, Result } from "../../util/Result";
import { errorToString } from "../../util/ErrorUtil";

export type CacheSession = {
    cache: LoadedCache;
    cacheSystem: CacheSystem;
    loaders: Loaders;
    varManager: VarManager;
    mapFileIndex: MapFileIndex;
    tryGetIndex(indexId: number): CacheIndex | undefined;
    getIndex(indexId: number): CacheIndex;
    /**
     * Creates a new session that shares the same cache store/index tables, but has
     * fresh loader caches. This mirrors a "thread-local context" in a future C++ port.
     */
    tryFork(): Result<CacheSession, string>;
};

export function createCacheSession(cache: LoadedCache, compressionHandler: CompressionHandler): CacheSession {
    const result = tryCreateCacheSession(cache, compressionHandler);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
}

export function tryCreateCacheSession(
    cache: LoadedCache,
    compressionHandler: CompressionHandler,
): Result<CacheSession, string> {
    try {
        const cacheSystem = createCacheSystemFromFiles(cache.type, cache.bundle, compressionHandler);
        return tryCreateCacheSessionFromSystem(cache, cacheSystem);
    } catch (e) {
        return err(errorToString(e));
    }
}

export function tryCreateCacheSessionFromSystem(
    cache: LoadedCache,
    cacheSystem: CacheSystem,
): Result<CacheSession, string> {
    const loadersResult = tryCreateLoaders(cache.info, cacheSystem);
    if (!loadersResult.ok) {
        return loadersResult;
    }
    const loaders = loadersResult.value;

    const varManager = new VarManager(loaders.varBitTypeLoader);
    const questTypeLoader = loaders.questTypeLoader;
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
        getIndex: (indexId: number) => cacheSystem.getIndex(indexId),
        tryFork: () => tryCreateCacheSessionFromSystem(cache, cacheSystem),
    };

    return ok(session);
}
