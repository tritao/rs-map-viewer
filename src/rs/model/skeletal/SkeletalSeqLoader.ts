import { Archive } from "../../cache/format/Archive";
import { ArchiveProvider } from "../../io/ArchiveProvider";
import { SeqBaseLoader } from "../seq/SeqBaseLoader";
import { SkeletalSeq } from "./SkeletalSeq";

export interface SkeletalSeqLoader {
    tryLoad(id: number): SkeletalSeq | undefined;

    clearCache(): void;
}

export class ArchiveSkeletalSeqLoader implements SkeletalSeqLoader {
    seqs: Map<number, SkeletalSeq> = new Map();
    private readonly errors: Set<number> = new Set();

    archiveCache: Map<number, Archive> = new Map();

    constructor(
        readonly animArchiveProvider: ArchiveProvider,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    tryLoad(id: number): SkeletalSeq | undefined {
        if (this.errors.has(id)) {
            return undefined;
        }
        const cached = this.seqs.get(id);
        if (cached) {
            return cached;
        }

        const archiveId = id >> 16;
        const fileId = id & 0xffff;

        let archive = this.archiveCache.get(archiveId);
        if (!archive) {
            archive = this.animArchiveProvider.getArchive(archiveId);
            if (!archive) {
                return undefined;
            }
            this.archiveCache.set(archiveId, archive);
        }

        const file = archive.getFile(fileId);
        if (!file) {
            return undefined;
        }

        const skeletalSeq = SkeletalSeq.tryLoad(this.baseLoader, id, file.data);
        if (!skeletalSeq) {
            if (!this.errors.has(id)) {
                console.error("Failed decoding skeletal seq", id);
                this.errors.add(id);
            }
            return undefined;
        }
        this.seqs.set(id, skeletalSeq);
        return skeletalSeq;
    }

    clearCache(): void {
        this.seqs.clear();
        this.archiveCache.clear();
        this.errors.clear();
    }
}
