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

    static create(cacheInfo: CacheInfo, index: CacheIndex): Dat2SeqBaseLoader {
        return new Dat2SeqBaseLoader(cacheInfo, new IndexFileBytesProvider(index, 0));
    }

    constructor(readonly cacheInfo: CacheInfo, readonly baseSource: BytesProvider) {}

    load(id: number): SeqBase | undefined {
        const cached = this.bases.get(id);
        if (cached) {
            return cached;
        }

        const bytes = this.baseSource.getBytes(id);
        if (!bytes) {
            return undefined;
        }
        const base = Dat2SeqBase.load(this.cacheInfo, id, bytes);
        this.bases.set(id, base);
        return base;
    }

    clearCache(): void {
        this.bases.clear();
    }
}
