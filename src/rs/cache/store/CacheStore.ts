import { ByteSource } from "../../io/ByteSource";

export interface CacheStore {
    /**
     * Returns the raw byte size of an index file (`main_file_cache.idx{indexId}`) if available.
     *
     * Used for Dat caches to derive archive counts without needing the full file contents in memory.
     */
    getIndexFileSize(indexId: number): number | null;

    read(indexId: number, archiveId: number): Int8Array;

    /**
     * Provides random-access reads over an archive's payload (as stored in the `.dat(2)` sector chain).
     *
     * This is the primitive needed for native/seekable stores (file IO, mmap, etc). Decoders can then
     * pull only the needed ranges (e.g. container headers + compressed payload) instead of materializing
     * the full archive upfront.
     */
    openArchiveReader(indexId: number, archiveId: number): ByteSource;
}
