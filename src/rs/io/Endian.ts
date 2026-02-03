import { toU32 } from "../util/U32";

function view(buf: Uint8Array): DataView {
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function readU16BE(buf: Uint8Array, off: number): u16 {
    return view(buf).getUint16(off, false);
}

export function readU24BE(buf: Uint8Array, off: number): u32 {
    const dv = view(buf);
    return (
        dv.getUint8(off) * 0x10000 +
        dv.getUint8(off + 1) * 0x100 +
        dv.getUint8(off + 2)
    ) >>> 0;
}

export function readU32BE(buf: Uint8Array, off: number): u32 {
    return view(buf).getUint32(off, false);
}

export function readI32BE(buf: Uint8Array, off: number): i32 {
    return view(buf).getInt32(off, false);
}

export function writeU16BE(buf: Uint8Array, off: number, value: u16): void {
    view(buf).setUint16(off, value, false);
}

export function writeU24BE(buf: Uint8Array, off: number, value: u32): void {
    const v = toU32(value);
    buf[off] = (v >>> 16) & 0xff;
    buf[off + 1] = (v >>> 8) & 0xff;
    buf[off + 2] = v & 0xff;
}

export function writeU32BE(buf: Uint8Array, off: number, value: u32): void {
    view(buf).setUint32(off, toU32(value), false);
}
