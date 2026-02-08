import { CompressionHandler } from "../compression/CompressionHandler";
import { XteaKey } from "../crypto/Xtea";
import { CacheIndex, Dat2CacheIndex, DatCacheIndex } from "./CacheIndex";
import { CacheType } from "./CacheType";
import { Archive } from "./format/Archive";
import { ArchiveReference } from "./reference/ArchiveReference";
import { CacheStore } from "./store/CacheStore";

export class CacheSystem {
    static loadIndicesFromStore(
        cacheType: CacheType,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): Map<number, CacheIndex> {
        const indices: Map<number, CacheIndex> = new Map();

        for (const id of indexIds) {
            const index =
                cacheType === CacheType.Dat
                    ? DatCacheIndex.fromStore(id, store, compressionHandler)
                    : Dat2CacheIndex.fromDat2Store(id, store, compressionHandler);
            indices.set(id, index);
        }

        return indices;
    }

    static fromStore(
        cacheType: CacheType.Dat | CacheType.Dat2,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): CacheSystem {
        const indices = CacheSystem.loadIndicesFromStore(
            cacheType,
            store,
            indexIds,
            compressionHandler,
        );
        return new CacheSystem(indices, compressionHandler);
    }

    constructor(
        readonly indices: ReadonlyMap<number, CacheIndex>,
        readonly compressionHandler: CompressionHandler,
    ) {}

    indexExists(indexId: number): boolean {
        return this.indices.has(indexId);
    }

    tryGetIndex(indexId: number): CacheIndex | undefined {
        return this.indices.get(indexId);
    }

    getIndex(indexId: number): CacheIndex {
        const index = this.indices.get(indexId);
        if (!index) {
            throw new Error("Index not found: " + indexId);
        }
        return index;
    }

    readArchiveBytes(indexId: number, archiveId: number): Uint8Array {
        return this.getIndex(indexId).readArchiveBytes(archiveId);
    }

    readContainerPayload(indexId: number, archiveId: number, key: XteaKey | null): Uint8Array {
        return this.getIndex(indexId).readContainerPayload(archiveId, key);
    }

    tryReadContainerPayload(
        indexId: number,
        archiveId: number,
        key: XteaKey | null,
    ): Uint8Array | undefined {
        return this.indices.get(indexId)?.tryReadContainerPayload(archiveId, key);
    }

    getArchiveKey(indexId: number, archiveId: number, key: XteaKey | null): Archive {
        return this.getIndex(indexId).getArchiveKey(archiveId, key);
    }

    getArchive(indexId: number, archiveId: number): Archive {
        return this.getIndex(indexId).getArchive(archiveId);
    }

    tryGetArchive(indexId: number, archiveId: number): Archive | undefined {
        return this.indices.get(indexId)?.tryGetArchive(archiveId);
    }

    /**
     * Dat2-only: returns the archive reference/metadata for splitting archive payload into files
     * (and optional integrity/name fields). Returns null if not available.
     */
    getArchiveReference(indexId: number, archiveId: number): ArchiveReference | null {
        return this.getIndex(indexId).getArchiveReference(archiveId);
    }

    /**
     * Dat2-only: returns the subset of archive metadata required to split payload bytes into files.
     * Returns null if not available.
     */
    getArchiveMeta(
        indexId: number,
        archiveId: number,
    ): {
        id: number;
        lastFileId: number;
        fileCount: number;
        fileIds: Int32Array;
        fileNameHashes: Int32Array;
    } | null {
        const ref = this.getArchiveReference(indexId, archiveId);
        if (!ref) {
            return null;
        }
        return {
            id: ref.id,
            lastFileId: ref.lastFileId,
            fileCount: ref.fileCount,
            fileIds: ref.fileIds,
            fileNameHashes: ref.fileNameHashes,
        };
    }
}
