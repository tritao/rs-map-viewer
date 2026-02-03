import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "../store/CacheStore";
import { SectorChainStore } from "../store/SectorChainStore";
import { CacheBundleTransfer, toCacheBytes } from "./CacheFiles";
import { ByteSource } from "../../io/ByteSource";
import { Uint8ArrayByteSource } from "../../io/Uint8ArrayByteSource";

export function createCacheStoreFromFiles(
    bundle: CacheBundleTransfer,
    indicesToLoad: number[] = [],
): {
    store: CacheStore;
    indexIds: number[];
} {
    if (bundle.kind !== "dat" && bundle.kind !== "dat2") {
        throw new Error(`Unsupported bundle kind for store: ${bundle.kind}`);
    }

    const dataFileBuffer = bundle.kind === "dat2" ? bundle.dat2 : bundle.dat;
    const dataFile = new Uint8ArrayByteSource(toCacheBytes(dataFileBuffer));

    const metaFile = bundle.kind === "dat2" ? new Uint8ArrayByteSource(toCacheBytes(bundle.idx255)) : null;

    const indicesSet = new Set(indicesToLoad);
    const indexSources: Array<ByteSource | null> = [];
    const indexIds: number[] = [];

    const idx = bundle.idx;
    for (let indexId = 0; indexId < idx.length; indexId++) {
        const data = idx[indexId];
        if (!data) {
            continue;
        }
        if (indicesSet.size === 0 || indicesSet.has(indexId)) {
            indexSources[indexId] = new Uint8ArrayByteSource(toCacheBytes(data));
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
