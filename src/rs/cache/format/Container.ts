// import { Xtea } from "../util/Xtea";
import { CompressionHandler } from "../../compression/CompressionHandler";
import { CompressionType } from "../../compression/CompressionType";
import { Xtea } from "../../crypto/Xtea";
import { ByteBuffer } from "../../io/ByteBuffer";
import { ByteSource } from "../../io/ByteSource";

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

        if (size < 0) {
            throw new Error("Invalid container size: " + size);
        }

        const hasKey = Xtea.isValidKey(key);

        if (compression === CompressionType.None) {
            if (hasKey) {
                const encryptedSize = 4 + size;
                const end = 5 + encryptedSize;
                if (end > source.size) {
                    throw new Error(`Truncated container. expected>=${end}, available=${source.size}`);
                }

                const encrypted = new Uint8Array(encryptedSize);
                source.readInto(5, encrypted);
                const buf = new ByteBuffer(new Int8Array(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength));
                Xtea.decrypt(buf, 0, encryptedSize, key);

                return new Container(
                    compression,
                    new Int8Array(encrypted.buffer, encrypted.byteOffset, size),
                );
            }

            const end = 5 + size;
            if (end > source.size) {
                throw new Error(`Truncated container. expected>=${end}, available=${source.size}`);
            }

            const data = new Int8Array(size);
            source.readInto(5, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            return new Container(compression, data);
        }

        if (compression !== CompressionType.Bzip2 && compression !== CompressionType.Gzip) {
            throw new Error("Container: Unsupported compression: " + compression);
        }

        const compressedSize = size;
        const expectedMinSize = 5 + 4 + compressedSize;
        if (expectedMinSize > source.size) {
            throw new Error(`Truncated container. expected>=${expectedMinSize}, available=${source.size}`);
        }

        let actualSize: number;
        let compressed: Uint8Array;

        if (hasKey) {
            const encryptedSize = 4 + compressedSize;
            const encrypted = new Uint8Array(encryptedSize);
            source.readInto(5, encrypted);
            const buf = new ByteBuffer(new Int8Array(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength));
            Xtea.decrypt(buf, 0, encryptedSize, key);

            actualSize = buf.getInt(0) & 0xffffffff;
            compressed = encrypted.subarray(4, 4 + compressedSize);
        } else {
            const actualSizeBytes = new Uint8Array(4);
            source.readInto(5, actualSizeBytes);
            actualSize =
                (((actualSizeBytes[0] << 24) |
                    (actualSizeBytes[1] << 16) |
                    (actualSizeBytes[2] << 8) |
                    actualSizeBytes[3]) as number) & 0xffffffff;

            compressed = new Uint8Array(compressedSize);
            source.readInto(9, compressed);
        }

        let decompressed: Int8Array;
        if (compression === CompressionType.Bzip2) {
            decompressed = compressionHandler.decompressBzip2(compressed, actualSize);
        } else {
            decompressed = compressionHandler.decompressGzip(compressed);
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
    }

    constructor(
        readonly compression: CompressionType,
        readonly data: Int8Array,
    ) {}
}
