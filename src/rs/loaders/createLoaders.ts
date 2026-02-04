import { CacheInfo } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { CacheType, detectCacheType } from "../cache/CacheType";
import { createDat2Loaders } from "./Dat2Loaders";
import { createDatLoaders } from "./DatLoaders";
import { createLegacyLoaders } from "./LegacyLoaders";
import { Loaders } from "./Loaders";

export function createLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Loaders {
    const cacheType = detectCacheType(cacheInfo);
    switch (cacheType) {
        case CacheType.Legacy:
            return createLegacyLoaders(cacheInfo, cacheSystem);
        case CacheType.Dat:
            return createDatLoaders(cacheInfo, cacheType, cacheSystem);
        case CacheType.Dat2:
            return createDat2Loaders(cacheInfo, cacheType, cacheSystem);
    }
    throw new Error("Not implemented");
}

