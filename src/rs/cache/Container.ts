// import { Xtea } from "../util/Xtea";
import { compressionHandler, CompressionHandler } from "../compression/CompressionHandler";
import { CompressionType } from "../compression/CompressionType";
import { Xtea } from "../crypto/Xtea";
import { ByteBuffer } from "../io/ByteBuffer";

export class Container {
    static decode(buffer: ByteBuffer, key: number[] | null): Container {
        if (buffer.remaining === 0) {
            throw new Error("Empty container");
        }
        const compression: CompressionType = buffer.readUnsignedByte();
        const size = buffer.readInt();
        if (Xtea.isValidKey(key)) {
            Xtea.decrypt(buffer, buffer.offset, buffer.offset + 4 + size, key);
        }
        switch (compression) {
            case CompressionType.None:
                return new Container(compression, buffer.readBytes(size));
            case CompressionType.Bzip2:
            case CompressionType.Gzip:
                const actualSize = buffer.readInt() & 0xffffffff;

                const data = buffer.readUnsignedBytes(size);

                let decompressed: Int8Array;

                if (compression === CompressionType.Bzip2) {
                    decompressed = compressionHandler!.decompressBzip2(data, actualSize);
                } else {
                    decompressed = compressionHandler!.decompressGzip(data);
                }

                if (decompressed.length !== actualSize) {
                    throw new Error(
                        "Container: Size mismatch. Compressed: " +
                            actualSize +
                            ", Decompressed: " +
                            decompressed.length +
                            ", Type: " +
                            CompressionType[compression],
                    );
                }
                return new Container(compression, decompressed);
            default:
                throw new Error("Container: Unsupported compression: " + compression);
        }
    }

    constructor(
        readonly compression: CompressionType,
        readonly data: Int8Array,
    ) {}
}
