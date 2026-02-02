import { ByteBuffer } from "../../io/ByteBuffer";
import { CacheFiles } from "../CacheFiles";
import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "./CacheStore";
import { Sector } from "./Sector";
import { SectorCluster } from "./SectorCluster";
import { ByteSource } from "../../io/ByteSource";

export class MemoryStore implements CacheStore {
    static fromFiles(cacheFiles: CacheFiles, indicesToLoad: number[] = []): MemoryStore {
        const files = cacheFiles.files;

        const indexFiles: ArrayBuffer[] = [];
        const indicesSet = new Set(indicesToLoad);
        const entries = Array.from(files.entries());
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const name = entry[0];
            const data = entry[1];
            if (
                name !== CacheFiles.META_FILE_NAME &&
                name.startsWith(CacheFiles.INDEX_FILE_PREFIX)
            ) {
                const indexId = parseInt(name.slice(CacheFiles.INDEX_FILE_PREFIX.length));
                if (indicesSet.size === 0 || indicesSet.has(indexId)) {
                    indexFiles[indexId] = data;
                }
            }
        }

        const dataFile =
            files.get(CacheFiles.DAT2_FILE_NAME) || files.get(CacheFiles.DAT_FILE_NAME);
        if (!dataFile) {
            throw new Error("main_file_cache data file not found");
        }
        const metaFile = files.get(CacheFiles.META_FILE_NAME);
        return new MemoryStore(dataFile, indexFiles, metaFile ? metaFile : null);
    }

    constructor(
        readonly dataFile: ArrayBuffer,
        readonly indexFiles: (ArrayBuffer | null)[],
        readonly metaFile: ArrayBuffer | null,
    ) {}

    getIndexFileSize(indexId: number): number | null {
        const file = this.getIndexFile(indexId);
        return file ? file.byteLength : null;
    }

    getIndexFile(indexId: number): ArrayBuffer | null {
        if (indexId === CacheIndex.META_INDEX_ID) {
            return this.metaFile;
        }
        return this.indexFiles[indexId];
    }

    getSectorIndexId(indexId: number): number {
        if (this.metaFile) {
            return indexId;
        }
        return indexId + 1;
    }

    read(indexId: number, archiveId: number): Int8Array {
        const stream = this.openArchiveStream(indexId, archiveId);
        const data = new Int8Array(stream.size);
        let offset = 0;
        for (const chunk of stream.chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return data;
    }

    openArchiveStream(indexId: number, archiveId: number): { readonly size: number; readonly chunks: Iterable<Int8Array> } {
        if (indexId < 0) {
            throw new Error("Index id cannot be lower than 0");
        }
        const indexFile = this.getIndexFile(indexId);
        if (!indexFile) {
            throw new Error(`Index ${indexId} not found`);
        }

        const sectorIndexId = this.getSectorIndexId(indexId);

        const clusterPtr = archiveId * SectorCluster.SIZE;
        if (clusterPtr < 0 || clusterPtr + SectorCluster.SIZE > indexFile.byteLength) {
            throw new Error(
                `Invalid ptr: ${clusterPtr}, fileSize: ${indexFile.byteLength}, indexId: ${indexId}, archiveId: ${archiveId}`,
            );
        }

        const extended = archiveId > 65535;

        const sectorClusterBuf = new ByteBuffer(
            new Int8Array(indexFile, clusterPtr, SectorCluster.SIZE),
        );
        const sectorCluster = SectorCluster.decode(sectorClusterBuf);

        const chunks = this.iterateArchiveSectors(archiveId, sectorIndexId, extended, sectorCluster);
        return {
            size: sectorCluster.size,
            chunks,
        };
    }

    openArchiveReader(indexId: number, archiveId: number): ByteSource {
        const stream = this.openArchiveStream(indexId, archiveId);

        type Segment = {
            start: number;
            data: Int8Array;
        };

        const segments: Segment[] = [];
        let start = 0;
        for (const chunk of stream.chunks) {
            segments.push({ start, data: chunk });
            start += chunk.length;
        }

        const size = stream.size;
        if (start !== size) {
            throw new Error(`Archive size mismatch. expected: ${size}, got: ${start}`);
        }

        const segmentStarts = segments.map((s) => s.start);

        function findSegmentIndex(offset: number): number {
            let lo = 0;
            let hi = segments.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1;
                const segStart = segmentStarts[mid];
                const segEnd = segStart + segments[mid].data.length;
                if (offset < segStart) {
                    hi = mid - 1;
                } else if (offset >= segEnd) {
                    lo = mid + 1;
                } else {
                    return mid;
                }
            }
            throw new Error(`Invalid offset: ${offset}`);
        }

        return {
            size,
            readInto(offset: number, target: Uint8Array, targetOffset = 0, length = target.length - targetOffset): void {
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
                let outOff = targetOffset;
                let inOff = offset;
                let segIndex = findSegmentIndex(inOff);

                while (remaining > 0) {
                    const seg = segments[segIndex];
                    const segOff = inOff - seg.start;
                    const available = seg.data.length - segOff;
                    const take = Math.min(available, remaining);

                    target.set(
                        new Uint8Array(seg.data.buffer, seg.data.byteOffset + segOff, take),
                        outOff,
                    );

                    remaining -= take;
                    outOff += take;
                    inOff += take;
                    segIndex++;
                }
            },
        };
    }

    private *iterateArchiveSectors(
        archiveId: number,
        sectorIndexId: number,
        extended: boolean,
        sectorCluster: SectorCluster,
    ): Iterable<Int8Array> {
        let chunk = 0;
        let remaining = sectorCluster.size;
        let sectorPtr = sectorCluster.sector * Sector.SIZE;

        const sectorBuffer: ByteBuffer = ByteBuffer.createWithSize(0);
        const sector = new Sector();

        while (remaining > 0) {
            const headerSize = extended ? Sector.EXTENDED_HEADER_SIZE : Sector.HEADER_SIZE;
            const dataSize = extended ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;

            const actualDataSize = Math.min(dataSize, remaining);

            sectorBuffer._data = new Int8Array(
                this.dataFile,
                sectorPtr,
                headerSize + actualDataSize,
            );
            sectorBuffer.offset = 0;

            if (extended) {
                Sector.decodeExtended(sector, sectorBuffer, actualDataSize);
            } else {
                Sector.decode(sector, sectorBuffer, actualDataSize);
            }

            if (remaining > dataSize) {
                if (sector.indexId !== sectorIndexId) {
                    throw new Error(
                        `Sector index id mismatch. expected: ${sectorIndexId} got: ${sector.indexId}`,
                    );
                }

                if (sector.archiveId !== archiveId) {
                    throw new Error(
                        `Sector archive id mismatch. expected: ${archiveId} got: ${sector.archiveId}`,
                    );
                }

                if (sector.chunk !== chunk) {
                    throw new Error("Sector chunk mismatch");
                }

                chunk++;
                sectorPtr = sector.nextSector * Sector.SIZE;
            }

            remaining -= dataSize;
            yield sector.data;
        }
    }
}
