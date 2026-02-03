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

    readBigSmart(): number;

    readBytes(amount: number): Uint8Array;
}
