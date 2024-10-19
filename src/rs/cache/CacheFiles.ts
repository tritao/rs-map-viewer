import { CachedFile, CacheLoader, ProgressListener } from "./CacheLoader";
import { CacheType } from "./CacheType";
import { SectorCluster } from "./store/SectorCluster";

export class CacheFiles {
    static DAT_FILE_NAME: string = "main_file_cache.dat";
    static DAT2_FILE_NAME: string = "main_file_cache.dat2";

    static INDEX_FILE_PREFIX: string = "main_file_cache.idx";

    static META_FILE_NAME: string = "main_file_cache.idx255";

    static DAT_INDEX_COUNT: number = 5;

    static fetchFiles(
        loader: CacheLoader,
        cacheType: CacheType,
        baseUrl: string,
        name: string,
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        switch (cacheType) {
            case CacheType.Classic:
                return CacheFiles.fetchLegacy(loader, baseUrl, name, shared, signal, progressListener);
            case CacheType.Dat:
                return CacheFiles.fetchDat(loader, baseUrl, name, shared, signal, progressListener);
            case CacheType.Dat2:
                return CacheFiles.fetchDat2(loader, baseUrl, name, [], shared, signal, progressListener);
        }
        throw new Error("Not implemented");
    }

    static async fetchLegacy(
        loader: CacheLoader,
        baseUrl: string,
        cacheName: string,
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        const fileNames = ["models", "title", "config", "media", "textures"];
        const files = new Map<string, ArrayBuffer>();

        const filePromises = fileNames.map((name) =>
            loader.fetchCachedFile(baseUrl, name, shared, false, cacheName, signal, progressListener),
        );

        const cachedFiles = await Promise.all(filePromises);

        for (const file of cachedFiles) {
            files.set(file.name, file.data);
        }

        let mapNames: string[] = [];
        try {
            mapNames = await fetch(baseUrl + "maps.json").then((resp) => resp.json());
        } catch (e) { }

        for (const mapName of mapNames) {
            const mapFile = await loader.fetchCachedFile(
                baseUrl,
                "maps/" + mapName,
                shared,
                false,
                cacheName,
                signal,
            );
            files.set(mapFile.name, mapFile.data);
        }

        return new CacheFiles(files);
    }

    static async fetchDat(
        loader: CacheLoader,
        baseUrl: string,
        cacheName: string,
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        const files = new Map<string, ArrayBuffer>();

        const dataFilePromise = loader.fetchCachedFile(
            baseUrl,
            CacheFiles.DAT_FILE_NAME,
            shared,
            true,
            cacheName,
            signal,
            progressListener,
        );
        const indexFilePromises: Promise<CachedFile>[] = [];
        for (let i = 0; i < CacheFiles.DAT_INDEX_COUNT; i++) {
            indexFilePromises.push(
                loader.fetchCachedFile(baseUrl, CacheFiles.INDEX_FILE_PREFIX + i, shared, false, cacheName),
            );
        }

        const dataAndIndices = await Promise.all([dataFilePromise, ...indexFilePromises]);
        for (const file of dataAndIndices) {
            files.set(file.name, file.data);
        }

        return new CacheFiles(files);
    }

    static async fetchDat2(
        loader: CacheLoader,
        baseUrl: string,
        cacheName: string,
        indicesToLoad: number[] = [],
        shared: boolean = false,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheFiles> {
        const files = new Map<string, ArrayBuffer>();

        const dataFilePromise = loader.fetchCachedFile(
            baseUrl,
            CacheFiles.DAT2_FILE_NAME,
            shared,
            true,
            cacheName,
            signal,
            progressListener,
        );
        const metaFile = await loader.fetchCachedFile(
            baseUrl,
            CacheFiles.META_FILE_NAME,
            shared,
            false,
            cacheName,
        );
        const indexCount = metaFile.data.byteLength / SectorCluster.SIZE;

        if (indicesToLoad.length === 0) {
            indicesToLoad = Array.from({ length: indexCount }, (_, i) => i);
        }

        const indexPromises = indicesToLoad.map((indexId) =>
            loader.fetchCachedFile(
                baseUrl,
                CacheFiles.INDEX_FILE_PREFIX + indexId,
                shared,
                false,
                cacheName,
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

    constructor(readonly files: Map<string, ArrayBuffer>) { }
}

