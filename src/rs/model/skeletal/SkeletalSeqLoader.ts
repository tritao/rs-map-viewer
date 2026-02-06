import { BytesProvider } from "../../io/BytesProvider";
import { GroupBytesProviderFactory } from "../../io/GroupBytesProviderFactory";
import { SeqBaseLoader } from "../seq/SeqBaseLoader";
import { SkeletalSeq } from "./SkeletalSeq";

export interface SkeletalSeqLoader {
    tryLoad(id: number): SkeletalSeq | undefined;

    clearCache(): void;
}

export class ProviderSkeletalSeqLoader implements SkeletalSeqLoader {
    seqs: Map<number, SkeletalSeq> = new Map();
    private readonly errors: Set<number> = new Set();

    groupCache: Map<number, BytesProvider> = new Map();

    constructor(
        readonly animGroupProviderFactory: GroupBytesProviderFactory,
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

        let group = this.groupCache.get(archiveId);
        if (!group) {
            group = this.animGroupProviderFactory.getGroup(archiveId);
            if (!group) {
                return undefined;
            }
            this.groupCache.set(archiveId, group);
        }

        const bytes = group.getBytes(fileId);
        if (!bytes) {
            return undefined;
        }

        const skeletalSeq = SkeletalSeq.tryLoad(this.baseLoader, id, bytes);
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
        this.groupCache.clear();
        this.errors.clear();
    }
}
