import { CacheInfo } from "../../cache/CacheInfo";
import { CacheIndex } from "../../cache/CacheIndex";
import { BytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { Dat2SeqBase, SeqBase } from "./SeqBase";

export interface SeqBaseLoader {
    load(id: number): SeqBase | undefined;

    clearCache(): void;
}

export class Dat2SeqBaseLoader implements SeqBaseLoader {
    bases: Map<number, SeqBase> = new Map();
    errors: Set<number> = new Set();

    static create(cacheInfo: CacheInfo, index: CacheIndex): Dat2SeqBaseLoader {
        return new Dat2SeqBaseLoader(cacheInfo, new IndexFileBytesProvider(index, 0));
    }

    constructor(readonly cacheInfo: CacheInfo, readonly baseSource: BytesProvider) {}

    load(id: number): SeqBase | undefined {
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
        try {
            const base = Dat2SeqBase.load(this.cacheInfo, id, bytes);
            this.bases.set(id, base);
            this.errors.delete(id);
            return base;
        } catch (e) {
            console.error("Failed decoding seq base", id, e);
            this.errors.add(id);
            return undefined;
        }
    }

    clearCache(): void {
        this.bases.clear();
        this.errors.clear();
    }
}
