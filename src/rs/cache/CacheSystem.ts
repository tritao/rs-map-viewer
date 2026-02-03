import { CompressionHandler } from "../compression/CompressionHandler";
import { CacheIndex, Dat2CacheIndex, DatCacheIndex } from "./CacheIndex";
import { CacheType } from "./CacheType";
import { CacheStore } from "./store/CacheStore";

export class CacheSystem {
    static loadIndicesFromStore(
        cacheType: CacheType,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): Map<number, CacheIndex> {
        const indices: Map<number, CacheIndex> = new Map();

        for (const id of indexIds) {
            const index =
                cacheType === CacheType.Dat
                    ? DatCacheIndex.fromStore(id, store, compressionHandler)
                    : Dat2CacheIndex.fromDat2Store(id, store, compressionHandler);
            indices.set(id, index);
        }

        return indices;
    }

    static fromStore(
        cacheType: CacheType.Dat | CacheType.Dat2,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): CacheSystem {
        const indices = CacheSystem.loadIndicesFromStore(cacheType, store, indexIds, compressionHandler);
        return new CacheSystem(indices, compressionHandler);
    }

    constructor(
        readonly indices: ReadonlyMap<number, CacheIndex>,
        readonly compressionHandler: CompressionHandler,
    ) {}

    indexExists(indexId: number): boolean {
        return this.indices.has(indexId);
    }

    getIndex(indexId: number): CacheIndex {
        const index = this.indices.get(indexId);
        if (!index) {
            throw new Error("Index not found: " + indexId);
        }
        return index;
    }
}
