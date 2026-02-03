import { CompressionHandler } from "../compression/CompressionHandler";
import { CacheIndex, CacheIndexDat, CacheIndexDat2 } from "./CacheIndex";
import { CacheType } from "./CacheType";
import { CacheStore } from "./store/CacheStore";

export class CacheSystem {
    static loadIndicesFromStore(
        cacheType: CacheType,
        store: CacheStore,
        indexIds: number[],
        compressionHandler: CompressionHandler,
    ): Array<CacheIndex | null> {
        const maxIndexId = indexIds.length ? Math.max(...indexIds) : -1;
        const indices: Array<CacheIndex | null> = new Array(maxIndexId + 1).fill(null);

        for (const id of indexIds) {
            if (cacheType === CacheType.Dat) {
                indices[id] = CacheIndexDat.fromStore(id, store, compressionHandler);
            } else {
                indices[id] = CacheIndexDat2.fromStore(id, store, compressionHandler);
            }
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
        readonly indices: (CacheIndex | null)[],
        readonly compressionHandler: CompressionHandler,
    ) {}

    indexExists(indexId: number): boolean {
        return !!this.indices[indexId];
    }

    getIndex(indexId: number): CacheIndex {
        const index = this.indices[indexId];
        if (!index) {
            throw new Error("Index not found: " + indexId);
        }
        return index;
    }
}
