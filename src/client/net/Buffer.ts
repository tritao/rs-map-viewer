import { CacheableNode } from "../collection/CacheableNode";
import { LinkedList } from "../util/LinkedList";
import { ISAACCipher } from "./ISAACCipher";
import Long from "long";
import { modPow } from 'bigint-mod-arith'

function createCRC32Table(): number[] {
    let pos: number = 0;
    let table = Array(256);
    while (pos < 256) {
        {
            let value: number = pos;
            for (let pass: number = 0; pass < 8; pass++) {
                if ((value & 1) === 1) {
                    value = (value >>> 1) ^ -306674912;
                } else {
                    value >>>= 1;
                }
            }
            table[pos] = value;
            pos++;
        }
    }
    return table;
}

export class Buffer extends CacheableNode {
    public static __static_initialized: boolean = false;

    public static CRC32_TABLE: number[] = createCRC32Table();
    public static BIT_MASKS: number[] = [
        0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383,
        32767, 65535, 0x1ffff, 0x3ffff, 0x7ffff, 0xfffff, 0x1fffff, 0x3fffff, 0x7fffff, 0xffffff, 0x1ffffff,
        0x3ffffff, 0x7ffffff, 0xfffffff, 0x1fffffff, 0x3fffffff, 0x7fffffff, -1
    ];

    public static smallBufferCount: number = 0;
    public static mediumBufferCount: number = 0;
    public static largeBufferCount: number = 0;
    public static smallBuffers: LinkedList = new LinkedList();
    public static mediumBuffers: LinkedList = new LinkedList();
    public static largeBuffers: LinkedList = new LinkedList();

    public static allocate(sizeMode: number): Buffer {
        {
            let buffer: Buffer | null = null;
            if (sizeMode === 0 && Buffer.smallBufferCount > 0) {
                Buffer.smallBufferCount--;
                buffer = Buffer.smallBuffers.removeFirst() as Buffer;
            } else if (sizeMode === 1 && Buffer.mediumBufferCount > 0) {
                Buffer.mediumBufferCount--;
                buffer = Buffer.mediumBuffers.removeFirst() as Buffer;
            } else if (sizeMode === 2 && Buffer.largeBufferCount > 0) {
                Buffer.largeBufferCount--;
                buffer = Buffer.largeBuffers.removeFirst() as Buffer;
            }
            if (buffer != null) {
                buffer.currentPosition = 0;
                return buffer;
            }
        }
        const buffer: Buffer = new Buffer();
        buffer.currentPosition = 0;
        if (sizeMode === 0) {
            buffer.buffer = new Int8Array(100);
        } else if (sizeMode === 1) {
            buffer.buffer = new Int8Array(5000);
        } else {
            buffer.buffer = new Int8Array(30000);
        }
        return buffer;
    }

    public buffer!: Int8Array;

    public currentPosition: number;

    public bitPosition: number;

    public random: ISAACCipher | null;

    public constructor(buffer?: any) {
        if (
            (buffer != null &&
                ((buffer instanceof Array) as any) &&
                (buffer.length == 0 || buffer[0] == null || typeof buffer[0] === "number")) ||
            buffer === null
        ) {
            super();
            this.currentPosition = 0;
            this.bitPosition = 0;
            this.random = null;
            this.currentPosition = 0;
            this.bitPosition = 0;
            this.buffer = buffer;
            this.currentPosition = 0;
        } else if (buffer === undefined) {
            super();
            this.currentPosition = 0;
            this.bitPosition = 0;
            this.random = null;
            this.currentPosition = 0;
            this.bitPosition = 0;
            this.random = null;
        } else {
            throw new Error("invalid overload");
        }
    }

    public putOpcode(opcode: number) {
        let random = this.random == null ? 0 : (this.random.nextInt() | 0);
        this.buffer[this.currentPosition++] = ((opcode + random) as number) | 0;
    }

    public putByte(value: number) {
        this.buffer[this.currentPosition++] = (value as number) | 0;
    }

