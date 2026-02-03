import fs from "fs";
import path from "path";

import { CacheInfoJson, CacheList, LoadedCache, XteaMap } from "../../src/util/Caches";
import {
    CACHE_FILE,
    CacheBundleTransfer,
    CacheBuffer,
    DAT_INDEX_COUNT,
    parseCacheIndexIdFromFileName,
} from "../../src/rs/cache/platform/CacheFiles";
import { CacheInfo, getGameTypeFromName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";

const INDEX_ENTRY_SIZE: number = 6;

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

function readFileArrayBuffer(filePath: string): ArrayBuffer {
    const buffer = fs.readFileSync(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function loadCacheFiles(cache: CacheInfo): CacheBundleTransfer {
    const cachePath = "./caches/" + cache.name + "/";

    const dat2Path = path.join(cachePath, CACHE_FILE.DAT2);
    const datPath = path.join(cachePath, CACHE_FILE.DAT);

    if (fs.existsSync(dat2Path)) {
        const idx255Path = path.join(cachePath, CACHE_FILE.META);
        if (!fs.existsSync(idx255Path)) {
            throw new Error("Missing idx255 for dat2 cache");
        }

        const dat2 = readFileArrayBuffer(dat2Path);
        const idx255 = readFileArrayBuffer(idx255Path);
        const indexCount = (idx255.byteLength / INDEX_ENTRY_SIZE) | 0;
        const idx: Array<CacheBuffer | null> = Array.from({ length: indexCount }, () => null);

        for (const fileName of fs.readdirSync(cachePath)) {
            const indexId = parseCacheIndexIdFromFileName(fileName);
            if (indexId === null || indexId < 0 || indexId >= indexCount) {
                continue;
            }
            idx[indexId] = readFileArrayBuffer(path.join(cachePath, fileName));
        }

        return {
            kind: "dat2",
            dat2,
            idx255,
            idx,
        };
    }

    if (fs.existsSync(datPath)) {
        const dat = readFileArrayBuffer(datPath);
        const idx: CacheBuffer[] = [];
        for (let i = 0; i < DAT_INDEX_COUNT; i++) {
            const idxPath = path.join(cachePath, CACHE_FILE.INDEX_PREFIX + i);
            if (!fs.existsSync(idxPath)) {
                throw new Error(`Missing ${CACHE_FILE.INDEX_PREFIX + i} for dat cache`);
            }
            idx[i] = readFileArrayBuffer(idxPath);
        }

        return {
            kind: "dat",
            dat,
            idx,
        };
    }

    // Legacy cache
    const configPath = path.join(cachePath, "config");
    const mediaPath = path.join(cachePath, "media");
    const texturesPath = path.join(cachePath, "textures");
    const modelsPath = path.join(cachePath, "models");
    const titlePath = path.join(cachePath, "title");

    if (!fs.existsSync(configPath) || !fs.existsSync(mediaPath) || !fs.existsSync(texturesPath) || !fs.existsSync(modelsPath)) {
        throw new Error("Missing required legacy cache files");
    }

    const config = readFileArrayBuffer(configPath);
    const media = readFileArrayBuffer(mediaPath);
    const textures = readFileArrayBuffer(texturesPath);
    const models = readFileArrayBuffer(modelsPath);
    const title = fs.existsSync(titlePath) ? readFileArrayBuffer(titlePath) : undefined;

    const mapsJsonPath = path.join(cachePath, "maps.json");
    let mapNames: string[] = [];
    if (fs.existsSync(mapsJsonPath)) {
        mapNames = JSON.parse(fs.readFileSync(mapsJsonPath, "utf8"));
        if (!Array.isArray(mapNames)) {
            mapNames = [];
        }
    }

    const mapsDir = path.join(cachePath, "maps");
    const maps: CacheBuffer[] = [];
    const fetchedMapNames: string[] = [];
    if (mapNames.length > 0 && fs.existsSync(mapsDir)) {
        for (const mapName of mapNames) {
            const mapPath = path.join(mapsDir, mapName);
            if (!fs.existsSync(mapPath)) {
                continue;
            }
            maps.push(readFileArrayBuffer(mapPath));
            fetchedMapNames.push(mapName);
        }
    }

    return {
        kind: "legacy",
        legacy: {
            config,
            media,
            textures,
            models,
            title,
            maps,
            mapNames: fetchedMapNames,
        },
    };
}

export function loadCache(info: CacheInfo): LoadedCache {
    const bundle = loadCacheFiles(info);
    const xteas = loadXteas(info);
    return {
        info,
        type: detectCacheType(info),
        bundle,
        xteas,
    };
}

export function loadXteas(cache: CacheInfo): XteaMap {
    const cachePath = "./caches/" + cache.name + "/";
    const json = fs.readFileSync(cachePath + "keys.json", "utf8");
    const data: Record<string, number[]> = JSON.parse(json);
    return new Map(Object.keys(data).map((key) => [parseInt(key), data[key]]));
}
