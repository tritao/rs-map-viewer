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

    read(archiveId: number): Uint8Array {
        return this.store.read(this.id, archiveId);
    }
}

function decodeTable(data: Uint8Array, compressionHandler: CompressionHandler): ReferenceTable {
    if (data.length) {
        const container = Container.decodeFromSource(byteSourceFromBytes(data), null, compressionHandler);
        return ReferenceTable.decodeFromReader(new ByteSourceReader(byteSourceFromBytes(container.data)));
    }
    return ReferenceTable.INVALID_TABLE;
}

function byteSourceFromBytes(data: Uint8Array): ByteSource {
    return new Uint8ArrayByteSource(data);
}

function decodeArchiveDataFromSource(
    table: ReferenceTable,
    compressionHandler: CompressionHandler,
    archiveId: number,
    source: ByteSource,
    key: number[] | null,
): Archive {
    const archiveRef = table.getArchiveReference(archiveId);
    if (!archiveRef) {
        throw new Error("Archive reference not found for: " + archiveId);
    }
    const container = Container.decodeFromSource(source, key, compressionHandler);
    return Archive.decodeFromSource(
        archiveId,
        archiveRef.lastFileId,
        archiveRef.fileCount,
        archiveRef.fileIds,
        archiveRef.fileNameHashes,
        byteSourceFromBytes(container.data),
    );
}

type ArchiveDecoder = (archiveId: number, key: number[] | null) => Archive;

export class CacheIndexStore extends CacheStoreIndex {
    private constructor(
        id: number,
        table: ReferenceTable,
        store: CacheStore,
        compressionHandler: CompressionHandler,
        private readonly decodeArchive: ArchiveDecoder,
    ) {
        super(id, table, store, compressionHandler);
    }

    static fromDatStore(
        id: number,
        store: CacheStore,
        compressionHandler: CompressionHandler,
    ): CacheIndexStore {
        const indexSize = store.getIndexFileSize(id);
        if (indexSize === null) {
            throw new Error("Index file not found: " + id);
        }
        const table = ReferenceTable.fromArchiveCount(indexSize / SectorCluster.SIZE);
        return new CacheIndexStore(
            id,
            table,
            store,
            compressionHandler,
            (archiveId: number): Archive => {
                const data = store.read(id, archiveId);
                return Archive.decodeOld(archiveId, data, id === DatIndexType.configs, compressionHandler);
            },
        );
    }

    static fromDat2Store(
        id: number,
        store: CacheStore,
        compressionHandler: CompressionHandler,
    ): CacheIndexStore {
        const metaTableBytes = store.read(CacheIndex.META_INDEX_ID, id);
        const table = decodeTable(metaTableBytes, compressionHandler);
        return new CacheIndexStore(
            id,
            table,
            store,
            compressionHandler,
            (archiveId: number, key: number[] | null): Archive => {
                const source = store.openArchiveReader(id, archiveId);
                return decodeArchiveDataFromSource(table, compressionHandler, archiveId, source, key);
            },
        );
    }

    override getArchiveKey(archiveId: number, key: number[] | null): Archive {
        return this.decodeArchive(archiveId, key);
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
