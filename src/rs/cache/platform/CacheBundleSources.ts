import { ByteSource } from "../../io/ByteSource";
import { Uint8ArrayByteSource } from "../../io/Uint8ArrayByteSource";
import { CacheBundleTransfer, CacheBuffer, DAT_INDEX_COUNT, toCacheBytes } from "./CacheFiles";

export type DatCacheBundleSources = {
    kind: "dat";
    dat: ByteSource;
    idx: ByteSource[]; // length DAT_INDEX_COUNT
};

export type Dat2CacheBundleSources = {
    kind: "dat2";
    dat2: ByteSource;
    idx255: ByteSource;
    idx: Array<ByteSource | null>; // indexId -> source (may be sparse)
};

export type CacheStoreBundleSources = DatCacheBundleSources | Dat2CacheBundleSources;

function sourceFromBuffer(buffer: CacheBuffer): ByteSource {
    return new Uint8ArrayByteSource(toCacheBytes(buffer));
}

export function hydrateCacheStoreBundleSources(bundle: CacheBundleTransfer): CacheStoreBundleSources {
    if (bundle.kind === "legacy") {
        throw new Error(`Unsupported bundle kind for store sources: ${bundle.kind}`);
    }

    if (bundle.kind === "dat") {
        const idx = new Array<ByteSource>(DAT_INDEX_COUNT);
        for (let i = 0; i < DAT_INDEX_COUNT; i++) {
            idx[i] = sourceFromBuffer(bundle.idx[i]);
        }
        return {
            kind: "dat",
            dat: sourceFromBuffer(bundle.dat),
            idx,
        };
    }

    const idx = new Array<ByteSource | null>(bundle.idx.length);
    for (let i = 0; i < bundle.idx.length; i++) {
        const buf = bundle.idx[i];
        idx[i] = buf ? sourceFromBuffer(buf) : null;
    }

    return {
        kind: "dat2",
        dat2: sourceFromBuffer(bundle.dat2),
        idx255: sourceFromBuffer(bundle.idx255),
        idx,
    };
}

