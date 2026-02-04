import { LoadedCache } from "../../util/Caches";
import { CacheSystem } from "../cache/CacheSystem";
import { createCacheSystemFromFiles } from "../cache/platform/CacheStoreFromFiles";
import { CompressionHandler } from "../compression/CompressionHandler";
import { VarManager } from "../config/vartype/VarManager";
import { MapFileIndex } from "../map/MapFileIndex";
import { createLoaders } from "../loaders/createLoaders";
import { Loaders } from "../loaders/Loaders";

export type CacheSession = {
    cache: LoadedCache;
    cacheSystem: CacheSystem;
    loaders: Loaders;
    varManager: VarManager;
    mapFileIndex: MapFileIndex;
};

export function createCacheSession(cache: LoadedCache, compressionHandler: CompressionHandler): CacheSession {
    const cacheSystem = createCacheSystemFromFiles(cache.type, cache.bundle, compressionHandler);
    const loaders = createLoaders(cache.info, cacheSystem);

    const varManager = new VarManager(loaders.varBitTypeLoader);
    const questTypeLoader = loaders.questTypeLoader;
    if (questTypeLoader) {
        varManager.setQuestsCompleted(questTypeLoader);
    }

    return {
        cache,
        cacheSystem,
        loaders,
        varManager,
        mapFileIndex: loaders.mapFileLoader.mapFileIndex,
    };
}

