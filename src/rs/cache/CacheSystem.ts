import { StringUtil } from "../util/StringUtil";
import { Archive } from "./Archive";
import { CacheFiles } from "./CacheFiles";
import { CacheIndex, CacheIndexDat, CacheIndexDat2, LegacyCacheIndex } from "./CacheIndex";
import { CacheType } from "./CacheType";
import { LegacyIndexType, DatIndexType } from "./IndexType";
import { MemoryStore } from "./store/MemoryStore";

export class CacheSystem {
    static loadIndicesFromStore(cacheType: CacheType, store: MemoryStore) {
        return store.indexFiles.map((indexFile, id) => {
            if (!indexFile) {
                return undefined;
            }
            if (cacheType === CacheType.Dat) {
                return CacheIndexDat.fromStore(id, store, indexFile);
            } else {
                return CacheIndexDat2.fromStore(id, store);
            }
        });
    }

    static loadLegacy(cacheFiles: CacheFiles): CacheSystem {
        const configData = cacheFiles.files.get("config");
        if (!configData) {
            throw new Error("Missing config file");
        }
        const configArchive = Archive.decodeOld(0, new Int8Array(configData), true);
        const configIndex = new LegacyCacheIndex(LegacyIndexType.configs, [configArchive]);

        const mediaData = cacheFiles.files.get("media");
        if (!mediaData) {
            throw new Error("Missing media file");
        }
        const mediaArchive = Archive.decodeOld(0, new Int8Array(mediaData), true);
        const mediaIndex = new LegacyCacheIndex(LegacyIndexType.media, [mediaArchive]);

        const textureData = cacheFiles.files.get("textures");
        if (!textureData) {
            throw new Error("Missing textures file");
        }
        const textureArchive = Archive.decodeOld(0, new Int8Array(textureData), true);
        const textureIndex = new LegacyCacheIndex(LegacyIndexType.textures, [textureArchive]);

        const modelData = cacheFiles.files.get("models");
        if (!modelData) {
            throw new Error("Missing models file");
        }
        const modelArchive = Archive.decodeOld(0, new Int8Array(modelData), true);
        const modelIndex = new LegacyCacheIndex(LegacyIndexType.models, [modelArchive]);

        const mapsPrefix = "maps/";
        const mapArchives: Archive[] = [];
        const mapArchiveNameHashes = new Map<number, number>();
        for (const [name, data] of cacheFiles.files) {
            if (!name.startsWith(mapsPrefix)) {
                continue;
            }
            const archiveName = name.substring(mapsPrefix.length);
            const archiveId = mapArchives.length;
            mapArchives.push(Archive.create(archiveId, new Int8Array(data)));
            mapArchiveNameHashes.set(StringUtil.hashOld(archiveName), archiveId);
        }
        const mapIndex = new LegacyCacheIndex(
            LegacyIndexType.maps,
            mapArchives,
            mapArchiveNameHashes,
        );

        return new CacheSystem([configIndex, mediaIndex, textureIndex, modelIndex, mapIndex]);
    }

    static fromFiles(
        cacheType: CacheType,
        cacheFiles: CacheFiles,
        indicesToLoad: number[] = [],
    ): CacheSystem {
        switch (cacheType) {
            case CacheType.Legacy:
                return CacheSystem.loadLegacy(cacheFiles);
            case CacheType.Dat:
            case CacheType.Dat2:
                const store = MemoryStore.fromFiles(cacheFiles, indicesToLoad);
                const indices = CacheSystem.loadIndicesFromStore(cacheType, store);
                return new CacheSystem(indices);
        }
        throw new Error("Not implemented");
    }

    constructor(readonly indices: (CacheIndex | undefined)[]) {}

    indexExists(indexId: number): boolean {
        return !!this.indices[indexId];
    }

    getIndex(indexId: number): CacheIndex {
        const index = this.indices[indexId];
        if (!index) {
            throw new Error("Index not found: " + indexId);
        }
        return index;
    }
}
