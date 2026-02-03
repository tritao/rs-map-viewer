import { ByteBuffer } from "../../io/ByteBuffer";
import { ByteBufferReader } from "../../io/ByteBufferReader";
import { ByteReader } from "../../io/ByteReader";
import { StringUtil } from "../../util/StringUtil";
import { ArchiveReference } from "./ArchiveReference";

export class ReferenceTable {
    static readonly INVALID_TABLE: ReferenceTable = new ReferenceTable(
        -1,
        -1,
        false,
        false,
        0,
        -1,
        new Map(),
        new Int32Array(0),
        new Int32Array(0),
        [],
        new Int32Array(0),
        new Int32Array(0),
        new Int32Array(0),
        new Int32Array(0),
        [],
        [],
    );

    static fromArchiveCount(archiveCount: number): ReferenceTable {
        const archiveIds = new Int32Array(archiveCount);
        const archiveIdIndexMap: Map<number, number> = new Map();
        for (let i = 0; i < archiveCount; i++) {
            archiveIds[i] = i;
            archiveIdIndexMap.set(i, i);
        }
        const lastArchiveId = archiveCount - 1;

        const archiveNameHashes = new Int32Array(archiveCount);
        const archiveWhirlpools = new Array<Uint8Array>(archiveCount);

        const archiveFileCounts = new Int32Array(archiveCount).fill(-1);

        const archiveFileIds = new Array<Int32Array>(archiveCount);
        const archiveLastFileIds = new Int32Array(archiveCount);

        const archiveFileNameHashes = new Array<Int32Array>(archiveCount);

        return new ReferenceTable(
            -1,
            -1,
            false,
            false,
            archiveCount,
            lastArchiveId,
            archiveIdIndexMap,
            archiveIds,
            archiveNameHashes,
            archiveWhirlpools,
            new Int32Array(archiveCount),
            new Int32Array(archiveCount),
            archiveFileCounts,
            archiveLastFileIds,
            archiveFileIds,
            archiveFileNameHashes,
        );
    }

    static decode(buffer: ByteBuffer): ReferenceTable {
        return ReferenceTable.decodeFromReader(new ByteBufferReader(buffer));
    }

    static decodeFromReader(reader: ByteReader): ReferenceTable {
        const protocol = reader.readUnsignedByte();
        if (protocol < 5 || protocol > 7) {
            throw new Error("Invalid protocol: " + protocol);
        }
        const revision = protocol > 5 ? reader.readInt() : 0;
        const flag = reader.readUnsignedByte();
        const named = (flag & 0x1) !== 0;
        const usesWhirlpool = (flag & 0x2) !== 0;
        const archiveCount = protocol === 7 ? reader.readBigSmart() : reader.readUnsignedShort();

        let lastArchiveId = 0;
        const archiveIds = new Int32Array(archiveCount);
        const archiveIdIndexMap: Map<number, number> = new Map();
        if (protocol === 7) {
            for (let i = 0; i < archiveCount; i++) {
                lastArchiveId += reader.readBigSmart();
                archiveIds[i] = lastArchiveId;
                archiveIdIndexMap.set(lastArchiveId, i);
            }
        } else {
            for (let i = 0; i < archiveCount; i++) {
                lastArchiveId += reader.readUnsignedShort();
                archiveIds[i] = lastArchiveId;
                archiveIdIndexMap.set(lastArchiveId, i);
            }
        }

        const archiveNameHashes = new Int32Array(archiveCount);
        if (named) {
            for (let i = 0; i < archiveCount; i++) {
                archiveNameHashes[i] = reader.readInt();
            }
        }

        const archiveWhirlpools = new Array<Uint8Array>(archiveCount);
        if (usesWhirlpool) {
            for (let i = 0; i < archiveCount; i++) {
                archiveWhirlpools[i] = reader.readBytes(64);
            }
        }

        const archiveCrcs = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveCrcs[i] = reader.readInt();
        }

