import { LoadedCache } from "../../util/Caches";
import { CompressionHandler } from "../compression/CompressionHandler";
import { Loaders } from "./Loaders";
import { CacheSystem } from "../cache/CacheSystem";
import { MapFileIndex } from "../map/MapFileIndex";
import { VarManager } from "../config/vartype/VarManager";
import { CacheSession, createCacheSession } from "../runtime/createCacheSession";

export class CacheContext {
    readonly session: CacheSession;
    readonly cache: LoadedCache;
    readonly cacheSystem: CacheSystem;
    readonly loaders: Loaders;
    readonly varManager: VarManager;
    readonly mapFileIndex: MapFileIndex;

    constructor(cache: LoadedCache, compressionHandler: CompressionHandler) {
        const session = createCacheSession(cache, compressionHandler);
        this.session = session;
        this.cache = session.cache;
        this.cacheSystem = session.cacheSystem;
        this.loaders = session.loaders;
        this.varManager = session.varManager;
        this.mapFileIndex = session.mapFileIndex;
    }
}
