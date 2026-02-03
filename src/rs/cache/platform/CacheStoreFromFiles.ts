import { ArrayBufferByteSource } from "../../io/ArrayBufferByteSource";
import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "../store/CacheStore";
import { SectorChainStore } from "../store/SectorChainStore";
import { CacheFiles } from "./CacheFiles";

export function createCacheStoreFromFiles(
    cacheFiles: CacheFiles,
    indicesToLoad: number[] = [],
): {
    store: CacheStore;
    indexIds: number[];
} {
    const files = cacheFiles.files;

    const dataFile = files.get(CacheFiles.DAT2_FILE_NAME) ?? files.get(CacheFiles.DAT_FILE_NAME);
    if (!dataFile) {
        throw new Error("main_file_cache data file not found");
    }

    const metaFile = files.get(CacheFiles.META_FILE_NAME) ?? null;

    const indicesSet = new Set(indicesToLoad);
    const indexFiles: ArrayBuffer[] = [];
    const indexIds: number[] = [];

    for (const [name, data] of files.entries()) {
        if (
            name !== CacheFiles.META_FILE_NAME &&
            name.startsWith(CacheFiles.INDEX_FILE_PREFIX)
        ) {
            const indexId = parseInt(name.slice(CacheFiles.INDEX_FILE_PREFIX.length));
            if (!Number.isFinite(indexId) || indexId < 0) {
                continue;
            }
            if (indicesSet.size === 0 || indicesSet.has(indexId)) {
                indexFiles[indexId] = data;
                indexIds.push(indexId);
            }
        }
    }

    // Keep deterministic ordering for callers.
    indexIds.sort((a, b) => a - b);

    const indexSources = new Array<ArrayBufferByteSource | null>(Math.max(-1, ...indexIds) + 1).fill(null);
    for (const id of indexIds) {
        indexSources[id] = new ArrayBufferByteSource(indexFiles[id]);
    }

    const store = new SectorChainStore(
        new ArrayBufferByteSource(dataFile),
        indexSources,
        metaFile ? new ArrayBufferByteSource(metaFile) : null,
    );

    // Sanity: ensure meta index is visible when present.
    if (metaFile && store.getIndexFileSize(CacheIndex.META_INDEX_ID) === null) {
        throw new Error("Meta index file not available");
    }

    return {
        store,
        indexIds,
    };
}

