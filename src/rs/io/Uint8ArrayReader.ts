import { readI32BE, readU16BE, readU24BE } from "./Endian";
import { ByteReader } from "./ByteReader";

export class Uint8ArrayReader implements ByteReader {
    constructor(
        readonly data: Uint8Array,
        public offset: number = 0,
    ) {
        if (offset < 0 || offset > data.byteLength) {
            throw new Error(
                `Uint8ArrayReader: invalid initial offset=${offset} length=${data.byteLength}`,
            );
        }
    }

    get remaining(): number {
        return this.data.byteLength - this.offset;
    }

    tell(): number {
        return this.offset;
    }

    seek(offset: number): void {
        if (offset < 0 || offset > this.data.byteLength) {
            throw new Error(
                `Uint8ArrayReader: seek out of bounds offset=${offset} length=${this.data.byteLength}`,
            );
        }
        this.offset = offset;
    }

    skip(bytes: number): void {
        if (bytes < 0) {
            throw new Error("Uint8ArrayReader: invalid skip");
        }
        this.seek(this.offset + bytes);
    }

    peekByte(): number {
        if (this.remaining < 1) {
            throw new Error("Uint8ArrayReader: truncated i8");
        }
        const value = this.data[this.offset];
        return (value << 24) >> 24;
    }

    peekUnsignedByte(): number {
        return this.peekByte() & 0xff;
    }

    readByte(): number {
        const v = this.peekByte();
        this.offset += 1;
        return v;
    }

    readUnsignedByte(): number {
        if (this.remaining < 1) {
            throw new Error("Uint8ArrayReader: truncated u8");
        }
        return this.data[this.offset++];
    }

    readShort(): number {
        const v = (this.readUnsignedByte() << 8) | this.readUnsignedByte();
        return (v << 16) >> 16;
    }

    readUnsignedShort(): number {
        if (this.remaining < 2) {
            throw new Error("Uint8ArrayReader: truncated u16");
        }
        const v = readU16BE(this.data, this.offset);
        this.offset += 2;
        return v;
    }

    readMedium(): number {
        if (this.remaining < 3) {
            throw new Error("Uint8ArrayReader: truncated u24");
        }
        const v = readU24BE(this.data, this.offset);
        this.offset += 3;
        return v;
    }

    readInt(): number {
        if (this.remaining < 4) {
            throw new Error("Uint8ArrayReader: truncated i32");
        }
        const v = readI32BE(this.data, this.offset);
        this.offset += 4;
        return v;
    }

    readUnsignedInt(): number {
        // Keep semantics consistent with ByteSourceReader: u32BE (as JS number).
        const v = this.readInt();
        return v >>> 0;
    }

    readBigSmart(): number {
        if (this.peekByte() < 0) {
            return this.readInt() & 0x7fffffff;
        }
        const v = this.readUnsignedShort();
        if (v === 32767) {
            return -1;
        }
        return v;
    }

    readBytes(length: number): Uint8Array {
        if (length < 0) {
            throw new Error("Uint8ArrayReader: invalid length");
        }
        if (this.remaining < length) {
            throw new Error(
                `Uint8ArrayReader: truncated bytes length=${length} remaining=${this.remaining}`,
            );
        }
        const start = this.offset;
        const end = start + length;
        this.offset = end;
        return this.data.subarray(start, end);
    }

    readBytesInto(
        target: Uint8Array,
        targetOffset: number = 0,
        length: number = target.length - targetOffset,
    ): void {
        if (length < 0) {
            throw new Error("Uint8ArrayReader: invalid length");
        }
        if (this.remaining < length) {
            throw new Error(
                `Uint8ArrayReader: truncated bytes length=${length} remaining=${this.remaining}`,
            );
        }
        if (length === 0) {
            return;
        }
        target.set(this.data.subarray(this.offset, this.offset + length), targetOffset);
        this.offset += length;
    }
}
