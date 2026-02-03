import gzip from "gzip-js";

export class Gzip {
    static decompress(compressed: Uint8Array): Uint8Array {
        return new Uint8Array(gzip.unzip(compressed));
    }
}
