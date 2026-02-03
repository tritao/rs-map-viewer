import gzip from "gzip-js";

export class Gzip {
    static decompress(compressed: Uint8Array): Int8Array {
        const decompressed = new Int8Array(gzip.unzip(compressed));
        return decompressed;
    }
}
