import { CompressionHandler } from "../compression/CompressionHandler";
import { XteaKey } from "../crypto/Xtea";
import { ByteSource } from "../io/ByteSource";
import { ByteSourceReader } from "../io/ByteSourceReader";
import { getOrCopyBytes, readAllBytes } from "../io/ByteSourceUtil";
import { Uint8ArrayByteSource } from "../io/Uint8ArrayByteSource";
import { StringUtil } from "../util/StringUtil";
import { DatIndexId } from "./IndexId";
import { Archive } from "./format/Archive";
import { ArchiveFile } from "./format/ArchiveFile";
import { Container } from "./format/Container";
import { ArchiveReference } from "./reference/ArchiveReference";
import { ReferenceTable } from "./reference/ReferenceTable";
import { CacheStore } from "./store/CacheStore";
import { IDX_ENTRY_SIZE } from "./store/DatLayout";

export abstract class CacheIndex {
    static readonly META_INDEX_ID: i32 = 255;

    constructor(
        readonly id: number,
        readonly compressionHandler: CompressionHandler,
    ) {}

    // Only store-backed indices (Dat/Dat2) expose raw on-disk archive bytes.
    readonly store?: CacheStore;

    abstract getArchiveIds(): Int32Array;

    abstract getArchiveCount(): number;

    abstract getLastArchiveId(): number;

    abstract getArchiveReference(archiveId: number): ArchiveReference | null;

    abstract getArchiveId(name: string): number;

    tryGetArchiveId(name: string): number | undefined {
        const id = this.getArchiveId(name);
        return id === -1 ? undefined : id;
    }

    getFileIds(archiveId: number): Int32Array | null {
        const ref = this.getArchiveReference(archiveId);
        return ref ? ref.fileIds : null;
    }

    abstract archiveExists(archiveId: number): boolean;

    abstract getFileCount(archiveId: number): number;

    abstract getArchiveKey(archiveId: number, key: XteaKey | null): Archive;

    tryGetArchiveKey(archiveId: number, key: XteaKey | null): Archive | undefined {
        try {
            return this.getArchiveKey(archiveId, key);
        } catch {
            return undefined;
        }
    }

    /**
     * Reads the raw on-disk bytes for this archive (container/packed format as stored in the cache).
     *
     * Note: only available for store-backed indices (Dat/Dat2). Legacy/Classic indices are decoded
     * up-front and do not retain raw archive bytes.
     */
    readArchiveBytes(archiveId: number): Uint8Array {
        const store = this.store;
        if (!store) {
            throw new Error("readArchiveBytes() unsupported (no store)");
        }
        let rawSource: ByteSource;
        try {
            rawSource = store.openArchiveReader(this.id, archiveId);
        } catch {
            return new Uint8Array(0);
        }
        if (rawSource.size === 0) {
            return new Uint8Array(0);
        }
        try {
            return readAllBytes(rawSource);
        } catch {
            return new Uint8Array(0);
        }
    }

    /**
     * Dat2-only: decodes the container and returns the payload bytes (archive format bytes).
     */
    readContainerPayload(_archiveId: number, _key: XteaKey | null): Uint8Array {
        throw new Error("readContainerPayload() unsupported");
    }

    tryReadContainerPayload(archiveId: number, key: XteaKey | null): Uint8Array | undefined {
        try {
            return this.readContainerPayload(archiveId, key);
        } catch {
            return undefined;
        }
    }

    getArchive(archiveId: number): Archive {
        return this.getArchiveKey(archiveId, null);
    }

    tryGetArchive(archiveId: number): Archive | undefined {
        return this.tryGetArchiveKey(archiveId, null);
    }

    getFileKey(archiveId: number, fileId: number, key: XteaKey | null): ArchiveFile | null {
        return this.getArchiveKey(archiveId, key).getFile(fileId);
    }

    getFileSmart(id: number, key: XteaKey | null): ArchiveFile | null {
        if (this.getArchiveCount() === 1) {
            return this.getFileKey(0, id, key);
        } else if (this.getFileCount(id) === 1) {
            return this.getFileKey(id, 0, key);
        }
        throw new Error("Invalid archive");
    }

    tryGetFileKey(archiveId: number, fileId: number, key: XteaKey | null): ArchiveFile | undefined {
        const archive = this.tryGetArchiveKey(archiveId, key);
        return archive?.getFile(fileId) ?? undefined;
    }

    tryGetFileSmart(id: number, key: XteaKey | null): ArchiveFile | undefined {
        if (this.getArchiveCount() === 1) {
            return this.tryGetFileKey(0, id, key);
        } else if (this.getFileCount(id) === 1) {
            return this.tryGetFileKey(id, 0, key);
        }
        return undefined;
    }

    getFile(archiveId: number, fileId: number): ArchiveFile | null {
        return this.getFileKey(archiveId, fileId, null);
    }

    tryGetFile(archiveId: number, fileId: number): ArchiveFile | undefined {
        return this.tryGetFileKey(archiveId, fileId, null);
    }
}

function byteSourceFromBytes(data: Uint8Array): ByteSource {
    return new Uint8ArrayByteSource(data);
}

function decodeTableFromSource(
    source: ByteSource,
    compressionHandler: CompressionHandler,
): ReferenceTable {
    if (source.size === 0) {
        return ReferenceTable.INVALID_TABLE;
    }
    const container = Container.decodeFromSource(source, null, compressionHandler);
    return ReferenceTable.decodeFromReader(
        new ByteSourceReader(byteSourceFromBytes(container.data)),
    );
}

function decodeArchiveDataFromSource(
    table: ReferenceTable,
    compressionHandler: CompressionHandler,
    archiveId: number,
    source: ByteSource,
    key: XteaKey | null,
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

    getArchiveKey(archiveId: number, _key: XteaKey | null): Archive {
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
        return new Dat2CacheIndex(id, table, store, compressionHandler);
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

    override getArchiveKey(archiveId: number, key: XteaKey | null): Archive {
        const source = this.store.openArchiveReader(this.id, archiveId);
        return decodeArchiveDataFromSource(
            this.table,
            this.compressionHandler,
            archiveId,
            source,
            key,
        );
    }

    override readContainerPayload(archiveId: number, key: XteaKey | null): Uint8Array {
        const raw = this.readArchiveBytes(archiveId);
        if (raw.byteLength === 0) {
            return new Uint8Array(0);
        }
        const container = Container.decodeFromSource(
            new Uint8ArrayByteSource(raw),
            key,
            this.compressionHandler,
        );
        return container.data;
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
        return (
            archiveId >= 0 &&
            archiveId < this.archives.length &&
            this.archives[archiveId] !== undefined
        );
    }

    getFileCount(archiveId: number): number {
        const archive = this.archives[archiveId];
        return archive ? archive.fileCount : 0;
    }

    override getArchiveKey(archiveId: number, key: XteaKey | null): Archive {
        return this.archives[archiveId];
    }

    override getFileKey(
        archiveId: number,
        fileId: number,
        key: XteaKey | null,
    ): ArchiveFile | null {
        const value = this.archives[archiveId];
        return value ? value.getFile(fileId) : null;
    }
}
