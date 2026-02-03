export type CacheBuffer = ArrayBuffer | SharedArrayBuffer;

export const CACHE_FILE = {
    DAT: "main_file_cache.dat",
    DAT2: "main_file_cache.dat2",
    INDEX_PREFIX: "main_file_cache.idx",
    META: "main_file_cache.idx255",
} as const;

// Dat (pre-idx255) caches expose a fixed set of indices.
export const DAT_INDEX_COUNT: number = 5;

export function isCacheIndexFileName(name: string): boolean {
    return name !== CACHE_FILE.META && name.startsWith(CACHE_FILE.INDEX_PREFIX);
}

export function parseCacheIndexIdFromFileName(name: string): number | null {
    if (!isCacheIndexFileName(name)) {
        return null;
    }
    const indexId = parseInt(name.slice(CACHE_FILE.INDEX_PREFIX.length));
    if (!Number.isFinite(indexId) || indexId < 0) {
        return null;
    }
    return indexId;
}

export type CacheBundleKind = "legacy" | "dat" | "dat2";

export type LegacyCacheBundleTransfer = {
    kind: "legacy";
    legacy: {
        config: CacheBuffer;
        media: CacheBuffer;
        textures: CacheBuffer;
        models: CacheBuffer;
        title?: CacheBuffer;
        maps: CacheBuffer[];
        mapNames?: string[];
    };
};

export type DatCacheBundleTransfer = {
    kind: "dat";
    dat: CacheBuffer;
    idx: CacheBuffer[]; // length DAT_INDEX_COUNT
};

export type Dat2CacheBundleTransfer = {
    kind: "dat2";
    dat2: CacheBuffer;
    idx255: CacheBuffer;
    idx: Array<CacheBuffer | null>; // indexId -> buffer (may be sparse)
};

/**
 * Serializable cache bundle.
 *
 * This type is intended to cross thread boundaries (main thread ↔ worker) via structured clone.
 * Keep it composed of cloneable/transferable primitives only (no class instances with methods).
 */
export type CacheBundleTransfer =
    | LegacyCacheBundleTransfer
    | DatCacheBundleTransfer
    | Dat2CacheBundleTransfer;
