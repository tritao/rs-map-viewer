import { StringUtil } from "../util/StringUtil";
import { CompressionHandler } from "../compression/CompressionHandler";
import { Archive } from "./format/Archive";
import { ArchiveFile } from "./format/ArchiveFile";
import { Container } from "./format/Container";
import { DatIndexType } from "./IndexType";
import { ArchiveReference } from "./ref/ArchiveReference";
import { ReferenceTable } from "./ref/ReferenceTable";
import { CacheStore } from "./store/CacheStore";
import { SectorCluster } from "./store/SectorCluster";
import { ByteSource } from "../io/ByteSource";
import { Uint8ArrayByteSource } from "../io/Uint8ArrayByteSource";
import { ByteSourceReader } from "../io/ByteSourceReader";

export abstract class CacheIndex {
    static readonly META_INDEX_ID: i32 = 255;

    constructor(
        readonly id: number,
        readonly table: ReferenceTable,
        readonly compressionHandler: CompressionHandler,
    ) {}

    getArchiveIds(): Int32Array {
        return this.table.archiveIds;
    }

    getArchiveCount(): number {
        return this.table.archiveCount;
    }

    getLastArchiveId(): number {
        return this.table.lastArchiveId;
    }

    getArchiveReference(archiveId: number): ArchiveReference | null {
        return this.table.getArchiveReference(archiveId);
    }

    getArchiveId(name: string): number {
        const value = this.table.getArchiveId(name);
        return value ? value : -1;
    }

    getFileIds(archiveId: number): Int32Array | null {
        const ref = this.getArchiveReference(archiveId);
        return ref ? ref.fileIds : null;
    }

    archiveExists(archiveId: number): boolean {
        return this.table.archiveExists(archiveId);
    }

    getFileCount(archiveId: number): number {
        const value = this.table.getArchiveReference(archiveId);
        return value ? value.fileCount : 0;
    }

    abstract getArchiveKey(archiveId: number, key: number[] | null): Archive;

    getArchive(archiveId: number): Archive {
        return this.getArchiveKey(archiveId, null)
    }

    getFileKey(
        archiveId: number,
        fileId: number,
        key: number[] | null,
    ): ArchiveFile | null {
        return this.getArchiveKey(archiveId, key).getFile(fileId);
    }

    getFileSmart(id: number, key: number[] | null): ArchiveFile | null {
        if (this.getArchiveCount() === 1) {
            return this.getFileKey(0, id, key);
        } else if (this.getFileCount(id) === 1) {
            return this.getFileKey(id, 0, key);
        }
        throw new Error("Invalid archive");
    }

    getFile(
        archiveId: number,
        fileId: number,
    ): ArchiveFile | null {
        return this.getFileKey(archiveId, fileId, null)
    }
}

export abstract class CacheStoreIndex extends CacheIndex {
    constructor(
        id: number,
        table: ReferenceTable,
        readonly store: CacheStore,
        compressionHandler: CompressionHandler,
    ) {
        super(id, table, compressionHandler);
    }

    read(archiveId: number): Int8Array {
        return this.store.read(this.id, archiveId);
    }
}

export class CacheIndexDat extends CacheStoreIndex {
    static fromStore(
        id: number,
        store: CacheStore,
        compressionHandler: CompressionHandler,
    ): CacheIndexDat {
        const indexSize = store.getIndexFileSize(id);
        if (indexSize === null) {
            throw new Error("Index file not found: " + id);
        }
        const table = ReferenceTable.fromArchiveCount(indexSize / SectorCluster.SIZE);
        return new CacheIndexDat(id, table, store, compressionHandler);
    }

    override getArchiveKey(id: number, key: number[] | null): Archive {
        const data = this.read(id);
        return Archive.decodeOld(id, data, this.id === DatIndexType.configs, this.compressionHandler);
    }
}

function decodeTable(data: Int8Array, compressionHandler: CompressionHandler): ReferenceTable {
    if (data.length) {
        const container = Container.decodeFromSource(byteSourceFromInt8Array(data), null, compressionHandler);
        return ReferenceTable.decodeFromReader(new ByteSourceReader(byteSourceFromInt8Array(container.data)));
    }
    return ReferenceTable.INVALID_TABLE;
}

function byteSourceFromInt8Array(data: Int8Array): ByteSource {
    return new Uint8ArrayByteSource(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function decodeArchiveDataFromSource(
    index: CacheIndex,
    id: number,
    source: ByteSource,
    key: number[] | null,
): Archive {
    const archiveRef = index.getArchiveReference(id);
    if (!archiveRef) {
        throw new Error("Archive reference not found for: " + id);
    }
    const container = Container.decodeFromSource(source, key, index.compressionHandler);
    return Archive.decodeFromSource(
        id,
        archiveRef.lastFileId,
        archiveRef.fileCount,
        archiveRef.fileIds,
        archiveRef.fileNameHashes,
        byteSourceFromInt8Array(container.data),
    );
}

export class CacheIndexDat2 extends CacheStoreIndex {
    static fromStore(id: number, store: CacheStore, compressionHandler: CompressionHandler): CacheIndexDat2 {
        const data = store.read(CacheIndex.META_INDEX_ID, id);
        const table = decodeTable(data, compressionHandler);
        return new CacheIndexDat2(id, table, store, compressionHandler);
    }

    override getArchiveKey(id: number, key: number[] | null): Archive {
        const source = this.store.openArchiveReader(this.id, id);
        return decodeArchiveDataFromSource(this, id, source, key);
    }
}

export class LegacyCacheIndex extends CacheIndex {
    constructor(
        readonly id: number,
        readonly archives: Archive[],
        compressionHandler: CompressionHandler,
        readonly archiveNameHashes: Map<number, number> = new Map(),
    ) {
        super(id, ReferenceTable.INVALID_TABLE, compressionHandler);
    }

    override getArchiveKey(archiveId: number, key: number[] | null): Archive {
        return this.archives[archiveId];
    }

    override getArchiveId(name: string): number {
        const value = this.archiveNameHashes.get(StringUtil.hashOld(name));
        return value ? value : -1;
    }

    override getFileKey(archiveId: number, fileId: number, key: number[] | null): ArchiveFile | null {
        const value = this.archives[archiveId];
        return value ? value.getFile(fileId) : null;
    }
}
