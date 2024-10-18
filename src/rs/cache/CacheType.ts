import { CacheInfo } from "./CacheInfo";

export enum CacheType {
    Classic,
    Legacy,
    Dat,
    Dat2,
}

export function getCacheTypeName(cacheType: CacheType): String {
    switch(cacheType) {
    case CacheType.Classic: return "classic"
    case CacheType.Legacy: return "legacy"
    case CacheType.Dat: return "dat"
    case CacheType.Dat2: return "dat2"
    default: throw Error("Unknown cache type");
    }
}

export function detectCacheType(cacheInfo: CacheInfo): CacheType {
    switch (cacheInfo.game) {
        case "classic":
            return CacheType.Classic;
        case "runescape":
            if (cacheInfo.revision < 234) {
                return CacheType.Legacy;
            } else if (cacheInfo.revision < 410) {
                return CacheType.Dat;
            } else {
                return CacheType.Dat2;
            }
        case "oldschool":
            return CacheType.Dat2;
        default:
            throw new Error("Unknown game type: " + cacheInfo.game);
    }
}
