import { ByteSource } from "../../io/ByteSource";
import { Uint8ArrayByteSource } from "../../io/Uint8ArrayByteSource";
import { CacheBundleTransfer, CacheBuffer, DAT_INDEX_COUNT, toCacheBytes } from "./CacheFiles";

export type CacheStoreSources = {
    dataFile: ByteSource;
    metaIndexFile: ByteSource | null;
    indexFiles: Array<ByteSource | null>;
};

function sourceFromBuffer(buffer: CacheBuffer): ByteSource {
    return new Uint8ArrayByteSource(toCacheBytes(buffer));
}

export function hydrateCacheStoreSources(bundle: CacheBundleTransfer): CacheStoreSources {
    if (bundle.kind === "legacy") {
        throw new Error(`Unsupported bundle kind for store sources: ${bundle.kind}`);
    }

    if (bundle.kind === "dat") {
        const indexFiles = new Array<ByteSource | null>(DAT_INDEX_COUNT);
        for (let i = 0; i < DAT_INDEX_COUNT; i++) {
            indexFiles[i] = sourceFromBuffer(bundle.idx[i]);
        }
        return {
            dataFile: sourceFromBuffer(bundle.dat),
            metaIndexFile: null,
            indexFiles,
        };
    }

    const indexFiles = new Array<ByteSource | null>(bundle.idx.length);
    for (let i = 0; i < bundle.idx.length; i++) {
        const buf = bundle.idx[i];
        indexFiles[i] = buf ? sourceFromBuffer(buf) : null;
    }

    return {
        dataFile: sourceFromBuffer(bundle.dat2),
        metaIndexFile: sourceFromBuffer(bundle.idx255),
        indexFiles,
    };
}
