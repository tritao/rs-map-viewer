import { ByteBuffer } from "../io/ByteBuffer";

export class Xtea {
    static readonly GOLDEN_RATIO : number  = 0x9e3779b9;

    static readonly ROUNDS: number = 32;

    static readonly INITIAL_SUM: number = Math.imul(Xtea.GOLDEN_RATIO, Xtea.ROUNDS);

    static isValidKey(key: Array<number> | null): boolean {
        return (
            key !== null &&
            key.length === 4 &&
            (key[0] !== 0 || key[1] !== 0 || key[2] !== 0 || key[3] !== 0)
        );
    }

    static decrypt(buf: ByteBuffer, start: number, end: number, key: number[] | null): void {
        if (key == null || key.length !== 4) {
            throw new Error("Xtea: key is not 128 bits");
        }

        const n = Math.floor((end - start) / 8);
        for (let i = 0; i < n; i++) {
            const offset = start + i * 8;
            let sum = Xtea.INITIAL_SUM;
            let v0 = buf.getInt(offset);
            let v1 = buf.getInt(offset + 4);
            for (let j = 0; j < Xtea.ROUNDS; j++) {
                v1 -= (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >>> 11) & 3]);
                sum -= Xtea.GOLDEN_RATIO;
                v0 -= (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]);
            }
            buf.setInt(offset, v0);
            buf.setInt(offset + 4, v1);
        }
    }

    static decryptInPlace(data: Uint8Array, start: number, end: number, key: number[] | null): void {
        if (key == null || key.length !== 4) {
            throw new Error("Xtea: key is not 128 bits");
        }
        if (start < 0 || end < start || end > data.byteLength) {
            throw new Error(`Xtea: invalid range start=${start} end=${end} length=${data.byteLength}`);
        }

        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

        const n = Math.floor((end - start) / 8);
        for (let i = 0; i < n; i++) {
            const offset = start + i * 8;
            let sum = Xtea.INITIAL_SUM | 0;
            let v0 = dv.getInt32(offset, false);
            let v1 = dv.getInt32(offset + 4, false);

            for (let j = 0; j < Xtea.ROUNDS; j++) {
                const expr1 =
                    (((((v0 << 4) ^ (v0 >>> 5)) + v0) | 0) ^ ((sum + key[(sum >>> 11) & 3]) | 0)) |
                    0;
                v1 = (v1 - expr1) | 0;

                sum = (sum - Xtea.GOLDEN_RATIO) | 0;

                const expr2 =
                    (((((v1 << 4) ^ (v1 >>> 5)) + v1) | 0) ^ ((sum + key[sum & 3]) | 0)) | 0;
                v0 = (v0 - expr2) | 0;
            }

            dv.setInt32(offset, v0, false);
            dv.setInt32(offset + 4, v1, false);
        }
    }
}
