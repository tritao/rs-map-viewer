export interface CompressionHandler {
    decompressGzip(compressed: Uint8Array): Uint8Array;
    decompressBzip2(compressed: Uint8Array, actualSize: number): Uint8Array;
}
