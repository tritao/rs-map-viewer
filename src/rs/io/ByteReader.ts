export interface ByteReader {
    tell(): number;
    seek(position: number): void;
    skip(amount: number): void;

    get remaining(): number;

    peekByte(): number;
    peekUnsignedByte(): number;

    readByte(): number;
    readUnsignedByte(): number;
    readShort(): number;
    readUnsignedShort(): number;
    readMedium(): number;
    readInt(): number;
    readUnsignedInt(): number;

    readBigSmart(): number;

    readBytes(amount: number): Uint8Array;
    readBytesInto(target: Uint8Array, targetOffset?: number, length?: number): void;
}
