import { CacheInfo } from "../../cache/CacheInfo";
import { CacheIndex } from "../../cache/CacheIndex";
import { BytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { DecodeError, decodeFailedError, notFoundError } from "../../errors/DecodeError";
import { Dat2SeqBase, SeqBase } from "./SeqBase";
import { err, ok, Result } from "../../../util/Result";

export interface SeqBaseLoader {
    tryLoad(id: number): Result<SeqBase, DecodeError>;
    tryGet(id: number): SeqBase | undefined;

    clearCache(): void;
}

export class Dat2SeqBaseLoader implements SeqBaseLoader {
    bases: Map<number, SeqBase> = new Map();
    errors: Map<number, DecodeError> = new Map();

    static create(cacheInfo: CacheInfo, index: CacheIndex): Dat2SeqBaseLoader {
        return new Dat2SeqBaseLoader(cacheInfo, new IndexFileBytesProvider(index, 0));
    }

    constructor(readonly cacheInfo: CacheInfo, readonly baseSource: BytesProvider) {}

    tryLoad(id: number): Result<SeqBase, DecodeError> {
        const cached = this.bases.get(id);
        if (cached) {
            return ok(cached);
        }
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        const bytes = this.baseSource.getBytes(id);
        if (!bytes) {
            return err(notFoundError("SeqBase", id));
        }
        const base = Dat2SeqBase.tryLoad(this.cacheInfo, id, bytes);
        if (!base) {
            const e = decodeFailedError({
                typeName: "SeqBase",
                id,
                message: `SeqBase: failed decoding id=${id}`,
            });
            this.errors.set(id, e);
            return err(e);
        }
        this.bases.set(id, base);
        this.errors.delete(id);
        return ok(base);
    }

    tryGet(id: number): SeqBase | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
    }

    clearCache(): void {
        this.bases.clear();
        this.errors.clear();
    }
}
