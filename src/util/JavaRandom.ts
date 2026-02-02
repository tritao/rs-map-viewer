//
// A TypeScript port of a `java.util.Random`-compatible PRNG.
//
// Implementation notes:
// - Uses a 48-bit LCG (same constants as Java) but keeps the internal state as three 16-bit words
//   so all arithmetic stays within JS's safe integer range.
// - API is intentionally compatible with the `java-random` npm package used previously in this repo.
//

const P2_16 = 0x1_0000;
const P2_24 = 0x1_000000;
const P2_27 = 0x8_000000;
const P2_31 = 0x8_0000000;
const P2_32 = 0x1_00000000;
const P2_48 = 0x1_0000_0000_0000;
const P2_53 = 2 ** 53; // NB: exceeds Number.MAX_SAFE_INTEGER

const MASK_16 = 0xffff;

// Multiplicative term for the PRNG: 0x5DEECE66D (split into 16-bit words)
const C2 = 0x0005;
const C1 = 0xdeec;
const C0 = 0xe66d;

export default class JavaRandom {
    private s2 = 0;
    private s1 = 0;
    private s0 = 0;

    private nextNextGaussian = 0;
    private haveNextNextGaussian = false;

    constructor(seed?: number) {
        if (seed === undefined) {
            seed = Math.floor(Math.random() * P2_48);
        }
        this.setSeed(seed);
    }

    // 53-bit safe version of:
    // seed = (seed * 0x5DEECE66DL + 0xBL) & ((1L << 48) - 1)
    private nextState(): number {
        let carry = 0xb;

        let r0 = this.s0 * C0 + carry;
        carry = r0 >>> 16;
        r0 &= MASK_16;

        let r1 = this.s1 * C0 + this.s0 * C1 + carry;
        carry = r1 >>> 16;
        r1 &= MASK_16;

        let r2 = this.s2 * C0 + this.s1 * C1 + this.s0 * C2 + carry;
        r2 &= MASK_16;

        this.s2 = r2;
        this.s1 = r1;
        this.s0 = r0;

        // Equivalent to taking the high 32 bits of the 48-bit state (as Java does in next(bits))
        return this.s2 * P2_16 + this.s1;
    }

    private nextSigned(bits: number): number {
        return this.nextState() >> (32 - bits);
    }

    private nextUnsigned(bits: number): number {
        return this.nextState() >>> (32 - bits);
    }

    private static assertNumber(n: unknown): asserts n is number {
        if (typeof n !== "number") {
            throw new TypeError();
        }
    }

    private static assertPositiveInt(n: unknown, max: number = 0x7fffffff): asserts n is number {
        JavaRandom.assertNumber(n);
        if (n < 0 || n > max) {
            throw new RangeError();
        }
    }

    // 53-bit safe version of:
    // seed = (seed ^ 0x5DEECE66DL) & ((1L << 48) - 1)
    setSeed(seed: number): void {
        JavaRandom.assertNumber(seed);
        this.s0 = (seed & MASK_16) ^ C0;
        this.s1 = ((seed / P2_16) & MASK_16) ^ C1;
        this.s2 = ((seed / P2_32) & MASK_16) ^ C2;
        this.haveNextNextGaussian = false;
        this.nextNextGaussian = 0;
    }

    nextInt(bound?: number): number {
        if (bound === undefined) {
            return this.nextSigned(32);
        }

        JavaRandom.assertPositiveInt(bound);

        // Special case if bound is a power of two
        if ((bound & -bound) === bound) {
            const r = this.nextUnsigned(31) / P2_31;
            return ~~(bound * r);
        }

        let bits: number;
        let val: number;
        do {
            bits = this.nextUnsigned(31);
            val = bits % bound;
        } while (bits - val + (bound - 1) < 0);

        return val;
    }

    nextLong(): bigint {
        const msb = BigInt(this.nextSigned(32));
        const lsb = BigInt(this.nextSigned(32));
        return msb * BigInt(P2_32) + lsb;
    }

    nextBoolean(): boolean {
        return this.nextUnsigned(1) !== 0;
    }

    nextFloat(): number {
        return this.nextUnsigned(24) / P2_24;
    }

    nextDouble(): number {
        return (P2_27 * this.nextUnsigned(26) + this.nextUnsigned(27)) / P2_53;
    }

    nextGaussian(): number {
        if (this.haveNextNextGaussian) {
            this.haveNextNextGaussian = false;
            return this.nextNextGaussian;
        }

        let v1: number;
        let v2: number;
        let s: number;
        do {
            v1 = 2 * this.nextDouble() - 1.0;
            v2 = 2 * this.nextDouble() - 1.0;
            s = v1 * v1 + v2 * v2;
        } while (s >= 1 || s === 0);

        const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
        this.nextNextGaussian = v2 * multiplier;
        this.haveNextNextGaussian = true;
        return v1 * multiplier;
    }

    private static checkStreamSize(streamSize?: number): number | undefined {
        if (streamSize === undefined) {
            return undefined;
        }
        JavaRandom.assertPositiveInt(streamSize, Number.MAX_SAFE_INTEGER);
        return streamSize;
    }

    *ints(streamSize?: number): IterableIterator<number> {
        streamSize = JavaRandom.checkStreamSize(streamSize);
        if (streamSize === undefined) {
            while (true) {
                yield this.nextInt();
            }
        }
        for (let i = 0; i < streamSize; i++) {
            yield this.nextInt();
        }
    }

    *doubles(streamSize?: number): IterableIterator<number> {
        streamSize = JavaRandom.checkStreamSize(streamSize);
        if (streamSize === undefined) {
            while (true) {
                yield this.nextDouble();
            }
        }
        for (let i = 0; i < streamSize; i++) {
            yield this.nextDouble();
        }
    }

    *longs(streamSize?: number): IterableIterator<bigint> {
        streamSize = JavaRandom.checkStreamSize(streamSize);
        if (streamSize === undefined) {
            while (true) {
                yield this.nextLong();
            }
        }
        for (let i = 0; i < streamSize; i++) {
            yield this.nextLong();
        }
    }
}
