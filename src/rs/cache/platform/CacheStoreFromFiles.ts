import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "../store/CacheStore";
import { SectorChainStore } from "../store/SectorChainStore";
import { ByteSource } from "../../io/ByteSource";
import { CacheBundleTransfer } from "./CacheFiles";
import { CacheStoreBundleSources, hydrateCacheStoreBundleSources } from "./CacheBundleSources";

export function createCacheStoreFromBundleSources(
    bundle: CacheStoreBundleSources,
    indicesToLoad: number[] = [],
): {
    store: CacheStore;
    indexIds: number[];
} {
    const dataFile = bundle.kind === "dat2" ? bundle.dat2 : bundle.dat;
    const metaFile = bundle.kind === "dat2" ? bundle.idx255 : null;

    const indicesSet = new Set(indicesToLoad);
    const indexSources: Array<ByteSource | null> = [];
    const indexIds: number[] = [];

    const idx = bundle.idx;
    for (let indexId = 0; indexId < idx.length; indexId++) {
        const source = idx[indexId];
        if (!source) {
            continue;
        }
        if (indicesSet.size === 0 || indicesSet.has(indexId)) {
            indexSources[indexId] = source;
            indexIds.push(indexId);
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
    return createCacheStoreFromBundleSources(hydrateCacheStoreBundleSources(bundle), indicesToLoad);
}
