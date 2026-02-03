import { ByteSource } from "../../io/ByteSource";
import { ByteSourceSlice } from "../../io/ByteSourceSlice";
import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "./CacheStore";
import { Sector } from "./Sector";
import { SectorCluster } from "./SectorCluster";
import { readI32BE, readU16BE, readU24BE } from "../../io/Endian";

class SectorChainArchiveSource implements ByteSource {
    constructor(
        private readonly dataFile: ByteSource,
        private readonly sectorIds: number[],
        readonly size: number,
        private readonly headerSize: number,
        private readonly dataSize: number,
    ) {}

    slice(start: number, size: number): ByteSource {
        return new ByteSourceSlice(this, start, size);
    }

    tryGetUint8ArrayView(): Uint8Array | null {
        return null;
    }

    readInto(
        offset: number,
        target: Uint8Array,
        targetOffset: number = 0,
        length: number = target.length - targetOffset,
    ): void {
        if (length < 0) {
            throw new Error("Invalid length");
        }
        if (offset < 0 || offset + length > this.size) {
            throw new Error(`Read out of bounds. offset=${offset}, length=${length}, size=${this.size}`);
        }
        if (length === 0) {
            return;
        }

        let remaining = length;
        let inOff = offset;
        let outOff = targetOffset;

        while (remaining > 0) {
            const sectorIndex = (inOff / this.dataSize) | 0;
            const sectorOffset = inOff - sectorIndex * this.dataSize;
            const take = Math.min(this.dataSize - sectorOffset, remaining);

            const sectorId = this.sectorIds[sectorIndex];
            if (sectorId === undefined) {
                throw new Error(`Invalid sector index: ${sectorIndex}`);
            }

            const fileOffset = sectorId * Sector.SIZE + this.headerSize + sectorOffset;
            this.dataFile.readInto(fileOffset, target, outOff, take);

            remaining -= take;
            inOff += take;
            outOff += take;
        }
    }
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

        return new SectorChainArchiveSource(
            this.dataFile,
            sectorIds,
            size,
            headerSize,
            dataSize,
        );
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

        const size = readU24BE(buf, 0);
        const sector = readU24BE(buf, 3);
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
                readArchiveId = readI32BE(header, 0) >>> 0;
                readChunk = readU16BE(header, 4);
                nextSector = readU24BE(header, 6);
                readIndexId = header[9];
            } else {
                readArchiveId = readU16BE(header, 0);
                readChunk = readU16BE(header, 2);
                nextSector = readU24BE(header, 4);
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

    // Note: forward chunk iteration can be implemented on top of `openArchiveReader` if/when needed.
}