    public putShortBE(value: number) {
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
        this.buffer[this.currentPosition++] = (value as number) | 0;
    }

    public putShortLECopy(value: number) {
        this.buffer[this.currentPosition++] = (value as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
    }

    public putMediumBE(value: number) {
        this.buffer[this.currentPosition++] = ((value >> 16) as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
        this.buffer[this.currentPosition++] = (value as number) | 0;
    }

    public putIntBE(value: number) {
        this.buffer[this.currentPosition++] = ((value >> 24) as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 16) as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
        this.buffer[this.currentPosition++] = (value as number) | 0;
    }

    public putIntLE(value: number) {
        this.buffer[this.currentPosition++] = (value as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 16) as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 24) as number) | 0;
    }

    public putLongBE(value: Long) {
        this.putIntBE(value.high);
        this.putIntBE(value.low);
    }

    public putString(str: string) {
        for (let c of str) {
            this.buffer[this.currentPosition++] = c.charCodeAt(0);
        }
        this.buffer[this.currentPosition++] = 10;
    }

    public putBytes(bytes: number[] | Int8Array, start: number, length: number) {
        for (let pos: number = start; pos < start + length; pos++) {
            this.buffer[this.currentPosition++] = bytes[pos];
        }
    }

    public putLength(length: number) {
        this.buffer[this.currentPosition - length - 1] = (length as number) | 0;
    }

    public getUnsignedByte(): number {
        return this.buffer[this.currentPosition++] & 0xff;
    }

    public getByte(): number {
        return this.buffer[this.currentPosition++];
    }

    public getUnsignedShortBE(): number {
        this.currentPosition += 2;
        return ((this.buffer[this.currentPosition - 2] & 0xff) << 8) + (this.buffer[this.currentPosition - 1] & 0xff);
    }

    public getShortBE(): number {
        this.currentPosition += 2;
        let i: number = ((this.buffer[this.currentPosition - 2] & 0xff) << 8) + (this.buffer[this.currentPosition - 1] & 0xff);
        if (i > 32767) {
            i -= 0x10000;
        }
        return i;
    }

    public getMediumBE(): number {
        this.currentPosition += 3;
        return (
            ((this.buffer[this.currentPosition - 3] & 0xff) << 16) +
            ((this.buffer[this.currentPosition - 2] & 0xff) << 8) +
            (this.buffer[this.currentPosition - 1] & 0xff)
        );
    }

    public getIntBE(): number {
        this.currentPosition += 4;
        return (
            ((this.buffer[this.currentPosition - 4] & 0xff) << 24) +
            ((this.buffer[this.currentPosition - 3] & 0xff) << 16) +
            ((this.buffer[this.currentPosition - 2] & 0xff) << 8) +
            (this.buffer[this.currentPosition - 1] & 0xff)
        ) | 0;
    }

    public getLongBE(): Long {
        const l: number = this.getIntBE() & 0xffffffff;
        const l1: number = this.getIntBE() & 0xffffffff;
        return new Long(l1, l);
    }

    public getString(): string {
        const start: number = this.currentPosition;
        while (this.buffer[this.currentPosition++] !== 10) { }
        return String.fromCharCode.apply(null, Array.from(this.buffer.slice(start, this.currentPosition)));
    }

    public getStringBytes(): number[] {
        const start: number = this.currentPosition;
        while (this.buffer[this.currentPosition++] !== 10) { }
        return Array.from(this.buffer.slice(start, this.currentPosition));
    }

    public getBytes(bytes: number[], start: number, len: number) {
        for (let pos: number = start; pos < start + len; pos++) {
            bytes[pos] = this.buffer[this.currentPosition++];
        }
    }

    public initBitAccess() {
        this.bitPosition = this.currentPosition * 8;
    }

