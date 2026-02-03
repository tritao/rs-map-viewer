import { CompressionHandler } from "../../compression/CompressionHandler";
import { StringUtil } from "../../util/StringUtil";
import { Archive } from "../format/Archive";
import { CacheSystem } from "../CacheSystem";
import { CacheType } from "../CacheType";
import { LegacyCacheIndex } from "../CacheIndex";
import { LegacyIndexType } from "../IndexType";
import { CacheBuffer, CacheBundleTransfer, LegacyCacheBundleTransfer } from "./CacheFiles";
import { CacheStoreSources, hydrateCacheStoreSources } from "./CacheBundleSources";
import { createCacheStoreFromBundleSources, createCacheStoreFromFiles } from "./CacheStoreFromFiles";

export function createCacheSystemFromFiles(
    cacheType: CacheType,
    cacheBundle: CacheBundleTransfer,
    compressionHandler: CompressionHandler,
    indicesToLoad: number[] = [],
): CacheSystem {
    switch (cacheType) {
        case CacheType.Classic:
        case CacheType.Legacy:
            if (cacheBundle.kind !== "legacy") {
                throw new Error(`Expected legacy bundle, got ${cacheBundle.kind}`);
            }
            return createLegacyCacheSystem(cacheBundle, compressionHandler);
        case CacheType.Dat:
        case CacheType.Dat2: {
            const { store, indexIds } = createCacheStoreFromFiles(cacheBundle, indicesToLoad);
            return CacheSystem.fromStore(cacheType, store, indexIds, compressionHandler);
        }
        default:
            throw new Error("Not implemented");
    }
}

export function createCacheSystemFromBundleSources(
    cacheType: CacheType.Dat | CacheType.Dat2,
    cacheBundle: CacheStoreSources,
    compressionHandler: CompressionHandler,
    indicesToLoad: number[] = [],
): CacheSystem {
    const { store, indexIds } = createCacheStoreFromBundleSources(cacheBundle, indicesToLoad);
    return CacheSystem.fromStore(cacheType, store, indexIds, compressionHandler);
}

export function hydrateCacheBundleForStore(cacheBundle: CacheBundleTransfer): CacheStoreSources {
    return hydrateCacheStoreSources(cacheBundle);
}

function readAll(buffer: CacheBuffer): Int8Array {
    return new Int8Array(buffer);
}

function createLegacyCacheSystem(cacheBundle: LegacyCacheBundleTransfer, compressionHandler: CompressionHandler): CacheSystem {
    const { config, media, textures, models, maps, mapNames } = cacheBundle.legacy;

    const configArchive = Archive.decodeOld(0, readAll(config), true, compressionHandler);
    const configIndex = new LegacyCacheIndex(
        LegacyIndexType.configs,
        [configArchive],
        compressionHandler,
    );

    const mediaArchive = Archive.decodeOld(0, readAll(media), true, compressionHandler);
    const mediaIndex = new LegacyCacheIndex(LegacyIndexType.media, [mediaArchive], compressionHandler);

    const textureArchive = Archive.decodeOld(0, readAll(textures), true, compressionHandler);
    const textureIndex = new LegacyCacheIndex(
        LegacyIndexType.textures,
        [textureArchive],
        compressionHandler,
    );

    const modelArchive = Archive.decodeOld(0, readAll(models), true, compressionHandler);
    const modelIndex = new LegacyCacheIndex(LegacyIndexType.models, [modelArchive], compressionHandler);

    const mapArchives: Archive[] = [];
    const mapArchiveNameHashes = new Map<number, number>();

    if (maps.length > 0) {
        if (!mapNames || mapNames.length !== maps.length) {
            throw new Error("Legacy maps bundle is missing mapNames");
        }
        for (let i = 0; i < maps.length; i++) {
            const archiveName = mapNames[i];
            const archiveId = mapArchives.length;
            mapArchives.push(Archive.create(archiveId, readAll(maps[i])));
            mapArchiveNameHashes.set(StringUtil.hashOld(archiveName), archiveId);
        }
    }
    const mapIndex = new LegacyCacheIndex(
        LegacyIndexType.maps,
        mapArchives,
        compressionHandler,
        mapArchiveNameHashes,
    );

    return new CacheSystem([configIndex, mediaIndex, textureIndex, modelIndex, mapIndex], compressionHandler);
}
