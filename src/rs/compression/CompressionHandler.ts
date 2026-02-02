export interface CompressionHandler {
    decompressGzip(compressed: Uint8Array): Int8Array;
    decompressBzip2(compressed: Uint8Array, actualSize: number): Int8Array;
}
