import { CachedFile, ProgressListener } from "./CacheLoader";
import { fetchCachedFile } from "./CacheLoaderFetch";
import { CacheType } from "./CacheType";
import { SectorCluster } from "./store/SectorCluster";

export class CacheFiles {
    static DAT_FILE_NAME: string = "main_file_cache.dat";
    static DAT2_FILE_NAME: string = "main_file_cache.dat2";

    static INDEX_FILE_PREFIX: string = "main_file_cache.idx";

    static META_FILE_NAME: string = "main_file_cache.idx255";

    static DAT_INDEX_COUNT: number = 5;

    static fetchFiles(
        cacheType: CacheType,
        baseUrl: string,
        name: string,
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        switch (cacheType) {
            case CacheType.Classic:
                return CacheFiles.fetchLegacy(baseUrl, name, shared, signal, progressListener);
            case CacheType.Dat:
                return CacheFiles.fetchDat(baseUrl, name, shared, signal, progressListener);
            case CacheType.Dat2:
                return CacheFiles.fetchDat2(baseUrl, name, [], shared, signal, progressListener);
        }
        throw new Error("Not implemented");
    }

    static async getCacheAndFiles(
        baseUrl: string,
        cacheName: string,
        fileNames: string[],
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<Map<string, ArrayBuffer>> {
        const files = new Map<string, ArrayBuffer>();
        const cache = await caches.open(cacheName);

        const filePromises = fileNames.map((name) =>
            fetchCachedFile(baseUrl, name, shared, false, cache, signal, progressListener),
        );

        const cachedFiles = await Promise.all(filePromises);

        for (const file of cachedFiles) {
            files.set(file.name, file.data);
        }

        return files;
    }

    static async fetchLegacy(
        baseUrl: string,
        cacheName: string,
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        const fileNames = ["models", "title", "config", "media", "textures"];
        const files = await CacheFiles.getCacheAndFiles(
            baseUrl,
            cacheName,
            fileNames,
            shared,
            signal,
            progressListener,
        );

        let mapNames: string[] = [];
        try {
            mapNames = await fetch(baseUrl + "maps.json").then((resp) => resp.json());
        } catch (e) {}

        for (const mapName of mapNames) {
            const mapFile = await fetchCachedFile(
                baseUrl,
                "maps/" + mapName,
                shared,
                false,
                await caches.open(cacheName),
                signal,
            );
            files.set(mapFile.name, mapFile.data);
        }

        return new CacheFiles(files);
    }

    static async fetchDat(
        baseUrl: string,
        cacheName: string,
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        const files = new Map<string, ArrayBuffer>();

        const cache = await caches.open(cacheName);

        const dataFilePromise = fetchCachedFile(
            baseUrl,
            CacheFiles.DAT_FILE_NAME,
            shared,
            true,
            cache,
            signal,
            progressListener,
        );
        const indexFilePromises: Promise<CachedFile>[] = [];
        for (let i = 0; i < CacheFiles.DAT_INDEX_COUNT; i++) {
            indexFilePromises.push(
                fetchCachedFile(baseUrl, CacheFiles.INDEX_FILE_PREFIX + i, shared, false, cache),
            );
        }

        const dataAndIndices = await Promise.all([dataFilePromise, ...indexFilePromises]);
        for (const file of dataAndIndices) {
            files.set(file.name, file.data);
        }

        return new CacheFiles(files);
    }

    static async fetchDat2(
        baseUrl: string,
        cacheName: string,
        indicesToLoad: number[] = [],
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        const files = new Map<string, ArrayBuffer>();

        const cache = await caches.open(cacheName);

        const dataFilePromise = fetchCachedFile(
            baseUrl,
            CacheFiles.DAT2_FILE_NAME,
            shared,
            true,
            cache,
            signal,
            progressListener,
        );
        const metaFile = await fetchCachedFile(
            baseUrl,
            CacheFiles.META_FILE_NAME,
            shared,
            false,
            cache,
        );
        const indexCount = metaFile.data.byteLength / SectorCluster.SIZE;

        if (indicesToLoad.length === 0) {
            indicesToLoad = Array.from({ length: indexCount }, (_, i) => i);
        }

        const indexPromises = indicesToLoad.map((indexId) =>
            fetchCachedFile(
                baseUrl,
                CacheFiles.INDEX_FILE_PREFIX + indexId,
                shared,
                false,
                cache,
            ).catch(console.error),
        );

        const dataAndIndices = await Promise.all([dataFilePromise, ...indexPromises]);
        for (const file of dataAndIndices) {
            if (file) {
                files.set(file.name, file.data);
            }
        }
        files.set(metaFile.name, metaFile.data);

        return new CacheFiles(files);
    }

    constructor(readonly files: Map<string, ArrayBuffer>) {}
}