        const archiveRevisions = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveRevisions[i] = reader.readInt();
        }

        const archiveFileCounts = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveFileCounts[i] =
                protocol === 7 ? reader.readBigSmart() : reader.readUnsignedShort();
        }

        const archiveFileIds = new Array<Int32Array>(archiveCount);
        const archiveLastFileIds = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveFileIds[i] = new Int32Array(archiveFileCounts[i]);
        }
        for (let archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
            let lastFileId = 0;
            for (let fileIdx = 0; fileIdx < archiveFileCounts[archiveIdx]; fileIdx++) {
                lastFileId += protocol === 7 ? reader.readBigSmart() : reader.readUnsignedShort();
                archiveFileIds[archiveIdx][fileIdx] = lastFileId;
            }
            archiveLastFileIds[archiveIdx] = lastFileId;
        }

        const archiveFileNameHashes = new Array<Int32Array>(archiveCount);
        if (named) {
            for (let i = 0; i < archiveCount; i++) {
                archiveFileNameHashes[i] = new Int32Array(archiveFileCounts[i]);
            }
            for (let archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
                for (let fileIdx = 0; fileIdx < archiveFileCounts[archiveIdx]; fileIdx++) {
                    archiveFileNameHashes[archiveIdx][fileIdx] = reader.readInt();
                }
            }
        }

        return new ReferenceTable(
            protocol,
            revision,
            named,
            usesWhirlpool,
            archiveCount,
            lastArchiveId,
            archiveIdIndexMap,
            archiveIds,
            archiveNameHashes,
            archiveWhirlpools,
            archiveCrcs,
            archiveRevisions,
            archiveFileCounts,
            archiveLastFileIds,
            archiveFileIds,
            archiveFileNameHashes,
        );
    }

    constructor(
        readonly protocol: number,
        readonly revision: number,
        readonly named: boolean,
        readonly usesWhirlpool: boolean,
        readonly archiveCount: number,
        readonly lastArchiveId: number,
        private readonly _archiveIdIndexMap: Map<number, number>,
        readonly archiveIds: Int32Array,
        private readonly _archiveNameHashes: Int32Array,
        private readonly _archiveWhirlpools: Uint8Array[],
        private readonly _archiveCrcs: Int32Array,
        private readonly _archiveRevisions: Int32Array,
        private readonly _archiveFileCounts: Int32Array,
        private readonly _archiveLastFileIds: Int32Array,
        private readonly _archiveFileIds: Int32Array[],
        private readonly _archiveFileNameHashes: Int32Array[],
        private _archiveNameHashIdMap: Map<number, number> | null = null,
    ) {
    }

    getArchiveId(name: string): number | null {
        if (!this.named) {
            return null;
        }
        if (!this._archiveNameHashIdMap) {
            const map = new Map<number, number>();
            for (let i = 0; i < this.archiveIds.length; i++) {
                map.set(this._archiveNameHashes[i], this.archiveIds[i]);
            }
            this._archiveNameHashIdMap = map;
        }

        const value = this._archiveNameHashIdMap.get(StringUtil.hashDjb2(name));
        return value ?? null;
    }

    archiveExists(id: number): boolean {
        return this._archiveIdIndexMap.has(id);
    }

    private _archiveReferenceCache: Array<ArchiveReference | undefined> | null = null;

    getArchiveReference(id: number): ArchiveReference | null {
        const i = this._archiveIdIndexMap.get(id);
        if (i === undefined) {
            return null;
        }

        if (!this._archiveReferenceCache) {
            this._archiveReferenceCache = new Array<ArchiveReference | undefined>(this.archiveIds.length);
        }

        const cached = this._archiveReferenceCache[i];
        if (cached) {
            return cached;
        }

        const nameHash = this._archiveNameHashes[i];
        const whirlpool = this._archiveWhirlpools[i];
        const crc = this._archiveCrcs[i];
        const revision = this._archiveRevisions[i];
        const fileCount = this._archiveFileCounts[i];
        const lastFileId = this._archiveLastFileIds[i];
        const fileIds = this._archiveFileIds[i];
        const fileNameHashes = this._archiveFileNameHashes[i];
        const ref = new ArchiveReference(
            id,
            nameHash,
            whirlpool,
            crc,
            revision,
            fileCount,
            lastFileId,
            fileIds,
            fileNameHashes,
        );
        this._archiveReferenceCache[i] = ref;
        return ref;
    }

    get archiveReferences(): ArchiveReference[] {
        const refs = new Array<ArchiveReference>(this.archiveIds.length);
        for (let i = 0; i < this.archiveIds.length; i++) {
            const archiveId = this.archiveIds[i];
            const ref = this.getArchiveReference(archiveId);
            if (!ref) {
                throw new Error("Archive reference not found for: " + archiveId);
            }
            refs[i] = ref;
        }
        return refs;
    }
}
