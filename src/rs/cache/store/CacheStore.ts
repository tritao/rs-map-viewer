export interface CacheStore {
    read(indexId: number, archiveId: number): Int8Array;
}
