import fs from "fs";

import { CacheInfoJson, CacheList, LoadedCache, XteaMap } from "../../src/util/Caches";
import { CacheFilesTransfer } from "../../src/rs/cache/platform/CacheFiles";
import { CacheInfo, getGameTypeFromName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";

export function loadCacheInfos(): CacheInfo[] {
    const json = fs.readFileSync("./caches/caches.json", "utf8");
    var infos: CacheInfoJson[] = JSON.parse(json);
    return infos.map(info => new CacheInfo(info.name, getGameTypeFromName(info.game),
        info.environment, info.revision, info.timestamp, info.size))
}

export function loadCacheList(caches: CacheInfo[]): CacheList {
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("No latest cache");
    }
    return {
        caches,
        latest,
    };
}

export function loadCacheFiles(cache: CacheInfo): CacheFilesTransfer {
    const cachePath = "./caches/" + cache.name + "/";

    const files = new Map<string, ArrayBuffer>();

    fs.readdirSync(cachePath).forEach((fileName: string) => {
        const buffer = fs.readFileSync(cachePath + fileName);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        files.set(fileName, arrayBuffer);
    });

    return new CacheFilesTransfer(files);
}

export function loadCache(info: CacheInfo): LoadedCache {
    const files = loadCacheFiles(info);
    const xteas = loadXteas(info);
    return {
        info,
        type: detectCacheType(info),
        files,
        xteas,
    };
}

export function loadXteas(cache: CacheInfo): XteaMap {
    const cachePath = "./caches/" + cache.name + "/";
    const json = fs.readFileSync(cachePath + "keys.json", "utf8");
    const data: Record<string, number[]> = JSON.parse(json);
    return new Map(Object.keys(data).map((key) => [parseInt(key), data[key]]));
}
