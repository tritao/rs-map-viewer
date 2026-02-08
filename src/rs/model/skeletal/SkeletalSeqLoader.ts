import { Result, err, ok } from "../../../util/Result";
import { DecodeError, notFoundError } from "../../errors/DecodeError";
import { BytesProvider } from "../../io/BytesProvider";
import { GroupBytesProviderFactory } from "../../io/GroupBytesProviderFactory";
import { SeqBaseLoader } from "../seq/SeqBaseLoader";
import { SkeletalSeq } from "./SkeletalSeq";

export interface SkeletalSeqLoader {
    tryLoad(id: number): Result<SkeletalSeq, DecodeError>;
    tryGet(id: number): SkeletalSeq | undefined;

    clearCache(): void;
}

export class ProviderSkeletalSeqLoader implements SkeletalSeqLoader {
    seqs: Map<number, SkeletalSeq> = new Map();
    private readonly errors: Map<number, DecodeError> = new Map();

    groupCache: Map<number, BytesProvider> = new Map();

    constructor(
        readonly animGroupProviderFactory: GroupBytesProviderFactory,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    tryLoad(id: number): Result<SkeletalSeq, DecodeError> {
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }
        const cached = this.seqs.get(id);
        if (cached) {
            return ok(cached);
        }

        const archiveId = id >> 16;
        const fileId = id & 0xffff;

        let group = this.groupCache.get(archiveId);
        if (!group) {
            group = this.animGroupProviderFactory.getGroup(archiveId);
            if (!group) {
                const e = notFoundError("SkeletalSeq", id);
                this.errors.set(id, e);
                return err(e);
            }
            this.groupCache.set(archiveId, group);
        }

        const bytes = group.getBytes(fileId);
        if (!bytes) {
            const e = notFoundError("SkeletalSeq", id);
            this.errors.set(id, e);
            return err(e);
        }

        const result = SkeletalSeq.tryLoadResult(this.baseLoader, id, bytes);
        if (!result.ok) {
            this.errors.set(id, result.error);
            return err(result.error);
        }
        this.seqs.set(id, result.value);
        return ok(result.value);
    }

    tryGet(id: number): SkeletalSeq | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
    }

    clearCache(): void {
        this.seqs.clear();
        this.groupCache.clear();
        this.errors.clear();
    }
}
