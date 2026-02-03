import { CompressionHandler } from "../../compression/CompressionHandler";
import { ByteBuffer } from "../../io/ByteBuffer";
import { ByteSource } from "../../io/ByteSource";
import { ByteSourceReader } from "../../io/ByteSourceReader";
import { StringUtil } from "../../util/StringUtil";
import { ArchiveFile } from "./ArchiveFile";

type HashFunction = (str: string) => number;

export class Archive {
    static create(id: number, data: Int8Array): Archive {
        const fileCount = 1;
        const lastFileId = fileCount - 1;

        const fileIds = new Int32Array(fileCount);
        const fileNameHashes = new Int32Array(fileCount);

        const files = new Map<number, ArchiveFile>();
        files.set(lastFileId, new ArchiveFile(lastFileId, id, data));

        return new Archive(
            StringUtil.hashOld,
            id,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            files,
        );
    }

    static decodeOld(
        id: number,
        data: Int8Array,
        multipleFiles: boolean,
        compressionHandler: CompressionHandler,
    ): Archive {
        const buffer = new ByteBuffer(data);
        const files = new Map<number, ArchiveFile>();

        let fileCount: number;
        let fileIds: Int32Array;
        let fileNameHashes: Int32Array;
        if (multipleFiles) {
            const actualSize = buffer.readMedium();
            const size = buffer.readMedium();

            const isCompressed = actualSize !== size;

            let dataBuffer: ByteBuffer;
            let metaBuffer: ByteBuffer;
                if (isCompressed) {
                    const data = buffer.readUnsignedBytes(size);
                    const decompressed = compressionHandler.decompressBzip2(data, actualSize);
                    dataBuffer = new ByteBuffer(decompressed);
                    metaBuffer = new ByteBuffer(decompressed);
                } else {
                    dataBuffer = new ByteBuffer(data);
                    metaBuffer = buffer;
                }

            fileCount = metaBuffer.readUnsignedShort();
            dataBuffer.offset = metaBuffer.offset + fileCount * 10;

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);
            for (let i = 0; i < fileCount; i++) {
                const nameHash = metaBuffer.readInt();
                const fileActualSize = metaBuffer.readMedium();
                const fileSize = metaBuffer.readMedium();

                let decompressedFile: Int8Array;
                if (isCompressed) {
                    decompressedFile = dataBuffer.readBytes(fileSize);
                } else {
                    const data = dataBuffer.readUnsignedBytes(fileSize);
                    decompressedFile = compressionHandler.decompressBzip2(data, fileActualSize);
                }
                files.set(i, new ArchiveFile(i, id, decompressedFile));
                fileIds[i] = i;
                fileNameHashes[i] = nameHash;
            }
        } else {
            const decompressed = compressionHandler.decompressGzip(
                buffer.readUnsignedBytes(buffer.remaining),
            );

            fileCount = 1;
            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);
            files.set(0, new ArchiveFile(0, id, decompressed));
        }

        const lastFileId = fileCount - 1;

        return new Archive(
            StringUtil.hashOld,
            id,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            files,
        );
    }

    static decodeFromSource(
        id: number,
        lastFileId: number,
        fileCount: number,
        fileIds: Int32Array,
        fileNameHashes: Int32Array,
        source: ByteSource,
    ): Archive {
        const files = new Map<number, ArchiveFile>();
        if (fileCount === 1) {
            const view = source.tryGetUint8ArrayView?.();
            if (view) {
                files.set(
                    lastFileId,
                    new ArchiveFile(lastFileId, id, new Int8Array(view.buffer, view.byteOffset, view.byteLength)),
                );
            } else {
                const data = new Int8Array(source.size);
                source.readInto(0, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
                files.set(lastFileId, new ArchiveFile(lastFileId, id, data));
            }
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
                let lastFileSize = 0;
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    const delta = tableReader.readInt();
                    lastFileSize += delta;
                    chunkSizes[chunk * fileCount + fileIdx] = lastFileSize;
                    fileSizes[fileIdx] += lastFileSize;
                }
            }

            const fileData = new Array<Int8Array>(fileCount);
            const fileOffsets = new Int32Array(fileCount);
            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                fileData[fileIdx] = new Int8Array(fileSizes[fileIdx]);
            }

            const payload = source.slice(0, tableOffset);
            let inputOffset = 0;
            for (let chunk = 0; chunk < chunks; chunk++) {
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    const chunkSize = chunkSizes[chunk * fileCount + fileIdx];
                    const dst = fileData[fileIdx];
                    const dstOff = fileOffsets[fileIdx];
                    payload.readInto(
                        inputOffset,
                        new Uint8Array(dst.buffer, dst.byteOffset + dstOff, chunkSize),
                    );
                    fileOffsets[fileIdx] = dstOff + chunkSize;
                    inputOffset += chunkSize;
                }
            }

            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                const fileId = fileIds[fileIdx];
            files.set(fileId, new ArchiveFile(fileId, id, fileData[fileIdx]));
        }
    }

    return new Archive(
        StringUtil.hashDjb2,
        id,
        lastFileId,
        fileCount,
        fileIds,
        fileNameHashes,
        files,
    );
}

    constructor(
        private readonly _hashFunction: HashFunction,
        readonly id: number,
        readonly lastFileId: number,
        readonly fileCount: number,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
        private readonly _files: Map<number, ArchiveFile>,
        private readonly _fileNameHashIdMap: Map<number, number> = new Map(),
    ) {
        if (fileNameHashes) {
            for (let i = 0; i < this.fileIds.length; i++) {
                this._fileNameHashIdMap.set(this.fileNameHashes[i], this.fileIds[i]);
            }
        }
    }

    getFile(id: number): ArchiveFile | null {
        const value = this._files.get(id);
        return value ? value : null;
    }

    getFileId(name: string): number {
        const hash = this._hashFunction(name);
        const value = this._fileNameHashIdMap.get(hash);
        return value ? value : -1;
    }

    getFileNamed(name: string): ArchiveFile | null {
        const id = this.getFileId(name);
        if (id === -1) {
            return null;
        }
        return this.getFile(id);
    }

    get files(): ArchiveFile[] {
        return Array.from(this._files.values());
    }
}
