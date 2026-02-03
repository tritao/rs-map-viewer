// import { Xtea } from "../util/Xtea";
import { CompressionHandler } from "../../compression/CompressionHandler";
import { CompressionType } from "../../compression/CompressionType";
import { Xtea } from "../../crypto/Xtea";
import { ByteSource } from "../../io/ByteSource";
import { ByteSourceReader } from "../../io/ByteSourceReader";
import { readI32BE } from "../../io/Endian";

export class Container {
    static decodeFromSource(
        source: ByteSource,
        key: number[] | null,
        compressionHandler: CompressionHandler,
    ): Container {
        const reader = new ByteSourceReader(source);
        const compression: CompressionType = reader.readUnsignedByte() as CompressionType;
        const size = reader.readInt();

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
                Xtea.decryptInPlace(encrypted, 0, encryptedSize, key);

                return new Container(
                    compression,
                    encrypted.subarray(0, size),
                );
            }

            const end = 5 + size;
            if (end > source.size) {
                throw new Error(`Truncated container. expected>=${end}, available=${source.size}`);
            }

            const payload = source.slice(5, size);
            const view = payload.tryGetUint8ArrayView?.();
            if (view) {
                return new Container(compression, view);
            }

            const data = new Uint8Array(size);
            payload.readInto(0, data);
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
            Xtea.decryptInPlace(encrypted, 0, encryptedSize, key);

            actualSize = readI32BE(encrypted, 0) & 0xffffffff;
            compressed = encrypted.subarray(4, 4 + compressedSize);
        } else {
            reader.seek(5);
            actualSize = reader.readInt() & 0xffffffff;

            // compressed payload starts at 9
            compressed = new Uint8Array(compressedSize);
            source.slice(9, compressedSize).readInto(0, compressed);
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

    constructor(
        readonly compression: CompressionType,
        readonly data: Uint8Array,
    ) {}
}
