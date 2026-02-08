import { CacheInfo, GameType, getGameTypeName } from "./CacheInfo";

export enum CacheType {
    Classic,
    Legacy,
    Dat,
    Dat2,
}

export function getCacheTypeName(cacheType: CacheType): String {
    switch (cacheType) {
        case CacheType.Classic:
            return "classic";
        case CacheType.Legacy:
            return "legacy";
        case CacheType.Dat:
            return "dat";
        case CacheType.Dat2:
            return "dat2";
        default:
            throw Error("Unknown cache type");
    }
}

export function detectCacheType(cacheInfo: CacheInfo): CacheType {
    switch (cacheInfo.game) {
        case GameType.Classic:
            return CacheType.Classic;
        case GameType.Runescape:
            if (cacheInfo.revision < 234) {
                return CacheType.Legacy;
            } else if (cacheInfo.revision < 410) {
                return CacheType.Dat;
            } else {
                return CacheType.Dat2;
            }
        case GameType.Oldschool:
            return CacheType.Dat2;
        default:
            throw new Error("Unknown game type: " + getGameTypeName(cacheInfo.game));
    }
}
