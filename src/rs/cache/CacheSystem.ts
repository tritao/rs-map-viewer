import { StringUtil } from "../util/StringUtil";
import { CompressionHandler } from "../compression/CompressionHandler";
import { Archive } from "./format/Archive";
import { CacheFiles } from "./CacheFiles";
import { CacheIndex, CacheIndexDat, CacheIndexDat2, LegacyCacheIndex } from "./CacheIndex";
import { CacheType } from "./CacheType";
import { LegacyIndexType, DatIndexType } from "./IndexType";
import { MemoryStore } from "./store/MemoryStore";
import { CacheStore } from "./store/CacheStore";

export class CacheSystem {
    static loadIndicesFromStore(
        cacheType: CacheType,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): Array<CacheIndex | null> {
        const maxIndexId = indexIds.length ? Math.max(...indexIds) : -1;
        const indices: Array<CacheIndex | null> = new Array(maxIndexId + 1).fill(null);

        for (const id of indexIds) {
            if (cacheType === CacheType.Dat) {
                indices[id] = CacheIndexDat.fromStore(id, store, compressionHandler);
            } else {
                indices[id] = CacheIndexDat2.fromStore(id, store, compressionHandler);
            }
        }

        return indices;
    }

    static loadLegacy(cacheFiles: CacheFiles, compressionHandler: CompressionHandler): CacheSystem {
        const configData = cacheFiles.files.get("config");
        if (!configData) {
            throw new Error("Missing config file");
        }
        const configArchive = Archive.decodeOld(0, new Int8Array(configData), true, compressionHandler);
        const configIndex = new LegacyCacheIndex(
            LegacyIndexType.configs,
            [configArchive],
            compressionHandler,
        );

        const mediaData = cacheFiles.files.get("media");
        if (!mediaData) {
            throw new Error("Missing media file");
        }
        const mediaArchive = Archive.decodeOld(0, new Int8Array(mediaData), true, compressionHandler);
        const mediaIndex = new LegacyCacheIndex(LegacyIndexType.media, [mediaArchive], compressionHandler);

        const textureData = cacheFiles.files.get("textures");
        if (!textureData) {
            throw new Error("Missing textures file");
        }
        const textureArchive = Archive.decodeOld(0, new Int8Array(textureData), true, compressionHandler);
        const textureIndex = new LegacyCacheIndex(
            LegacyIndexType.textures,
            [textureArchive],
            compressionHandler,
        );

        const modelData = cacheFiles.files.get("models");
        if (!modelData) {
            throw new Error("Missing models file");
        }
        const modelArchive = Archive.decodeOld(0, new Int8Array(modelData), true, compressionHandler);
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
                mapArchives.push(Archive.create(archiveId, new Int8Array(data)));
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

    static fromFiles(
        cacheType: CacheType,
        cacheFiles: CacheFiles,
        compressionHandler: CompressionHandler,
        indicesToLoad: number[] = [],
    ): CacheSystem {
        switch (cacheType) {
            case CacheType.Legacy:
                return CacheSystem.loadLegacy(cacheFiles, compressionHandler);
            case CacheType.Dat:
            case CacheType.Dat2:
                const store = MemoryStore.fromFiles(cacheFiles, indicesToLoad);
                const indexIds = store.indexFiles
                    .map((file, id) => (file ? id : -1))
                    .filter((id) => id !== -1);
                const indices = CacheSystem.loadIndicesFromStore(cacheType, store, indexIds, compressionHandler);
                return new CacheSystem(indices, compressionHandler);
        }
        throw new Error("Not implemented");
    }

    static fromStore(
        cacheType: CacheType.Dat | CacheType.Dat2,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): CacheSystem {
        const indices = CacheSystem.loadIndicesFromStore(cacheType, store, indexIds, compressionHandler);
        return new CacheSystem(indices, compressionHandler);
    }

    constructor(
        readonly indices: (CacheIndex | null)[],
        readonly compressionHandler: CompressionHandler,
    ) {}

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
