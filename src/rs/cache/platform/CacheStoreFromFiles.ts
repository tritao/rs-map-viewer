import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "../store/CacheStore";
import { SectorChainStore } from "../store/SectorChainStore";
import { CACHE_FILE, CacheFilesTransfer, parseCacheIndexIdFromFileName } from "./CacheFiles";
import { ArrayBufferByteSource } from "../../io/ArrayBufferByteSource";
import { ByteSource } from "../../io/ByteSource";

export function createCacheStoreFromFiles(
    cacheFiles: CacheFilesTransfer,
    indicesToLoad: number[] = [],
): {
    store: CacheStore;
    indexIds: number[];
} {
    const files = cacheFiles.files;

    const dataFileBuffer =
        files.get(CACHE_FILE.DAT2) ?? files.get(CACHE_FILE.DAT);
    if (!dataFileBuffer) {
        throw new Error("main_file_cache data file not found");
    }
    const dataFile = new ArrayBufferByteSource(dataFileBuffer);

    const metaFileBuffer = files.get(CACHE_FILE.META) ?? null;
    const metaFile = metaFileBuffer ? new ArrayBufferByteSource(metaFileBuffer) : null;

    const indicesSet = new Set(indicesToLoad);
    const indexSources: Array<ByteSource | null> = [];
    const indexIds: number[] = [];

    for (const [name, data] of files.entries()) {
        const indexId = parseCacheIndexIdFromFileName(name);
        if (indexId !== null) {
            if (indicesSet.size === 0 || indicesSet.has(indexId)) {
                indexSources[indexId] = new ArrayBufferByteSource(data);
                indexIds.push(indexId);
            }
        }
    }

    // Keep deterministic ordering for callers.
    indexIds.sort((a, b) => a - b);

    const store = new SectorChainStore(dataFile, indexSources, metaFile);

    // Sanity: ensure meta index is visible when present.
    if (metaFile && store.getIndexFileSize(CacheIndex.META_INDEX_ID) === null) {
        throw new Error("Meta index file not available");
    }

    return {
        store,
        indexIds,
    };
}
