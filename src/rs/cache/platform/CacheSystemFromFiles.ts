import { CompressionHandler } from "../../compression/CompressionHandler";
import { StringUtil } from "../../util/StringUtil";
import { Archive } from "../format/Archive";
import { CacheSystem } from "../CacheSystem";
import { CacheType } from "../CacheType";
import { LegacyCacheIndex } from "../CacheIndex";
import { LegacyIndexType } from "../IndexType";
import { CacheBuffer, CacheBundleTransfer, LegacyCacheBundleTransfer, toCacheBytes } from "./CacheFiles";
import { CacheStoreSources } from "./CacheStoreSources";
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

export function createCacheSystemFromStoreSources(
    cacheType: CacheType.Dat | CacheType.Dat2,
    cacheSources: CacheStoreSources,
    compressionHandler: CompressionHandler,
    indicesToLoad: number[] = [],
): CacheSystem {
    const { store, indexIds } = createCacheStoreFromBundleSources(cacheSources, indicesToLoad);
    return CacheSystem.fromStore(cacheType, store, indexIds, compressionHandler);
}

function readAll(buffer: CacheBuffer): Uint8Array {
    return toCacheBytes(buffer);
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

    const indices = new Map<number, LegacyCacheIndex>();
    indices.set(configIndex.id, configIndex);
    indices.set(mediaIndex.id, mediaIndex);
    indices.set(textureIndex.id, textureIndex);
    indices.set(modelIndex.id, modelIndex);
    indices.set(mapIndex.id, mapIndex);
    return new CacheSystem(indices, compressionHandler);
}
