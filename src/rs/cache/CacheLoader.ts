export class DownloadProgress {
    total: number;
    current: number;
    part: Uint8Array;

    constructor(total: number, current: number, part: Uint8Array) {
        this.total = total;
        this.current = current;
        this.part = part;
    }
}

export type ProgressListener = (progress: DownloadProgress) => void;

export type CachedFile = {
    name: string;
    data: ArrayBuffer;
};

export interface CacheLoader {
    fetchCachedFile(
        baseUrl: string,
        name: string,
        shared: boolean,
        incremental: boolean,
        cache: Cache,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CachedFile>;
}
