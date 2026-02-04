import { LoadedCache } from "../../util/Caches";
import { CompressionHandler } from "../compression/CompressionHandler";
import { Loaders } from "./Loaders";
import { CacheSystem } from "../cache/CacheSystem";
import { MapFileIndex } from "../map/MapFileIndex";
import { VarManager } from "../config/vartype/VarManager";
import { createCacheRuntime } from "../runtime/createCacheRuntime";

export class CacheContext {
    readonly cache: LoadedCache;
    readonly cacheSystem: CacheSystem;
    readonly loaders: Loaders;
    readonly varManager: VarManager;
    readonly mapFileIndex: MapFileIndex;

    constructor(cache: LoadedCache, compressionHandler: CompressionHandler) {
        const runtime = createCacheRuntime(cache, compressionHandler);
        this.cache = runtime.cache;
        this.cacheSystem = runtime.cacheSystem;
        this.loaders = runtime.loaders;
        this.varManager = runtime.varManager;
        this.mapFileIndex = runtime.mapFileIndex;
    }
}
