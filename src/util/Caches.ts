import { CacheFiles } from "../rs/cache/platform/CacheFiles";
import { CacheInfo, getGameTypeFromName, getLatestCache } from "../rs/cache/CacheInfo";
import { CacheLoader, ProgressListener } from "../rs/cache/CacheLoader";
import { CacheType, detectCacheType } from "../rs/cache/CacheType";
import { fetchCacheFiles } from "../rs/cache/platform/CacheFilesFetcher";

const CACHE_PATH = "/caches/";

export class CacheInfoJson {
    constructor(
        public name: string,
        public game: string,
        public environment: string,
        public revision: number,
        public timestamp: string,
        public size: number,
    ) { }
}

export async function fetchCacheInfos(): Promise<CacheInfo[]> {
    const resp = await fetch(CACHE_PATH + "caches.json");
    var infos: CacheInfoJson[] = await resp.json();
    return infos.map(info => new CacheInfo(info.name, getGameTypeFromName(info.game),
        info.environment, info.revision, info.timestamp, info.size))
}

export type CacheList = {
    caches: CacheInfo[];
    latest: CacheInfo;
};

export async function fetchCacheList(): Promise<CacheList | undefined> {
    const caches = await fetchCacheInfos();
    const latest = getLatestCache(caches);
    if (!latest) {
        return undefined;
    }
    return {
        caches,
        latest,
    };
}

export type LoadedCache = {
    info: CacheInfo;
    type: CacheType;
    files: CacheFiles;
    xteas: XteaMap;
};

export async function loadCacheFiles(
    loader: CacheLoader,
    info: CacheInfo,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<LoadedCache> {
    const cachePath = CACHE_PATH + info.name + "/";

    const xteasPromise = fetchXteas(cachePath + "keys.json", signal);

    const cacheType = detectCacheType(info);
    const files = await fetchCacheFiles(
        loader,
        cacheType,
        cachePath,
        info.name,
        true,
        signal,
        progressListener,
    );

    const xteas = await xteasPromise;

    return {
        info,
        type: cacheType,
        files,
        xteas,
    };
}

export type XteaMap = Map<number, number[]>;

export async function fetchXteas(url: RequestInfo, signal?: AbortSignal): Promise<XteaMap> {
    const resp = await fetch(url, {
        signal,
    });
    const data: Record<string, number[]> = await resp.json();
    return new Map(Object.keys(data).map((key) => [parseInt(key), data[key]]));
}
