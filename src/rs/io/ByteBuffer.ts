import { FloatUtil } from "../../util/FloatUtil";
import { readI32BE, readU24BE, readU32BE } from "./Endian";

export class ByteBuffer {
    _data: Int8Array;
    _u8: Uint8Array;

    offset: number = 0;

    constructor(data: ArrayBufferView) {
        this._data = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
        this._u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    static createWithSize(size: number): ByteBuffer {
        return new ByteBuffer(new Int8Array(size));
    }

    readByte(): number {
        if (this.offset > this._data.length - 1) {
            throw new Error("Buffer overflow");
        }
        return this._data[this.offset++];
    }

    readUnsignedByte(): number {
        return this.readByte() & 0xff;
    }

    readShort(): number {
        return (((this.readUnsignedByte() << 8) | this.readUnsignedByte()) << 16) >> 16;
    }

    readUnsignedShort(): number {
        return this.readShort() & 0xffff;
    }

    // cg2
    readSignedShort(): number {
        const v = this.readUnsignedShort();
        if (v > 32767) {
            return v - 0x10000;
        }
        return v;
    }

    readMedium(): number {
        if (this.offset > this._data.length - 3) {
            throw new Error("Buffer overflow");
        }
        const value = readU24BE(this._u8, this.offset);
        this.offset += 3;
        return value;
    }

    readUnsignedMedium(): number {
        return this.readMedium() & 0xffffff;
    }

    readInt(): number {
        if (this.offset > this._data.length - 4) {
            throw new Error("Buffer overflow");
        }
        const value = readI32BE(this._u8, this.offset);
        this.offset += 4;
        return value;
    }

    readUnsignedInt(): number {
        if (this.offset > this._data.length - 4) {
            throw new Error("Buffer overflow");
        }
        const value = readU32BE(this._u8, this.offset);
        this.offset += 4;
        return value;
    }

    readFloat(): number {
        return FloatUtil.intBitsToFloat(this.readInt());
    }

    readBigSmart(): number {
        if (this.getByte(this.offset) < 0) {
            return this.readInt() & 0x7fffffff;
        } else {
            const v = this.readUnsignedShort();
            if (v === 32767) {
                return -1;
            }
            return v;
        }
    }

    readUnsignedSmart(): number {
        if (this.getUnsignedByte(this.offset) < 128) {
            return this.readUnsignedByte();
        } else {
            return this.readUnsignedShort() - 0x8000;
        }
    }

    readUnsignedSmartMin1(): number {
        if (this.getUnsignedByte(this.offset) < 128) {
            return this.readUnsignedByte() - 1;
        } else {
            return this.readUnsignedShort() - 0x8001;
        }
    }

    readSmart2(): number {
        if (this.getByte(this.offset) >= 0) {
            return this.readUnsignedByte() - 64;
        } else {
            return this.readUnsignedShort() - 49152;
        }
    }

    readSmart3(): number {
        let i = 0;
        let delta = this.readUnsignedSmart();
        while (delta === 32767) {
            delta = this.readUnsignedSmart();
            i += 32767;
        }
        i += delta;
        return i;
    }

    readString(endValue: number = 0): string {
        let str = "";
        while (this.getByte(this.offset) !== endValue) {
            str += String.fromCharCode(this.readUnsignedByte());
        }
        this.readByte();
        return str;
    }

    readNullString(): string | null {
        if (this.getByte(this.offset) === 0) {
            this.offset++;
            return null;
        } else {
            return this.readString();
        }
    }

    readVerString(): string | null {
        if (this.readByte() !== 0) {
            return null;
        }
        return this.readString();
    }

    getByte(offset: number): number {
        return this._data[offset];
    }

    getUnsignedByte(offset: number): number {
        return this.getByte(offset) & 0xff;
    }

    getShort(offset: number): number {
        return (this.getUnsignedByte(offset) << 8) | this.getUnsignedByte(offset + 1);
    }

    getUnsignedShort(offset: number): number {
        return this.getShort(offset) & 0xffff;
    }

    getInt(offset: number): number {
        return readI32BE(this._u8, offset);
    }

    readBytes(amount: number): Int8Array {
        const bytes = this._data.subarray(this.offset, this.offset + amount);
        this.offset += amount;
        return bytes;
    }

    readUnsignedBytes(amount: number): Uint8Array {
        const bytes = this._u8.subarray(this.offset, this.offset + amount);
        this.offset += amount;
        return bytes;
    }

    writeBytes(bytes: Uint8Array | Int8Array): void {
        this._data.set(bytes, this.offset);
        this.offset += bytes.length;
    }

    writeInt(v: number): void {
        this._data[this.offset++] = v >> 24;
        this._data[this.offset++] = v >> 16;
        this._data[this.offset++] = v >> 8;
        this._data[this.offset++] = v;
    }

    setInt(offset: number, v: number): void {
        this._data[offset++] = v >> 24;
        this._data[offset++] = v >> 16;
        this._data[offset++] = v >> 8;
        this._data[offset++] = v;
    }

    get length(): number {
        return this._data.length;
    }

    get remaining(): number {
        return this.length - this.offset;
    }

    get data(): Int8Array {
        return this._data;
    }
}