    public getBits(numBits: number): number {
        let k: number = this.bitPosition >> 3;
        let l: number = 8 - (this.bitPosition & 7);
        let value: number = 0;
        this.bitPosition += numBits;
        for (; numBits > l; l = 8) {
            {
                value += (this.buffer[k++] & Buffer.BIT_MASKS[l]) << (numBits - l);
                numBits -= l;
            }
        }
        if (numBits === l) {
            value += this.buffer[k] & Buffer.BIT_MASKS[l];
        } else {
            value += (this.buffer[k] >> (l - numBits)) & Buffer.BIT_MASKS[numBits];
        }
        return value;
    }

    public finishBitAccess() {
        this.currentPosition = ((this.bitPosition + 7) / 8) | 0;
    }

    public getSignedSmart(): number {
        const peek: number = this.buffer[this.currentPosition] & 0xff;
        if (peek < 128) {
            return this.getUnsignedByte() - 64;
        } else {
            return this.getUnsignedShortBE() - 49152;
        }
    }

    public getSmart(): number {
        const peek: number = this.buffer[this.currentPosition] & 0xff;
        if (peek < 128) {
            return this.getUnsignedByte();
        } else {
            return this.getUnsignedShortBE() - 32768;
        }
    }

    public encrypt(modulus: string, key: string) {
        const length: number = this.currentPosition;
        this.currentPosition = 0;
        let bytes: number[] = Array(length).fill(0);
        this.getBytes(bytes, 0, length);
        const rawEnc = encryptBytesRSA(new Uint8Array(bytes), modulus, key);
        const encrypted = new Int8Array(rawEnc);

        this.currentPosition = 0;
        this.putByte(encrypted.length);
        this.putBytes(encrypted, 0, encrypted.length);
    }

    public putOffsetByte(value: number) {
        this.buffer[this.currentPosition++] = ((value + 128) as number) | 0;
    }

    public putInvertedByte(value: number) {
        this.buffer[this.currentPosition++] = (-value as number) | 0;
    }

    public putNegativeOffsetByte(value: number) {
        this.buffer[this.currentPosition++] = ((128 - value) as number) | 0;
    }

    public getUnsignedPostNegativeOffsetByte(): number {
        return (this.buffer[this.currentPosition++] - 128) & 0xff;
    }

    public getUnsignedInvertedByte(): number {
        return -this.buffer[this.currentPosition++] & 0xff;
    }

    public getUnsignedPreNegativeOffsetByte(): number {
        return (128 - this.buffer[this.currentPosition++]) & 0xff;
    }

    public getPostNegativeOffsetByte(): number {
        return ((this.buffer[this.currentPosition++] - 128) as number) | 0;
    }

    public getInvertedByte(): number {
        return (-this.buffer[this.currentPosition++] as number) | 0;
    }

    public getPreNegativeOffsetByte(): number {
        return ((128 - this.buffer[this.currentPosition++]) as number) | 0;
    }

