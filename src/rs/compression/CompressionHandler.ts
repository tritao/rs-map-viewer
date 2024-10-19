export interface CompressionHandler {
    decompressGzip(compressed: Uint8Array): Int8Array;
    decompressBzip2(compressed: Uint8Array, actualSize: number): Int8Array;
}

export function initCompressionHandler(handler: CompressionHandler): void {
    compressionHandler = handler;
}

export let compressionHandler : CompressionHandler | null = null;
