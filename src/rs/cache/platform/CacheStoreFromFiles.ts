import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "../store/CacheStore";
import { SectorChainStore } from "../store/SectorChainStore";
import { ByteSource } from "../../io/ByteSource";
import { CacheBundleTransfer } from "./CacheFiles";
import { CacheStoreSources, hydrateCacheStoreSources } from "./CacheBundleSources";

export function createCacheStoreFromBundleSources(
    bundle: CacheStoreSources,
    indicesToLoad: number[] = [],
): {
    store: CacheStore;
    indexIds: number[];
} {
    const dataFile = bundle.dataFile;
    const metaFile = bundle.metaIndexFile;

    const indicesSet = new Set(indicesToLoad);
    const indexSources: Array<ByteSource | null> = new Array(bundle.indexFiles.length);
    const indexIds: number[] = [];

    for (let indexId = 0; indexId < bundle.indexFiles.length; indexId++) {
        const source = bundle.indexFiles[indexId];
        if (!source) {
            continue;
        }
        if (indicesSet.size === 0 || indicesSet.has(indexId)) {
            indexSources[indexId] = source;
            indexIds.push(indexId);
        } else {
            indexSources[indexId] = null;
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

export function createCacheStoreFromFiles(
    bundle: CacheBundleTransfer,
    indicesToLoad: number[] = [],
): {
    store: CacheStore;
    indexIds: number[];
} {
    return createCacheStoreFromBundleSources(hydrateCacheStoreSources(bundle), indicesToLoad);
}
