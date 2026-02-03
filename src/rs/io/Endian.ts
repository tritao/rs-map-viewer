import { toU32 } from "../util/U32";

export function readU16BE(buf: Uint8Array, off: number): u16 {
    return ((buf[off] << 8) | buf[off + 1]) & 0xffff;
}

export function readU24BE(buf: Uint8Array, off: number): u32 {
    return ((buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2]) >>> 0;
}

export function readU32BE(buf: Uint8Array, off: number): u32 {
    return (
        ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>>
        0
    );
}

export function readI32BE(buf: Uint8Array, off: number): i32 {
    return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
}

export function writeU16BE(buf: Uint8Array, off: number, value: u16): void {
    buf[off] = (value >>> 8) & 0xff;
    buf[off + 1] = value & 0xff;
}

export function writeU24BE(buf: Uint8Array, off: number, value: u32): void {
    buf[off] = (value >>> 16) & 0xff;
    buf[off + 1] = (value >>> 8) & 0xff;
    buf[off + 2] = value & 0xff;
}

export function writeU32BE(buf: Uint8Array, off: number, value: u32): void {
    const v = toU32(value);
    buf[off] = (v >>> 24) & 0xff;
    buf[off + 1] = (v >>> 16) & 0xff;
    buf[off + 2] = (v >>> 8) & 0xff;
    buf[off + 3] = v & 0xff;
}

