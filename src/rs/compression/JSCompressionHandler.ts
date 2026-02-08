import { Bzip2 } from "./Bzip2";
import { CompressionHandler } from "./CompressionHandler";
import { Gzip } from "./Gzip";

export class JSCompressionHandler implements CompressionHandler {
    decompressGzip(compressed: Uint8Array): Uint8Array {
        return Gzip.decompress(compressed);
    }

    decompressBzip2(compressed: Uint8Array, actualSize: number): Uint8Array {
        return Bzip2.decompress(compressed, actualSize);
    }
}
