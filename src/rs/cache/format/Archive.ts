import { CompressionHandler } from "../../compression/CompressionHandler";
import { ByteSource } from "../../io/ByteSource";
import { ByteSourceReader } from "../../io/ByteSourceReader";
import { readI32BE, readU16BE, readU24BE } from "../../io/Endian";
import { getOrCopyBytes } from "../../io/ByteSourceUtil";
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
    static create(id: number, data: Uint8Array): Archive {
        const fileCount = 1;
        const lastFileId = 0;

        const fileIds = new Int32Array(fileCount);
        fileIds[0] = lastFileId;

        const fileNameHashes = new Int32Array(fileCount);

        const file = new ArchiveFile(lastFileId, id, data);
        const filesById: Array<ArchiveFile | undefined> = new Array(lastFileId + 1);
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
        const readMediumBE = (buf: Uint8Array, off: number): number => readU24BE(buf, off);

        let fileCount: number;
        let fileIds: Int32Array;
        let fileNameHashes: Int32Array;
        let lastFileId: number;

        const files: ArchiveFile[] = [];
        let filesById: Array<ArchiveFile | undefined>;

        if (multipleFiles) {
            if (data.byteLength < 6) {
                throw new Error("Archive.decodeOld: truncated header");
            }

            const actualSize = readMediumBE(data, 0);
            const size = readMediumBE(data, 3);

            const isCompressed = actualSize !== size;

            let metaBytes: Uint8Array;
            let metaOffset: number;
            let dataOffset: number;

            if (isCompressed) {
                const start = 6;
                const end = start + size;
                if (end > data.byteLength) {
                    throw new Error("Archive.decodeOld: truncated compressed payload");
                }
                const compressed = data.subarray(start, end);
                const decompressed = compressionHandler.decompressBzip2(compressed, actualSize);
                metaBytes = decompressed;
                metaOffset = 0;
            } else {
                metaBytes = data;
                metaOffset = 6;
            }

            if (metaOffset + 2 > metaBytes.byteLength) {
                throw new Error("Archive.decodeOld: truncated fileCount");
            }
            fileCount = readU16BE(metaBytes, metaOffset);
            metaOffset += 2;
            lastFileId = fileCount - 1;
            filesById = new Array(lastFileId + 1);

            dataOffset = metaOffset + fileCount * 10;
            if (dataOffset < 0 || dataOffset > metaBytes.byteLength) {
                throw new Error("Archive.decodeOld: invalid data offset");
            }

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);

            for (let i = 0; i < fileCount; i++) {
                if (metaOffset + 10 > metaBytes.byteLength) {
                    throw new Error("Archive.decodeOld: truncated file entry");
                }
                const nameHash = readI32BE(metaBytes, metaOffset);
                metaOffset += 4;
                const fileActualSize = readMediumBE(metaBytes, metaOffset);
                metaOffset += 3;
                const fileSize = readMediumBE(metaBytes, metaOffset);
                metaOffset += 3;

                let fileData: Uint8Array;
                if (isCompressed) {
                    const end = dataOffset + fileSize;
                    if (end > metaBytes.byteLength) {
                        throw new Error("Archive.decodeOld: truncated file payload");
                    }
                    fileData = metaBytes.subarray(dataOffset, end);
                    dataOffset = end;
                } else {
                    const end = dataOffset + fileSize;
                    if (end > metaBytes.byteLength) {
                        throw new Error("Archive.decodeOld: truncated file payload");
                    }
                    const compressed = metaBytes.subarray(dataOffset, end);
                    dataOffset = end;
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
            filesById = new Array(lastFileId + 1);

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);

            const decompressed = compressionHandler.decompressGzip(data);
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

        const filesById: Array<ArchiveFile | undefined> = new Array(lastFileId + 1);
        const files: ArchiveFile[] = new Array(fileCount);

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

            const fileData = new Array<Uint8Array>(fileCount);
            const fileOffsets = new Int32Array(fileCount);
            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                fileData[fileIdx] = new Uint8Array(fileSizes[fileIdx]);
            }

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
    ) {
    }

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
