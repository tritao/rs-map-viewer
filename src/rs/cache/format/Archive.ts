import { CompressionHandler } from "../../compression/CompressionHandler";
import { ByteSource } from "../../io/ByteSource";
import { ByteSourceReader } from "../../io/ByteSourceReader";
import { getOrCopyBytes } from "../../io/ByteSourceUtil";
import { readU32LE } from "../../io/Endian";
import { Uint8ArrayReader } from "../../io/Uint8ArrayReader";
import { StringUtil } from "../../util/StringUtil";
import { ArchiveFile } from "./ArchiveFile";

type HashFunction = (str: string) => number;

export type ArchiveMeta = {
    id: number;
    lastFileId: number;
    fileCount: number;
    fileIds: Int32Array;
    fileNameHashes: Int32Array;
};

export class Archive {
    private static _looksLikeGzipWithTrailingU16(data: Uint8Array): boolean {
        // Heuristic for old `.dat` gzip entries that append a u16 after the gzip member:
        // the gzip trailer (CRC32+ISIZE) is located at `len-10`, but strict decoders read it at `len-8`,
        // causing ISIZE to look like `version<<24` (low 24 bits are zero).
        if (data.byteLength < 10) {
            return false;
        }
        if (data[0] !== 0x1f || data[1] !== 0x8b) {
            return false;
        }

        const len = data.byteLength;
        // Little-endian u32 from last 4 bytes.
        const isize = readU32LE(data, len - 4);

        return data[len - 2] === 0 && (isize & 0x00ff_ffff) === 0 && isize !== 0;
    }

    private static _decompressDatGzip(
        data: Uint8Array,
        compressionHandler: CompressionHandler,
    ): Uint8Array {
        const len = data.byteLength;
        const canTrim = len >= 2;
        const preferTrim = canTrim && Archive._looksLikeGzipWithTrailingU16(data);

        const preferred = preferTrim ? data.subarray(0, len - 2) : data;
        const fallback = !canTrim ? null : preferTrim ? data : data.subarray(0, len - 2);

        try {
            return compressionHandler.decompressGzip(preferred);
        } catch (e) {
            if (!fallback) {
                throw e;
            }
            return compressionHandler.decompressGzip(fallback);
        }
    }

    static create(id: number, data: Uint8Array): Archive {
        const fileCount = 1;
        const lastFileId = 0;

        const fileIds = new Int32Array(fileCount);
        fileIds[0] = lastFileId;

        const fileNameHashes = new Int32Array(fileCount);

        const file = new ArchiveFile(lastFileId, id, data);
        const filesById: Array<ArchiveFile | undefined> = Array.from(
            { length: lastFileId + 1 },
            () => undefined,
        );
        filesById[lastFileId] = file;

        return new Archive(
            StringUtil.hashOld,
            id,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            filesById,
            [file],
        );
    }

    static decodeOld(
        id: number,
        data: Uint8Array,
        multipleFiles: boolean,
        compressionHandler: CompressionHandler,
    ): Archive {
        let fileCount: number;
        let fileIds: Int32Array;
        let fileNameHashes: Int32Array;
        let lastFileId: number;

        const files: ArchiveFile[] = [];
        let filesById: Array<ArchiveFile | undefined>;

        if (multipleFiles) {
            const reader = new Uint8ArrayReader(data);
            const actualSize = reader.readMedium();
            const size = reader.readMedium();

            const isCompressed = actualSize !== size;

            let metaReader: Uint8ArrayReader;
            let dataReader: Uint8ArrayReader;

            if (isCompressed) {
                const compressed = reader.readBytes(size);
                const decompressed = compressionHandler.decompressBzip2(compressed, actualSize);
                metaReader = new Uint8ArrayReader(decompressed);
                dataReader = new Uint8ArrayReader(decompressed);
            } else {
                metaReader = reader;
                dataReader = new Uint8ArrayReader(data, reader.offset);
            }

            fileCount = metaReader.readUnsignedShort();
            lastFileId = fileCount - 1;
            filesById = Array.from({ length: lastFileId + 1 }, () => undefined);

            // After the file table (10 bytes per file).
            dataReader.seek(metaReader.offset + fileCount * 10);

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);

            for (let i = 0; i < fileCount; i++) {
                const nameHash = metaReader.readInt();
                const fileActualSize = metaReader.readMedium();
                const fileSize = metaReader.readMedium();

                let fileData: Uint8Array;
                if (isCompressed) {
                    fileData = dataReader.readBytes(fileSize);
                } else {
                    const compressed = dataReader.readBytes(fileSize);
                    fileData = compressionHandler.decompressBzip2(compressed, fileActualSize);
                }

                fileIds[i] = i;
                fileNameHashes[i] = nameHash;

                const file = new ArchiveFile(i, id, fileData);
                files[i] = file;
                filesById[i] = file;
            }
        } else {
            fileCount = 1;
            lastFileId = 0;
            filesById = Array.from({ length: lastFileId + 1 }, () => undefined);

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);

