export const U64_ZERO: u64 = 0n;
export const U64_ONE: u64 = 1n;

export function u64FromNumber(value: number): u64 {
    return BigInt(value);
}

export function u64FromU32(value: number): u64 {
    return BigInt(value >>> 0);
}

export function u64ToNumber(value: u64): number {
    return Number(value);
}

export function u64Or(a: u64, b: u64): u64 {
    return a | b;
}

export function u64And(a: u64, b: u64): u64 {
    return a & b;
}

export function u64Shl(value: u64, bits: number): u64 {
    return value << BigInt(bits);
}

export function u64Shr(value: u64, bits: number): u64 {
    return value >> BigInt(bits);
}

export function u64IsZero(value: u64): boolean {
    return value === U64_ZERO;
}

export function u64IsNonZero(value: u64): boolean {
    return value !== U64_ZERO;
}

export function u64SetBit(value: u64, bitIndex: number): u64 {
    return value | (U64_ONE << BigInt(bitIndex));
}

export function u64TestBit(value: u64, bitIndex: number): boolean {
    return (value & (U64_ONE << BigInt(bitIndex))) !== U64_ZERO;
}
