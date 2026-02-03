import { StringUtil } from "../util/StringUtil";
import { CompressionHandler } from "../compression/CompressionHandler";
import { Archive } from "./format/Archive";
import { ArchiveFile } from "./format/ArchiveFile";
import { Container } from "./format/Container";
import { DatIndexId } from "./IndexId";
import { ArchiveReference } from "./reference/ArchiveReference";
import { ReferenceTable } from "./reference/ReferenceTable";
import { CacheStore } from "./store/CacheStore";
import { IDX_ENTRY_SIZE } from "./store/DatLayout";
import { ByteSource } from "../io/ByteSource";
import { ByteSourceReader } from "../io/ByteSourceReader";
import { Uint8ArrayByteSource } from "../io/Uint8ArrayByteSource";
import { getOrCopyBytes, readAllBytes } from "../io/ByteSourceUtil";

export abstract class CacheIndex {
    static readonly META_INDEX_ID: i32 = 255;

    constructor(
        readonly id: number,
        readonly compressionHandler: CompressionHandler,
    ) {}

    abstract getArchiveIds(): Int32Array;

    abstract getArchiveCount(): number;

    abstract getLastArchiveId(): number;

    abstract getArchiveReference(archiveId: number): ArchiveReference | null;

    abstract getArchiveId(name: string): number;

    getFileIds(archiveId: number): Int32Array | null {
        const ref = this.getArchiveReference(archiveId);
        return ref ? ref.fileIds : null;
    }

    abstract archiveExists(archiveId: number): boolean;

    abstract getFileCount(archiveId: number): number;

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

function byteSourceFromBytes(data: Uint8Array): ByteSource {
    return new Uint8ArrayByteSource(data);
}

function decodeTableFromSource(source: ByteSource, compressionHandler: CompressionHandler): ReferenceTable {
    if (source.size === 0) {
        return ReferenceTable.INVALID_TABLE;
    }
    const container = Container.decodeFromSource(source, null, compressionHandler);
    return ReferenceTable.decodeFromReader(new ByteSourceReader(byteSourceFromBytes(container.data)));
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
    return Archive.decodeFromSource(archiveRef, byteSourceFromBytes(container.data));
}

export class DatCacheIndex extends CacheIndex {
    private _archiveIds: Int32Array | null = null;

    private constructor(
        id: number,
        private readonly _archiveCount: number,
        readonly store: CacheStore,
        compressionHandler: CompressionHandler,
    ) {
        super(id, compressionHandler);
    }

    static fromStore(
        id: number,
        store: CacheStore,
        compressionHandler: CompressionHandler,
    ): DatCacheIndex {
        const indexSize = store.getIndexFileSize(id);
        if (indexSize === null) {
            throw new Error("Index file not found: " + id);
        }
        if (indexSize % IDX_ENTRY_SIZE !== 0) {
            throw new Error(`Invalid .idx size: ${indexSize} (not divisible by ${IDX_ENTRY_SIZE})`);
        }
        const archiveCount = indexSize / IDX_ENTRY_SIZE;
        return new DatCacheIndex(id, archiveCount, store, compressionHandler);
    }

    getArchiveIds(): Int32Array {
        if (this._archiveIds) {
            return this._archiveIds;
        }
        const archiveIds = new Int32Array(this._archiveCount);
        for (let i = 0; i < this._archiveCount; i++) {
            archiveIds[i] = i;
        }
        this._archiveIds = archiveIds;
        return archiveIds;
    }

    getArchiveCount(): number {
        return this._archiveCount;
    }

    getLastArchiveId(): number {
        return this._archiveCount - 1;
    }

    getArchiveReference(_archiveId: number): ArchiveReference | null {
        return null;
    }

    getArchiveId(_name: string): number {
        return -1;
    }

    archiveExists(archiveId: number): boolean {
        return archiveId >= 0 && archiveId < this._archiveCount;
    }

    getFileCount(_archiveId: number): number {
        return 0;
    }

    getArchiveKey(archiveId: number, _key: number[] | null): Archive {
        if (!this.archiveExists(archiveId)) {
            throw new Error("Archive not found: " + archiveId);
        }
        const data = getOrCopyBytes(this.store.openArchiveReader(this.id, archiveId));
        return Archive.decodeOld(
            archiveId,
            data,
            this.id === DatIndexId.configs,
            this.compressionHandler,
        );
    }
}

export class Dat2CacheIndex extends CacheIndex {
    private constructor(
        id: number,
        table: ReferenceTable,
        readonly store: CacheStore,
        compressionHandler: CompressionHandler,
    ) {
        super(id, compressionHandler);
        this.table = table;
    }

    readonly table: ReferenceTable;

    static fromDat2Store(
        id: number,
        store: CacheStore,
        compressionHandler: CompressionHandler,
    ): Dat2CacheIndex {
        const metaSource = store.openArchiveReader(CacheIndex.META_INDEX_ID, id);
        const table = decodeTableFromSource(metaSource, compressionHandler);
        return new Dat2CacheIndex(
            id,
            table,
            store,
            compressionHandler,
        );
    }

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
        return value ?? -1;
    }

    archiveExists(archiveId: number): boolean {
        return this.table.archiveExists(archiveId);
    }

    getFileCount(archiveId: number): number {
        const value = this.table.getArchiveReference(archiveId);
        return value ? value.fileCount : 0;
    }

    override getArchiveKey(archiveId: number, key: number[] | null): Archive {
        const source = this.store.openArchiveReader(this.id, archiveId);
        return decodeArchiveDataFromSource(this.table, this.compressionHandler, archiveId, source, key);
    }
}

export class LegacyCacheIndex extends CacheIndex {
    private _archiveIds: Int32Array | null = null;

    constructor(
        readonly id: number,
        readonly archives: Archive[],
        compressionHandler: CompressionHandler,
        readonly archiveNameHashes: Map<number, number> = new Map(),
    ) {
        super(id, compressionHandler);
    }

    getArchiveIds(): Int32Array {
        if (this._archiveIds) {
            return this._archiveIds;
        }
        const archiveIds = new Int32Array(this.archives.length);
        for (let i = 0; i < this.archives.length; i++) {
            archiveIds[i] = i;
        }
        this._archiveIds = archiveIds;
        return archiveIds;
    }

    getArchiveCount(): number {
        return this.archives.length;
    }

    getLastArchiveId(): number {
        return this.archives.length - 1;
    }

    getArchiveReference(_archiveId: number): ArchiveReference | null {
        return null;
    }

    override getArchiveId(name: string): number {
        const value = this.archiveNameHashes.get(StringUtil.hashOld(name));
        return value ?? -1;
    }

    archiveExists(archiveId: number): boolean {
        return archiveId >= 0 && archiveId < this.archives.length && this.archives[archiveId] !== undefined;
    }

    getFileCount(archiveId: number): number {
        const archive = this.archives[archiveId];
        return archive ? archive.fileCount : 0;
    }

    override getArchiveKey(archiveId: number, key: number[] | null): Archive {
        return this.archives[archiveId];
    }

    override getFileKey(archiveId: number, fileId: number, key: number[] | null): ArchiveFile | null {
        const value = this.archives[archiveId];
        return value ? value.getFile(fileId) : null;
    }
}
