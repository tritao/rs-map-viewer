import { Archive } from "../../cache/format/Archive";
import { ArchiveProvider } from "../../io/ArchiveProvider";
import { SeqBaseLoader } from "../seq/SeqBaseLoader";
import { SkeletalSeq } from "./SkeletalSeq";

export interface SkeletalSeqLoader {
    load(id: number): SkeletalSeq | undefined;

    clearCache(): void;
}

export class ArchiveSkeletalSeqLoader implements SkeletalSeqLoader {
    seqs: Map<number, SkeletalSeq> = new Map();

    archiveCache: Map<number, Archive> = new Map();

    constructor(
        readonly animArchiveProvider: ArchiveProvider,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    load(id: number): SkeletalSeq | undefined {
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
            return undefined;
        }
        this.seqs.set(id, skeletalSeq);
        return skeletalSeq;
    }

    clearCache(): void {
        this.seqs.clear();
        this.archiveCache.clear();
    }
}