    public putShortLE(value: number) {
        this.buffer[this.currentPosition++] = (value as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
    }

    public putOffsetShortBE(value: number) {
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
        this.buffer[this.currentPosition++] = ((value + 128) as number) | 0;
    }

    public putOffsetShortLE(value: number) {
        this.buffer[this.currentPosition++] = ((value + 128) as number) | 0;
        this.buffer[this.currentPosition++] = ((value >> 8) as number) | 0;
    }

    public getUnsignedShortLE(): number {
        this.currentPosition += 2;
        return ((this.buffer[this.currentPosition - 1] & 0xff) << 8) + (this.buffer[this.currentPosition - 2] & 0xff);
    }

    public getUnsignedNegativeOffsetShortBE(): number {
        this.currentPosition += 2;
        return ((this.buffer[this.currentPosition - 2] & 0xff) << 8) + ((this.buffer[this.currentPosition - 1] - 128) & 0xff);
    }

    public getUnsignedNegativeOffsetShortLE(): number {
        this.currentPosition += 2;
        return ((this.buffer[this.currentPosition - 1] & 0xff) << 8) + ((this.buffer[this.currentPosition - 2] - 128) & 0xff);
    }

    public getShortLE(): number {
        this.currentPosition += 2;
        let j: number = ((this.buffer[this.currentPosition - 1] & 0xff) << 8) + (this.buffer[this.currentPosition - 2] & 0xff);
        if (j > 0x7fff) {
            j -= 0x10000;
        }
        return j;
    }

    public getNegativeOffsetShortBE(): number {
        this.currentPosition += 2;
        let i: number = ((this.buffer[this.currentPosition - 2] & 0xff) << 8) + ((this.buffer[this.currentPosition - 1] - 128) & 0xff);
        if (i > 0x7fff) {
            i -= 0x10000;
        }
        return i;
    }

    public getMediumME(): number {
        this.currentPosition += 3;
        return (
            ((this.buffer[this.currentPosition - 2] & 0xff) << 16) +
            ((this.buffer[this.currentPosition - 3] & 0xff) << 8) +
            (this.buffer[this.currentPosition - 1] & 0xff)
        );
    }

    public getIntLE(): number {
        this.currentPosition += 4;
        return (
            ((this.buffer[this.currentPosition - 1] & 0xff) << 24) +
            ((this.buffer[this.currentPosition - 2] & 0xff) << 16) +
            ((this.buffer[this.currentPosition - 3] & 0xff) << 8) +
            (this.buffer[this.currentPosition - 4] & 0xff)
        );
    }

    public getIntME1(): number {
        this.currentPosition += 4;
        return (
            ((this.buffer[this.currentPosition - 2] & 0xff) << 24) +
            ((this.buffer[this.currentPosition - 1] & 0xff) << 16) +
            ((this.buffer[this.currentPosition - 4] & 0xff) << 8) +
            (this.buffer[this.currentPosition - 3] & 0xff)
        );
    }

    public getIntME2(): number {
        this.currentPosition += 4;
        return (
            ((this.buffer[this.currentPosition - 3] & 0xff) << 24) +
            ((this.buffer[this.currentPosition - 4] & 0xff) << 16) +
            ((this.buffer[this.currentPosition - 1] & 0xff) << 8) +
            (this.buffer[this.currentPosition - 2] & 0xff)
        );
    }

    public getBytesReverse(bytes: number[], start: number, len: number) {
        for (let pos: number = start + len - 1; pos >= start; pos--) {
            bytes[pos] = this.buffer[this.currentPosition++];
        }
    }

    public getBytesAdded(bytes: Int8Array, start: number, len: number) {
        for (let pos: number = start; pos < start + len; pos++) {
            bytes[pos] = ((this.buffer[this.currentPosition++] - 128) as number) | 0;
        }
    }
}

function encryptBytesRSA(bytes: Uint8Array, modulus: string, publicKey: string): Uint8Array {
    const mod = BigInt(modulus);
    const pk = BigInt(publicKey);
    const value = bytesToBigInt(bytes);

    const encryptedBigInt = modPow(value as bigint, pk, mod);
    return bigIntToUint8Array(encryptedBigInt);
}

function byteToHex(byte: number) {
    const unsignedByte = byte & 0xff;
    if (unsignedByte < 16) {
        return '0' + unsignedByte.toString(16);
    } else {
        return unsignedByte.toString(16);
    }
}

function toHexString(bytes: Uint8Array): string {
    return "0x" + Array.from(bytes).map(byte => byteToHex(byte)).join('');
}

function bytesToBigInt(bytes: Uint8Array): BigInt {
    return BigInt(toHexString(bytes));
}

function bigIntToUint8Array(bigint: BigInt): Uint8Array {
    let hex = bigint.toString(16);
    if (hex.length % 2) {
        hex = '0' + hex;
    }
    const len = hex.length / 2;
    const u8 = new Uint8Array(len);
    for (let i = 0, j = 0; i < len; i++, j += 2) {
        u8[i] = parseInt(hex.slice(j, j + 2), 16);
    }
    return u8;
}
