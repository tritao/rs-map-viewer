import { CompressionHandler } from "../../compression/CompressionHandler";
import { StringUtil } from "../../util/StringUtil";
import { Archive } from "../format/Archive";
import { CacheSystem } from "../CacheSystem";
import { CacheType } from "../CacheType";
import { LegacyCacheIndex } from "../CacheIndex";
import { LegacyIndexType } from "../IndexType";
import { CacheFileBuffer, CacheFilesTransfer } from "./CacheFiles";
import { createCacheStoreFromFiles } from "./CacheStoreFromFiles";

export function createCacheSystemFromFiles(
    cacheType: CacheType,
    cacheFiles: CacheFilesTransfer,
    compressionHandler: CompressionHandler,
    indicesToLoad: number[] = [],
): CacheSystem {
    switch (cacheType) {
        case CacheType.Legacy:
            return createLegacyCacheSystem(cacheFiles, compressionHandler);
        case CacheType.Dat:
        case CacheType.Dat2: {
            const { store, indexIds } = createCacheStoreFromFiles(cacheFiles, indicesToLoad);
            return CacheSystem.fromStore(cacheType, store, indexIds, compressionHandler);
        }
        default:
            throw new Error("Not implemented");
    }
}

function readAll(buffer: CacheFileBuffer): Int8Array {
    return new Int8Array(buffer);
}

function createLegacyCacheSystem(cacheFiles: CacheFilesTransfer, compressionHandler: CompressionHandler): CacheSystem {
    const configDataRaw = cacheFiles.files.get("config");
    if (!configDataRaw) {
        throw new Error("Missing config file");
    }
    const configArchive = Archive.decodeOld(0, readAll(configDataRaw), true, compressionHandler);
    const configIndex = new LegacyCacheIndex(
        LegacyIndexType.configs,
        [configArchive],
        compressionHandler,
    );

    const mediaDataRaw = cacheFiles.files.get("media");
    if (!mediaDataRaw) {
        throw new Error("Missing media file");
    }
    const mediaArchive = Archive.decodeOld(0, readAll(mediaDataRaw), true, compressionHandler);
    const mediaIndex = new LegacyCacheIndex(LegacyIndexType.media, [mediaArchive], compressionHandler);

    const textureDataRaw = cacheFiles.files.get("textures");
    if (!textureDataRaw) {
        throw new Error("Missing textures file");
    }
    const textureArchive = Archive.decodeOld(0, readAll(textureDataRaw), true, compressionHandler);
    const textureIndex = new LegacyCacheIndex(
        LegacyIndexType.textures,
        [textureArchive],
        compressionHandler,
    );

    const modelDataRaw = cacheFiles.files.get("models");
    if (!modelDataRaw) {
        throw new Error("Missing models file");
    }
    const modelArchive = Archive.decodeOld(0, readAll(modelDataRaw), true, compressionHandler);
    const modelIndex = new LegacyCacheIndex(LegacyIndexType.models, [modelArchive], compressionHandler);

    const mapsPrefix = "maps/";
    const mapArchives: Archive[] = [];
    const mapArchiveNameHashes = new Map<number, number>();
    const entries = Array.from(cacheFiles.files.entries());
    for (let i = 0; i < entries.length; i++) {
        const name = entries[i][0];
        if (name.startsWith(mapsPrefix)) {
            const data = entries[i][1];
            const archiveName = name.substring(mapsPrefix.length);
            const archiveId = mapArchives.length;
            mapArchives.push(Archive.create(archiveId, readAll(data)));
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
