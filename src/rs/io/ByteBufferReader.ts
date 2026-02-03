import { ByteBuffer } from "./ByteBuffer";
import { ByteReader } from "./ByteReader";

export class ByteBufferReader implements ByteReader {
    constructor(readonly buffer: ByteBuffer) {}

    tell(): number {
        return this.buffer.offset;
    }

    seek(position: number): void {
        if (position < 0 || position > this.buffer.length) {
            throw new Error(`Seek out of bounds. position=${position}, length=${this.buffer.length}`);
        }
        this.buffer.offset = position;
    }

    skip(amount: number): void {
        this.seek(this.tell() + amount);
    }

    get remaining(): number {
        return this.buffer.remaining;
    }

    peekByte(): number {
        return this.buffer.getByte(this.buffer.offset);
    }

    peekUnsignedByte(): number {
        return this.peekByte() & 0xff;
    }

    readByte(): number {
        return this.buffer.readByte();
    }

    readUnsignedByte(): number {
        return this.buffer.readUnsignedByte();
    }

    readShort(): number {
        return this.buffer.readShort();
    }

    readUnsignedShort(): number {
        return this.buffer.readUnsignedShort();
    }

    readMedium(): number {
        return this.buffer.readMedium();
    }

    readInt(): number {
        return this.buffer.readInt();
    }

    readUnsignedInt(): number {
        return this.buffer.readUnsignedInt();
    }

    readBigSmart(): number {
        return this.buffer.readBigSmart();
    }

    readBytes(amount: number): Uint8Array {
        return this.buffer.readUnsignedBytes(amount);
    }

    readBytesInto(
        target: Uint8Array,
        targetOffset: number = 0,
        length: number = target.length - targetOffset,
    ): void {
        if (length < 0) {
            throw new Error("Invalid length");
        }
        if (this.buffer.offset + length > this.buffer.length) {
            throw new Error("Buffer overflow");
        }
        if (length === 0) {
            return;
        }
        target.set(this.buffer._u8.subarray(this.buffer.offset, this.buffer.offset + length), targetOffset);
        this.buffer.offset += length;
    }
}
