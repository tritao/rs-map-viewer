import { CompressionHandler } from "./CompressionHandler";
import { Gzip } from "./Gzip";
import { Bzip2 } from "./Bzip2";

export class JSCompressionHandler implements CompressionHandler {
    decompressGzip(compressed: Uint8Array): Int8Array {
        return Gzip.decompress(compressed)
    }

    decompressBzip2(compressed: Uint8Array, actualSize: number): Int8Array {
        return Bzip2.decompress(compressed, actualSize)
    }
}
