// import { Xtea } from "../util/Xtea";
import { CompressionHandler } from "../compression/CompressionHandler";
import { CompressionType } from "../compression/CompressionType";
import { Xtea } from "../crypto/Xtea";
import { ByteBuffer } from "../io/ByteBuffer";
import { ByteSource } from "../io/ByteSource";

export class Container {
    static decode(
        buffer: ByteBuffer,
        key: number[] | null,
        compressionHandler: CompressionHandler,
    ): Container {
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
                    decompressed = compressionHandler.decompressBzip2(data, actualSize);
                } else {
                    decompressed = compressionHandler.decompressGzip(data);
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

    static decodeFromSource(
        source: ByteSource,
        key: number[] | null,
        compressionHandler: CompressionHandler,
    ): Container {
        const header = new Uint8Array(5);
        source.readInto(0, header);

        const compression: CompressionType = header[0] as CompressionType;
        const size =
            ((header[1] << 24) | (header[2] << 16) | (header[3] << 8) | header[4]) | 0;

        const needsExtraSize = compression !== CompressionType.None || Xtea.isValidKey(key);
        const totalSize = 5 + size + (needsExtraSize ? 4 : 0);

        if (totalSize < 5 || totalSize > source.size) {
            throw new Error(`Truncated container. expected=${totalSize}, available=${source.size}`);
        }

        const data = new Int8Array(totalSize);
        source.readInto(0, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

        return Container.decode(new ByteBuffer(data), key, compressionHandler);
    }

    constructor(
        readonly compression: CompressionType,
        readonly data: Int8Array,
    ) {}
}
