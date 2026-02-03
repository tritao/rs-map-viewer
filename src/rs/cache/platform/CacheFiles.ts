import { ByteSource } from "../../io/ByteSource";
import { ArrayBufferByteSource } from "../../io/ArrayBufferByteSource";
import { Uint8ArrayByteSource } from "../../io/Uint8ArrayByteSource";

export type CacheFileData =
    | ByteSource
    | ArrayBuffer
    | SharedArrayBuffer
    | Uint8Array
    | { buffer: ArrayBuffer | SharedArrayBuffer }
    | { view: Uint8Array };

export function asByteSource(data: CacheFileData): ByteSource {
    if (typeof data === "object" && data !== null) {
        const maybeSource = data as ByteSource;
        if (typeof maybeSource.readInto === "function" && typeof maybeSource.size === "number") {
            return maybeSource;
        }

        if ("buffer" in data) {
            const buf = (data as { buffer: ArrayBuffer | SharedArrayBuffer }).buffer;
            return new ArrayBufferByteSource(buf);
        }

        if ("view" in data) {
            const view = (data as { view: Uint8Array }).view;
            return new Uint8ArrayByteSource(view);
        }
    }

    if (data instanceof Uint8Array) {
        return new Uint8ArrayByteSource(data);
    }

    return new ArrayBufferByteSource(data as ArrayBuffer | SharedArrayBuffer);
}

export class CacheFiles {
    static readonly DAT_FILE_NAME: string = "main_file_cache.dat";
    static readonly DAT2_FILE_NAME: string = "main_file_cache.dat2";

    static readonly INDEX_FILE_PREFIX: string = "main_file_cache.idx";

    static readonly META_FILE_NAME: string = "main_file_cache.idx255";

    static readonly DAT_INDEX_COUNT: number = 5;

    constructor(readonly files: Map<string, CacheFileData>) {}
}
