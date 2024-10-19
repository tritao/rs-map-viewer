export type DownloadProgress = {
    total: number;
    current: number;
    part: Uint8Array;
};

export type ProgressListener = (progress: DownloadProgress) => void;

export type CachedFile = {
    name: string;
    data: ArrayBuffer;
};