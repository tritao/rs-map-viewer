// Utilities to mirror Java `int` (32-bit signed) arithmetic semantics in TS.
//
// Rules of thumb:
// - Use `i32()` to force ToInt32 at the same points Java would overflow/truncate.
// - Use `imul()` for 32-bit overflow-wrapping multiplication.
// - Use `idiv()` for truncating integer division (toward zero), not JS float division.

export function i32(x: number): i32 {
    return x | 0;
}

export function imul(a: number, b: number): i32 {
    return Math.imul(a, b) | 0;
}

export function add(a: number, b: number): i32 {
    return (a + b) | 0;
}

export function sub(a: number, b: number): i32 {
    return (a - b) | 0;
}

export function shl(a: number, bits: number): i32 {
    return (a << (bits & 31)) | 0;
}

export function shr(a: number, bits: number): i32 {
    return (a >> (bits & 31)) | 0;
}

export function ushr(a: number, bits: number): u32 {
    return (a >>> (bits & 31)) >>> 0;
}

export function absI32(v: number): i32 {
    const x = v | 0;
    // Matches Java: Math.abs(Integer.MIN_VALUE) == Integer.MIN_VALUE.
    return x < 0 ? -x | 0 : x;
}

export function clampI32(v: number, lo: number, hi: number): i32 {
    const x = v | 0;
    if (x < (lo | 0)) return lo | 0;
    if (x > (hi | 0)) return hi | 0;
    return x;
}

export function idiv(a: number, b: number): i32 {
    // Java would throw on division by 0. Call sites should guard if needed.
    return ((a | 0) / (b | 0)) | 0;
}

export function mulShift(a: number, b: number, shift: number): i32 {
    return (Math.imul(a, b) >> (shift & 31)) | 0;
}

export function mulQ12(a: number, b: number): i32 {
    return mulShift(a, b, 12);
}

export function divQ12(a: number, b: number): i32 {
    return idiv(shl(a, 12), b);
}

export function maskIndex(index: number, mask: number): i32 {
    return index & mask;
}
