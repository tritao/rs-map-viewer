import { CompressionHandler } from "../../compression/CompressionHandler";
import { StringUtil } from "../../util/StringUtil";
import { Archive } from "../format/Archive";
import { CacheSystem } from "../CacheSystem";
import { CacheType } from "../CacheType";
import { LegacyCacheIndex } from "../CacheIndex";
import { LegacyIndexType } from "../IndexType";
import { CacheFiles } from "./CacheFiles";
import { createCacheStoreFromFiles } from "./CacheStoreFromFiles";
import { ByteSource } from "../../io/ByteSource";

export function createCacheSystemFromFiles(
    cacheType: CacheType,
    cacheFiles: CacheFiles,
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

function readAll(source: ByteSource): Int8Array {
    const data = new Int8Array(source.size);
    source.readInto(0, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return data;
}

function createLegacyCacheSystem(cacheFiles: CacheFiles, compressionHandler: CompressionHandler): CacheSystem {
    const configData = cacheFiles.files.get("config");
    if (!configData) {
        throw new Error("Missing config file");
    }
    const configArchive = Archive.decodeOld(0, readAll(configData), true, compressionHandler);
    const configIndex = new LegacyCacheIndex(
        LegacyIndexType.configs,
        [configArchive],
        compressionHandler,
    );

    const mediaData = cacheFiles.files.get("media");
    if (!mediaData) {
        throw new Error("Missing media file");
    }
    const mediaArchive = Archive.decodeOld(0, readAll(mediaData), true, compressionHandler);
    const mediaIndex = new LegacyCacheIndex(LegacyIndexType.media, [mediaArchive], compressionHandler);

    const textureData = cacheFiles.files.get("textures");
    if (!textureData) {
        throw new Error("Missing textures file");
    }
    const textureArchive = Archive.decodeOld(0, readAll(textureData), true, compressionHandler);
    const textureIndex = new LegacyCacheIndex(
        LegacyIndexType.textures,
        [textureArchive],
        compressionHandler,
    );

    const modelData = cacheFiles.files.get("models");
    if (!modelData) {
        throw new Error("Missing models file");
    }
    const modelArchive = Archive.decodeOld(0, readAll(modelData), true, compressionHandler);
    const modelIndex = new LegacyCacheIndex(LegacyIndexType.models, [modelArchive], compressionHandler);

    const mapsPrefix = "maps/";
    const mapArchives: Archive[] = [];
    const mapArchiveNameHashes = new Map<number, number>();
    const entries = Array.from(cacheFiles.files.entries());
    for (let i = 0; i < entries.length; i++) {
        const name = entries[i][0];
        const data = entries[i][1];
        if (name.startsWith(mapsPrefix)) {
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
