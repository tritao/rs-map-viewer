import { ByteSource } from "../../io/ByteSource";
import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "./CacheStore";
import { Sector } from "./Sector";
import { SectorCluster } from "./SectorCluster";

function readU16(buf: Uint8Array, off: number): number {
    return (buf[off] << 8) | buf[off + 1];
}

function readU24(buf: Uint8Array, off: number): number {
    return (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
}

function readI32(buf: Uint8Array, off: number): number {
    return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
}

export class SectorChainStore implements CacheStore {
    constructor(
        readonly dataFile: ByteSource,
        readonly indexFiles: (ByteSource | null)[],
        readonly metaFile: ByteSource | null,
    ) {}

    getIndexFileSize(indexId: number): number | null {
        const file = this.getIndexFile(indexId);
        return file ? file.size : null;
    }

    read(indexId: number, archiveId: number): Int8Array {
        const reader = this.openArchiveReader(indexId, archiveId);
        const out = new Int8Array(reader.size);
        reader.readInto(0, new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
        return out;
    }

    openArchiveStream(indexId: number, archiveId: number): { readonly size: number; readonly chunks: Iterable<Int8Array> } {
        const reader = this.openArchiveReader(indexId, archiveId);
        const dataSize = archiveId > 65535 ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;
        const chunks = this.iterateReaderChunks(reader, dataSize);
        return {
            size: reader.size,
            chunks,
        };
    }

    openArchiveReader(indexId: number, archiveId: number): ByteSource {
        if (indexId < 0) {
            throw new Error("Index id cannot be lower than 0");
        }

        const indexFile = this.getIndexFile(indexId);
        if (!indexFile) {
            throw new Error(`Index ${indexId} not found`);
        }

        const sectorIndexId = this.getSectorIndexId(indexId);
        const cluster = this.readSectorCluster(indexFile, indexId, archiveId);
        const size = cluster.size;
        const extended = archiveId > 65535;

        const headerSize = extended ? Sector.EXTENDED_HEADER_SIZE : Sector.HEADER_SIZE;
        const dataSize = extended ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;

        const sectorIds = this.walkSectorChain(
            sectorIndexId,
            archiveId,
            cluster.sector,
            size,
            extended,
        );

        return {
            size,
            readInto: (offset: number, target: Uint8Array, targetOffset = 0, length = target.length - targetOffset): void => {
                if (length < 0) {
                    throw new Error("Invalid length");
                }
                if (offset < 0 || offset + length > size) {
                    throw new Error(`Read out of bounds. offset=${offset}, length=${length}, size=${size}`);
                }
                if (length === 0) {
                    return;
                }

                let remaining = length;
                let inOff = offset;
                let outOff = targetOffset;

                while (remaining > 0) {
                    const sectorIndex = (inOff / dataSize) | 0;
                    const sectorOffset = inOff - sectorIndex * dataSize;
                    const take = Math.min(dataSize - sectorOffset, remaining);

                    const sectorId = sectorIds[sectorIndex];
                    if (sectorId === undefined) {
                        throw new Error(`Invalid sector index: ${sectorIndex}`);
                    }

                    const fileOffset = sectorId * Sector.SIZE + headerSize + sectorOffset;
                    this.dataFile.readInto(fileOffset, target, outOff, take);

                    remaining -= take;
                    inOff += take;
                    outOff += take;
                }
            },
        };
    }

    private getIndexFile(indexId: number): ByteSource | null {
        if (indexId === CacheIndex.META_INDEX_ID) {
            return this.metaFile;
        }
        return this.indexFiles[indexId] ?? null;
    }

    private getSectorIndexId(indexId: number): number {
        if (this.metaFile) {
            return indexId;
        }
        return indexId + 1;
    }

    private readSectorCluster(indexFile: ByteSource, indexId: number, archiveId: number): SectorCluster {
        const clusterPtr = archiveId * SectorCluster.SIZE;
        const fileSize = indexFile.size;
        if (clusterPtr < 0 || clusterPtr + SectorCluster.SIZE > fileSize) {
            throw new Error(
                `Invalid ptr: ${clusterPtr}, fileSize: ${fileSize}, indexId: ${indexId}, archiveId: ${archiveId}`,
            );
        }

        const buf = new Uint8Array(SectorCluster.SIZE);
        indexFile.readInto(clusterPtr, buf);

        const size = readU24(buf, 0);
        const sector = readU24(buf, 3);
        return new SectorCluster(size, sector);
    }

    private walkSectorChain(
        sectorIndexId: number,
        archiveId: number,
        firstSectorId: number,
        totalSize: number,
        extended: boolean,
    ): number[] {
        const headerSize = extended ? Sector.EXTENDED_HEADER_SIZE : Sector.HEADER_SIZE;
        const dataSize = extended ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;

        const header = new Uint8Array(headerSize);

        const sectorIds: number[] = [];
        let remaining = totalSize;
        let chunk = 0;
        let sectorId = firstSectorId;

        while (remaining > 0) {
            const sectorPtr = sectorId * Sector.SIZE;
            this.dataFile.readInto(sectorPtr, header);

            let readArchiveId: number;
            let readChunk: number;
            let nextSector: number;
            let readIndexId: number;

            if (extended) {
                readArchiveId = readI32(header, 0) >>> 0;
                readChunk = readU16(header, 4);
                nextSector = readU24(header, 6);
                readIndexId = header[9];
            } else {
                readArchiveId = readU16(header, 0);
                readChunk = readU16(header, 2);
                nextSector = readU24(header, 4);
                readIndexId = header[7];
            }

            if ((readArchiveId >>> 0) !== (archiveId >>> 0)) {
                throw new Error(`Sector archive id mismatch. expected: ${archiveId} got: ${readArchiveId}`);
            }
            if (readIndexId !== sectorIndexId) {
                throw new Error(`Sector index id mismatch. expected: ${sectorIndexId} got: ${readIndexId}`);
            }
            if (readChunk !== chunk) {
                throw new Error(`Sector chunk mismatch. expected: ${chunk} got: ${readChunk}`);
            }

            sectorIds.push(sectorId);

            chunk++;
            sectorId = nextSector;
            remaining -= dataSize;
        }

        return sectorIds;
    }

    private *iterateReaderChunks(reader: ByteSource, chunkSize: number): Iterable<Int8Array> {
        let offset = 0;
        while (offset < reader.size) {
            const len = Math.min(chunkSize, reader.size - offset);
            const chunk = new Int8Array(len);
            reader.readInto(offset, new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            offset += len;
            yield chunk;
        }
    }
}

