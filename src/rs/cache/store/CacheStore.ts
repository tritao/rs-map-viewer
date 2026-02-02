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
}
