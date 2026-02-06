import { CacheInfo } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { CacheType, detectCacheType } from "../cache/CacheType";
import { tryCreateDat2Loaders } from "./Dat2Loaders";
import { tryCreateDatLoaders } from "./DatLoaders";
import { tryCreateLegacyLoaders } from "./LegacyLoaders";
import { Loaders } from "./Loaders";
import { err, Result } from "../../util/Result";
import { InitError, initErrorToString, unexpected } from "./InitError";

export function createLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Loaders {
    const result = tryCreateLoaders(cacheInfo, cacheSystem);
    if (!result.ok) {
        throw new Error(initErrorToString(result.error));
    }
    return result.value;
}

export function tryCreateLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Result<Loaders, InitError> {
    try {
        const cacheType = detectCacheType(cacheInfo);
        switch (cacheType) {
            case CacheType.Legacy:
                return tryCreateLegacyLoaders(cacheInfo, cacheSystem);
            case CacheType.Dat:
                return tryCreateDatLoaders(cacheInfo, cacheType, cacheSystem);
            case CacheType.Dat2:
                return tryCreateDat2Loaders(cacheInfo, cacheType, cacheSystem);
        }
        return err(unexpected("Not implemented"));
    } catch (e) {
        return err(unexpected(e));
    }
}
