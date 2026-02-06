import { CompressionHandler } from "../../compression/CompressionHandler";
import { CacheStore } from "../store/CacheStore";
import { SectorChainStore } from "../store/SectorChainStore";
import { ByteSource } from "../../io/ByteSource";
import { Uint8ArrayByteSource } from "../../io/Uint8ArrayByteSource";
import { StringUtil } from "../../util/StringUtil";
import { Archive } from "../format/Archive";
import { LegacyCacheIndex } from "../CacheIndex";
import { CacheSystem } from "../CacheSystem";
import { CacheType } from "../CacheType";
import { LegacyIndexId } from "../IndexId";
import { CacheBundleTransfer, LegacyCacheBundleTransfer } from "./CacheFiles";
import { CacheBuffer, DAT_INDEX_COUNT, toCacheBytes } from "./CacheFiles";

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
        const indexFiles = Array.from(
            { length: DAT_INDEX_COUNT },
            (_, i) => sourceFromBuffer(bundle.idx[i]),
        );
        return {
            dataFile: sourceFromBuffer(bundle.dat),
            metaIndexFile: null,
            indexFiles,
        };
    }

    const indexFiles = Array.from({ length: bundle.idx.length }, (_, i) => {
        const buf = bundle.idx[i];
        return buf ? sourceFromBuffer(buf) : null;
    });

    return {
        dataFile: sourceFromBuffer(bundle.dat2),
        metaIndexFile: sourceFromBuffer(bundle.idx255),
        indexFiles,
    };
}

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
    const indexSources: Array<ByteSource | null> = Array.from(
        { length: bundle.indexFiles.length },
        () => null,
    );
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

    const store = new SectorChainStore(dataFile, indexSources, metaFile);

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
        LegacyIndexId.configs,
        [configArchive],
        compressionHandler,
    );

    const mediaArchive = Archive.decodeOld(0, readAll(media), true, compressionHandler);
    const mediaIndex = new LegacyCacheIndex(LegacyIndexId.media, [mediaArchive], compressionHandler);

    const textureArchive = Archive.decodeOld(0, readAll(textures), true, compressionHandler);
    const textureIndex = new LegacyCacheIndex(
        LegacyIndexId.textures,
        [textureArchive],
        compressionHandler,
    );

    const modelArchive = Archive.decodeOld(0, readAll(models), true, compressionHandler);
    const modelIndex = new LegacyCacheIndex(LegacyIndexId.models, [modelArchive], compressionHandler);

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
        LegacyIndexId.maps,
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