            const decompressed = Archive._decompressDatGzip(data, compressionHandler);
            const file = new ArchiveFile(0, id, decompressed);
            files[0] = file;
            filesById[0] = file;
        }

        return new Archive(
            StringUtil.hashOld,
            id,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            filesById,
            files,
        );
    }

    static decodeFromSource(meta: ArchiveMeta, source: ByteSource): Archive {
        const { id: archiveId, lastFileId, fileCount, fileIds, fileNameHashes } = meta;

        const filesById: Array<ArchiveFile | undefined> = Array.from(
            { length: lastFileId + 1 },
            () => undefined,
        );
        const files: ArchiveFile[] = [];

        if (fileCount === 1) {
            const data = getOrCopyBytes(source);

            const fileId = lastFileId;
            const file = new ArchiveFile(fileId, archiveId, data);
            files[0] = file;
            filesById[fileId] = file;
        } else {
            if (source.size < 1) {
                throw new Error("Empty archive");
            }

            const reader = new ByteSourceReader(source);
            reader.seek(source.size - 1);
            const chunks = reader.readUnsignedByte();

            const tableBytes = chunks * (fileCount * 4);
            const tableOffset = source.size - 1 - tableBytes;
            if (tableOffset < 0) {
                throw new Error("Invalid archive chunk table");
            }

            const tableReader = new ByteSourceReader(source.slice(tableOffset, tableBytes));
            const chunkSizes = new Int32Array(chunks * fileCount);
            const fileSizes = new Int32Array(fileCount);
            for (let chunk = 0; chunk < chunks; chunk++) {
                let lastChunkFileSize = 0;
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    const delta = tableReader.readInt();
                    lastChunkFileSize += delta;
                    chunkSizes[chunk * fileCount + fileIdx] = lastChunkFileSize;
                    fileSizes[fileIdx] += lastChunkFileSize;
                }
            }

            const fileOffsets = new Int32Array(fileCount);
            const fileData = Array.from(
                { length: fileCount },
                (_, fileIdx) => new Uint8Array(fileSizes[fileIdx]),
            );

            const payload = source.slice(0, tableOffset);
            let inputOffset = 0;
            for (let chunk = 0; chunk < chunks; chunk++) {
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    const chunkSize = chunkSizes[chunk * fileCount + fileIdx];
                    const dst = fileData[fileIdx];
                    const dstOff = fileOffsets[fileIdx];
                    payload.readInto(inputOffset, dst, dstOff, chunkSize);
                    fileOffsets[fileIdx] = dstOff + chunkSize;
                    inputOffset += chunkSize;
                }
            }

            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                const fileId = fileIds[fileIdx];
                const file = new ArchiveFile(fileId, archiveId, fileData[fileIdx]);
                files[fileIdx] = file;
                filesById[fileId] = file;
            }
        }

        return new Archive(
            StringUtil.hashDjb2,
            archiveId,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            filesById,
            files,
        );
    }

    private _fileNameHashIdMap: Map<number, number> | null = null;

    private constructor(
        private readonly _hashFunction: HashFunction,
        readonly id: number,
        readonly lastFileId: number,
        readonly fileCount: number,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
        private readonly _filesById: Array<ArchiveFile | undefined>,
        private readonly _files: ArchiveFile[],
    ) {}

    private _getFileNameHashIdMap(): Map<number, number> | null {
        if (this.fileNameHashes.length === 0) {
            return null;
        }
        if (this._fileNameHashIdMap) {
            return this._fileNameHashIdMap;
        }

        const map = new Map<number, number>();
        const count = Math.min(this.fileIds.length, this.fileNameHashes.length);
        for (let i = 0; i < count; i++) {
            map.set(this.fileNameHashes[i], this.fileIds[i]);
        }
        this._fileNameHashIdMap = map;
        return map;
    }

    getFile(id: number): ArchiveFile | null {
        const file = this._filesById[id];
        return file ?? null;
    }

    getFileId(name: string): number {
        const hash = this._hashFunction(name);
        const map = this._getFileNameHashIdMap();
        if (!map) {
            return -1;
        }
        const value = map.get(hash);
        return value ?? -1;
    }

    tryGetFileId(name: string): number | undefined {
        const id = this.getFileId(name);
        return id === -1 ? undefined : id;
    }

    getFileNamed(name: string): ArchiveFile | null {
        const id = this.getFileId(name);
        if (id === -1) {
            return null;
        }
        return this.getFile(id);
    }

    get files(): ArchiveFile[] {
        return this._files;
    }
}
