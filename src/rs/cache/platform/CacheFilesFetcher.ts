import { CACHE_FILE, CacheBundleTransfer, CacheBuffer, DAT_INDEX_COUNT, toCacheBytes } from "./CacheFiles";
import { CachedFile, CacheLoader, ProgressListener } from "../CacheLoader";
import { CacheType } from "../CacheType";
import { SectorCluster } from "../store/SectorCluster";

function decodeJsonStringArray(buffer: CacheBuffer): string[] {
    const text = new TextDecoder("utf-8").decode(toCacheBytes(buffer));
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
}

export async function fetchCacheFiles(
    loader: CacheLoader,
    cacheType: CacheType,
    baseUrl: string,
    name: string,
    shared: boolean = false,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<CacheBundleTransfer> {
    switch (cacheType) {
        case CacheType.Classic:
            return fetchLegacyCacheFiles(loader, baseUrl, name, shared, signal, progressListener);
        case CacheType.Dat:
            return fetchDatCacheFiles(loader, baseUrl, name, shared, signal, progressListener);
        case CacheType.Dat2:
            return fetchDat2CacheFiles(loader, baseUrl, name, [], shared, signal, progressListener);
        default:
            throw new Error("Not implemented");
    }
}

export async function fetchLegacyCacheFiles(
    loader: CacheLoader,
    baseUrl: string,
    cacheName: string,
    shared: boolean = false,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<CacheBundleTransfer> {
    const fileNames = ["models", "title", "config", "media", "textures"];

    const filePromises = fileNames.map((name) =>
        loader.fetchCachedFile(baseUrl, name, shared, false, cacheName, signal, progressListener),
    );

    const cachedFiles = await Promise.all(filePromises);

    const byName = new Map<string, CachedFile>();
    for (const file of cachedFiles) {
        byName.set(file.name, file);
    }

    let mapNames: string[] = [];
    try {
        const mapsJson = await loader.fetchCachedFile(
            baseUrl,
            "maps.json",
            shared,
            false,
            cacheName,
            signal,
        );
        mapNames = decodeJsonStringArray(mapsJson.data);
    } catch {
        // optional
    }

    const maps: CacheBuffer[] = [];
    const fetchedMapNames: string[] = [];
    for (const mapName of mapNames) {
        const mapFile = await loader.fetchCachedFile(
            baseUrl,
            "maps/" + mapName,
            shared,
            false,
            cacheName,
            signal,
        );
        maps.push(mapFile.data);
        fetchedMapNames.push(mapName);
    }

    const config = byName.get("config")?.data;
    const media = byName.get("media")?.data;
    const textures = byName.get("textures")?.data;
    const models = byName.get("models")?.data;
    const title = byName.get("title")?.data;

    if (!config || !media || !textures || !models) {
        throw new Error("Missing required legacy cache files");
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

export async function fetchDatCacheFiles(
    loader: CacheLoader,
    baseUrl: string,
    cacheName: string,
    shared: boolean = false,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<CacheBundleTransfer> {

    const dataFilePromise = loader.fetchCachedFile(
        baseUrl,
        CACHE_FILE.DAT,
        shared,
        true,
        cacheName,
        signal,
        progressListener,
    );
    const indexFilePromises: Promise<CachedFile>[] = [];
    for (let i = 0; i < DAT_INDEX_COUNT; i++) {
        indexFilePromises.push(
            loader.fetchCachedFile(
                baseUrl,
                CACHE_FILE.INDEX_PREFIX + i,
                shared,
                false,
                cacheName,
            ),
        );
    }

    const dataAndIndices = await Promise.all([dataFilePromise, ...indexFilePromises]);
    const dataFile = dataAndIndices[0];
    const idx: CacheBuffer[] = [];
    for (let i = 0; i < DAT_INDEX_COUNT; i++) {
        idx[i] = dataAndIndices[i + 1].data;
    }

    return {
        kind: "dat",
        dat: dataFile.data,
        idx,
    };
}

export async function fetchDat2CacheFiles(
    loader: CacheLoader,
    baseUrl: string,
    cacheName: string,
    indicesToLoad: number[] = [],
    shared: boolean = false,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<CacheBundleTransfer> {

    const dataFilePromise = loader.fetchCachedFile(
        baseUrl,
        CACHE_FILE.DAT2,
        shared,
        true,
        cacheName,
        signal,
        progressListener,
    );
    const metaFile = await loader.fetchCachedFile(
        baseUrl,
        CACHE_FILE.META,
        shared,
        false,
        cacheName,
    );
    const indexCount = metaFile.data.byteLength / SectorCluster.SIZE;

    if (indicesToLoad.length === 0) {
        indicesToLoad = Array.from({ length: indexCount }, (_, i) => i);
    }

    const idx: Array<CacheBuffer | null> = Array.from({ length: indexCount }, () => null);

    const indexPromises = indicesToLoad.map(async (indexId) => {
        try {
            const file = await loader.fetchCachedFile(
                baseUrl,
                CACHE_FILE.INDEX_PREFIX + indexId,
                shared,
                false,
                cacheName,
            );
            return { indexId, data: file.data };
        } catch (err) {
            console.error(err);
            return null;
        }
    });

    const dataFile = await dataFilePromise;
    const indexResults = await Promise.all(indexPromises);
    for (const entry of indexResults) {
        if (!entry) {
            continue;
        }
        if (entry.indexId >= 0 && entry.indexId < idx.length) {
            idx[entry.indexId] = entry.data;
        }
    }

    return {
        kind: "dat2",
        dat2: dataFile.data,
        idx255: metaFile.data,
        idx,
    };
}
