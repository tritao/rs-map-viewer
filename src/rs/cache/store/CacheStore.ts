import { ByteSource } from "../../io/ByteSource";

export interface CacheStore {
    read(indexId: number, archiveId: number): Int8Array;

    /**
     * Returns a view-based stream of sector payloads for an archive.
     *
     * - `size` is the total payload size in bytes (from the index cluster).
     * - `chunks` yields payload chunks in order; the last chunk may be shorter.
     *
     * Implementations may return chunks backed by internal buffers, so consumers should
     * process/copy each chunk before advancing the iterator.
     */
    openArchiveStream(indexId: number, archiveId: number): {
        readonly size: number;
        readonly chunks: Iterable<Int8Array>;
    };

    /**
     * Provides random-access reads over an archive's payload (as stored in the `.dat(2)` sector chain).
     *
     * This is the primitive needed for native/seekable stores (file IO, mmap, etc). Decoders can then
     * pull only the needed ranges (e.g. container headers + compressed payload) instead of materializing
     * the full archive upfront.
     */
    openArchiveReader(indexId: number, archiveId: number): ByteSource;
}
