import { CacheSystem } from "../cache/CacheSystem";
import { createCacheSystemFromFiles } from "../cache/platform/CacheStoreFromFiles";
import { VarManager } from "../config/vartype/VarManager";
import { MapFileIndex } from "../map/MapFileIndex";
import { LoadedCache } from "../../util/Caches";
import { CompressionHandler } from "../compression/CompressionHandler";
import { createLoaders } from "./createLoaders";
import { Loaders } from "./Loaders";

export class CacheContext {
    readonly cache: LoadedCache;
    readonly cacheSystem: CacheSystem;
    readonly loaders: Loaders;
    readonly varManager: VarManager;
    readonly mapFileIndex: MapFileIndex;

    constructor(cache: LoadedCache, compressionHandler: CompressionHandler) {
        this.cache = cache;
        this.cacheSystem = createCacheSystemFromFiles(cache.type, cache.bundle, compressionHandler);
        this.loaders = createLoaders(cache.info, this.cacheSystem);

        this.varManager = new VarManager(this.loaders.varBitTypeLoader);
        const questTypeLoader = this.loaders.questTypeLoader;
        if (questTypeLoader) {
            this.varManager.setQuestsCompleted(questTypeLoader);
        }

        const mapFileLoader = this.loaders.mapFileLoader;
        this.mapFileIndex = mapFileLoader.mapFileIndex;
    }
}
