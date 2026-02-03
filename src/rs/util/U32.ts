export function toU32(value: number): u32 {
    return value >>> 0;
}

export function toI32(value: number): i32 {
    return value | 0;
}

export function addU32(a: u32, b: u32): u32 {
    return (a + b) >>> 0;
}

export function subU32(a: u32, b: u32): u32 {
    return (a - b) >>> 0;
}

export function mulU32(a: u32, b: u32): u32 {
    return Math.imul(a, b) >>> 0;
}

export function rotlU32(x: u32, bits: number): u32 {
    const s = bits & 31;
    return ((x << s) | (x >>> (32 - s))) >>> 0;
}

export function rotrU32(x: u32, bits: number): u32 {
    const s = bits & 31;
    return ((x >>> s) | (x << (32 - s))) >>> 0;
}

