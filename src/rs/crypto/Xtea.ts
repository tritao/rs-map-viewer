import { mulU32, toI32, toU32 } from "../util/U32";

export class Xtea {
    static readonly GOLDEN_RATIO: i32 = toI32(0x9e3779b9);

    static readonly ROUNDS: number = 32;

    static readonly INITIAL_SUM: i32 = toI32(mulU32(toU32(Xtea.GOLDEN_RATIO), Xtea.ROUNDS));

    static isValidKey(key: Array<number> | null): boolean {
        return (
            key !== null &&
            key.length === 4 &&
            (key[0] !== 0 || key[1] !== 0 || key[2] !== 0 || key[3] !== 0)
        );
    }

    static decryptInPlace(data: Uint8Array, start: number, end: number, key: number[] | null): void {
        if (key === null || key.length !== 4) {
            throw new Error("Xtea: key is not 128 bits");
        }
        if (start < 0 || end < start || end > data.byteLength) {
            throw new Error(`Xtea: invalid range start=${start} end=${end} length=${data.byteLength}`);
        }

        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

        const n = Math.floor((end - start) / 8);
        for (let i = 0; i < n; i++) {
            const offset = start + i * 8;
            let sum: i32 = Xtea.INITIAL_SUM;
            let v0: i32 = dv.getInt32(offset, false);
            let v1: i32 = dv.getInt32(offset + 4, false);

            for (let j = 0; j < Xtea.ROUNDS; j++) {
                const sumU32 = toU32(sum);
                const v0Mix: i32 = toI32(((v0 << 4) ^ (v0 >>> 5)) + v0);
                const sumKey1: i32 = toI32(sum + key[(sumU32 >>> 11) & 3]);
                const expr1: i32 = toI32(v0Mix ^ sumKey1);
                v1 = toI32(v1 - expr1);

                sum = toI32(sum - Xtea.GOLDEN_RATIO);

                const v1Mix: i32 = toI32(((v1 << 4) ^ (v1 >>> 5)) + v1);
                const sumKey2: i32 = toI32(sum + key[toU32(sum) & 3]);
                const expr2: i32 = toI32(v1Mix ^ sumKey2);
                v0 = toI32(v0 - expr2);
            }

            dv.setInt32(offset, v0, false);
            dv.setInt32(offset + 4, v1, false);
        }
    }
}
