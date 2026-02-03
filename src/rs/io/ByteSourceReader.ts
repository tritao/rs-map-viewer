import { ByteSource } from "./ByteSource";
import { ByteReader } from "./ByteReader";
import { readI32BE, readU24BE } from "./Endian";

export class ByteSourceReader implements ByteReader {
    private position: number = 0;

    private windowStart: number = 0;
    private windowEnd: number = 0;
    private window: Uint8Array;

    constructor(
        readonly source: ByteSource,
        windowSize: number = 4096,
    ) {
        this.window = new Uint8Array(windowSize);
    }

    tell(): number {
        return this.position;
    }

    seek(position: number): void {
        if (position < 0 || position > this.source.size) {
            throw new Error(`Seek out of bounds. position=${position}, size=${this.source.size}`);
        }
        this.position = position;
        this.windowStart = 0;
        this.windowEnd = 0;
    }

    skip(amount: number): void {
        this.seek(this.position + amount);
    }

    get remaining(): number {
        return this.source.size - this.position;
    }

    private ensure(amount: number): void {
        if (amount <= 0) {
            return;
        }

        if (this.position + amount > this.source.size) {
            throw new Error(`Read out of bounds. position=${this.position}, amount=${amount}, size=${this.source.size}`);
        }

        if (this.position >= this.windowStart && this.position + amount <= this.windowEnd) {
            return;
        }

        const toRead = Math.min(this.window.length, this.source.size - this.position);
        this.source.readInto(this.position, this.window, 0, toRead);
        this.windowStart = this.position;
        this.windowEnd = this.position + toRead;
    }

    peekByte(): number {
        this.ensure(1);
        const value = this.window[this.position - this.windowStart];
        return (value << 24) >> 24;
    }

    peekUnsignedByte(): number {
        return this.peekByte() & 0xff;
    }

    readByte(): number {
        const value = this.peekByte();
        this.position += 1;
        return value;
    }

    readUnsignedByte(): number {
        return this.readByte() & 0xff;
    }

    readShort(): number {
        const v = (this.readUnsignedByte() << 8) | this.readUnsignedByte();
        return (v << 16) >> 16;
    }

    readUnsignedShort(): number {
        return this.readShort() & 0xffff;
    }

    readMedium(): number {
        this.ensure(3);
        const off = this.position - this.windowStart;
        const value = readU24BE(this.window, off);
        this.position += 3;
        return value;
    }

    readInt(): number {
        this.ensure(4);
        const off = this.position - this.windowStart;
        const value = readI32BE(this.window, off);
        this.position += 4;
        return value;
    }

    readBigSmart(): number {
        if (this.peekByte() < 0) {
            return this.readInt() & 0x7fffffff;
        } else {
            const v = this.readUnsignedShort();
            if (v === 32767) {
                return -1;
            }
            return v;
        }
    }

    readBytes(amount: number): Uint8Array {
        const out = new Uint8Array(amount);
        this.source.readInto(this.position, out);
        this.position += amount;
        return out;
    }
}
