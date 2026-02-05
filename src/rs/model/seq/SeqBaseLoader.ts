import { CacheInfo } from "../../cache/CacheInfo";
import { CacheIndex } from "../../cache/CacheIndex";
import { BytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { Dat2SeqBase, SeqBase } from "./SeqBase";

export interface SeqBaseLoader {
    tryLoad(id: number): SeqBase | undefined;

    clearCache(): void;
}

export class Dat2SeqBaseLoader implements SeqBaseLoader {
    bases: Map<number, SeqBase> = new Map();
    errors: Set<number> = new Set();

    static create(cacheInfo: CacheInfo, index: CacheIndex): Dat2SeqBaseLoader {
        return new Dat2SeqBaseLoader(cacheInfo, new IndexFileBytesProvider(index, 0));
    }

    constructor(readonly cacheInfo: CacheInfo, readonly baseSource: BytesProvider) {}

    tryLoad(id: number): SeqBase | undefined {
        const cached = this.bases.get(id);
        if (cached) {
            return cached;
        }
        if (this.errors.has(id)) {
            return undefined;
        }

        const bytes = this.baseSource.getBytes(id);
        if (!bytes) {
            return undefined;
        }
        const base = Dat2SeqBase.tryLoad(this.cacheInfo, id, bytes);
        if (!base) {
            if (!this.errors.has(id)) {
                console.error("Failed decoding seq base", id);
                this.errors.add(id);
            }
            return undefined;
        }
        this.bases.set(id, base);
        this.errors.delete(id);
        return base;
    }

    clearCache(): void {
        this.bases.clear();
        this.errors.clear();
    }
}
