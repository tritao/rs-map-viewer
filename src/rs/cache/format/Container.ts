// import { Xtea } from "../util/Xtea";
import { CompressionHandler } from "../../compression/CompressionHandler";
import { CompressionType } from "../../compression/CompressionType";
import { Xtea, XteaKey } from "../../crypto/Xtea";
import { ByteReader } from "../../io/ByteReader";
import { ByteSource } from "../../io/ByteSource";
import { ByteSourceReader } from "../../io/ByteSourceReader";
import { Uint8ArrayReader } from "../../io/Uint8ArrayReader";
import { readU32BE } from "../../io/Endian";

export class Container {
    static decodeFromBytes(
        bytes: Uint8Array,
        key: XteaKey | null,
        compressionHandler: CompressionHandler,
    ): Container {
        return Container.decodeFromReader(new Uint8ArrayReader(bytes), key, compressionHandler);
    }

    static decodeFromReader(
        reader: ByteReader,
        key: XteaKey | null,
        compressionHandler: CompressionHandler,
    ): Container {
        const compression: CompressionType = reader.readUnsignedByte() as CompressionType;
        const size = reader.readInt();

        if (size < 0) {
            throw new Error("Invalid container size: " + size);
        }

        const hasKey = Xtea.isValidKey(key);

        if (compression === CompressionType.None) {
            if (hasKey) {
                const encryptedSize = 4 + size;

                const encrypted = new Uint8Array(encryptedSize);
                reader.readBytesInto(encrypted);
                Xtea.decryptInPlace(encrypted, 0, encryptedSize, key);

                return new Container(compression, encrypted.subarray(0, size));
            }

            if (reader.remaining < size) {
                throw new Error(
                    `Truncated container. expected>=${size}, available=${reader.remaining}`,
                );
            }

            return new Container(compression, reader.readBytes(size));
        }

        if (compression !== CompressionType.Bzip2 && compression !== CompressionType.Gzip) {
            throw new Error("Container: Unsupported compression: " + compression);
        }

        const compressedSize = size;
        const expectedMinPayload = 4 + compressedSize;
        if (expectedMinPayload > reader.remaining) {
            throw new Error(
                `Truncated container. expected>=${expectedMinPayload}, available=${reader.remaining}`,
            );
        }

        let actualSize: number;
        let compressed: Uint8Array;

        if (hasKey) {
            const encryptedSize = 4 + compressedSize;
            const encrypted = new Uint8Array(encryptedSize);
            reader.readBytesInto(encrypted);
            Xtea.decryptInPlace(encrypted, 0, encryptedSize, key);

            actualSize = readU32BE(encrypted, 0);
            compressed = encrypted.subarray(4, 4 + compressedSize);
        } else {
            actualSize = reader.readUnsignedInt();

            // compressed payload starts at 9
            compressed = reader.readBytes(compressedSize);
        }

        let decompressed: Uint8Array;
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

    static decodeFromSource(
        source: ByteSource,
        key: XteaKey | null,
        compressionHandler: CompressionHandler,
    ): Container {
        const view = source.tryGetUint8ArrayView();
        if (view) {
            return Container.decodeFromBytes(view, key, compressionHandler);
        }
        return Container.decodeFromReader(new ByteSourceReader(source), key, compressionHandler);
    }

    constructor(
        readonly compression: CompressionType,
        readonly data: Uint8Array,
    ) {}
}
