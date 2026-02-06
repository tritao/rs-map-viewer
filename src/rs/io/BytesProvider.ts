import { CacheIndex } from "../cache/CacheIndex";
import { Archive } from "../cache/format/Archive";

export interface BytesProvider<K = number> {
    getBytes(id: K): Uint8Array | undefined;
}

export interface CountedBytesProvider extends BytesProvider<number> {
    getCount(): number;
}

export interface EnumeratingBytesProvider extends CountedBytesProvider {
    getIds(): Int32Array;
}

export class IndexArchiveFileBytesProvider implements CountedBytesProvider {
    private readonly archives: Map<number, Archive> = new Map();
    private readonly fileIdMask: number;
    private readonly count: number;

    constructor(
        readonly index: CacheIndex,
        readonly fileIdBits: number = 8,
    ) {
        const filesPerArchive = 1 << fileIdBits;
        this.fileIdMask = filesPerArchive - 1;

        const lastArchiveId = index.getLastArchiveId();
        this.count =
            lastArchiveId < 0 ? 0 : lastArchiveId * filesPerArchive + index.getFileCount(lastArchiveId);
    }

    getBytes(id: number): Uint8Array | undefined {
        const archiveId = id >> this.fileIdBits;
        const fileId = id & this.fileIdMask;

        let archive = this.archives.get(archiveId);
        if (!archive) {
            archive = this.index.tryGetArchive(archiveId);
            if (!archive) {
                return undefined;
            }
            this.archives.set(archiveId, archive);
        }

        return archive.getFile(fileId)?.data;
    }

    getCount(): number {
        return this.count;
    }

    clearCache(): void {
        this.archives.clear();
    }
}

export class IndexFileBytesProvider implements EnumeratingBytesProvider {
    constructor(
        readonly index: CacheIndex,
        readonly fileId: number,
    ) {}

    getBytes(archiveId: number): Uint8Array | undefined {
        return this.index.tryGetFile(archiveId, this.fileId)?.data;
    }

    getCount(): number {
        return Math.max(this.index.getLastArchiveId() + 1, 0);
    }

    getIds(): Int32Array {
        return this.index.getArchiveIds();
    }
}

export class IndexSmartFileBytesProvider implements EnumeratingBytesProvider {
    constructor(
        readonly index: CacheIndex,
        readonly key: number[] | null,
    ) {}

    getBytes(id: number): Uint8Array | undefined {
        return this.index.tryGetFileSmart(id, this.key)?.data;
    }

    getCount(): number {
        return Math.max(this.index.getLastArchiveId() + 1, 0);
    }

    getIds(): Int32Array {
        return this.index.getArchiveIds();
    }
}

export class ArchiveBytesProvider implements CountedBytesProvider {
    constructor(readonly archive: Archive) {}

    getBytes(fileId: number): Uint8Array | undefined {
        return this.archive.getFile(fileId)?.data;
    }

    getCount(): number {
        return this.archive.lastFileId + 1;
    }
}

export class EnumeratingArchiveBytesProvider implements EnumeratingBytesProvider {
    constructor(readonly archive: Archive) {}

    getBytes(fileId: number): Uint8Array | undefined {
        return this.archive.getFile(fileId)?.data;
    }

    getCount(): number {
        return this.archive.lastFileId + 1;
    }

    getIds(): Int32Array {
        return this.archive.fileIds;
    }
}
