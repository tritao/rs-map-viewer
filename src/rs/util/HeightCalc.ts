import { COSINE } from "../MathConstants";
import { add, idiv, imul, shr, sub } from "./JavaInt";

function interpolate(a: number, b: number, t: number, freq: number): number {
    const cosineIndex = idiv(imul(t, 1024), freq);
    const weightB = shr(sub(65536, COSINE[cosineIndex]), 1);
    const partB = shr(imul(weightB, b), 16);
    const partA = shr(imul(sub(65536, weightB), a), 16);
    return add(partB, partA);
}

function noise(x: number, y: number): number {
    let n = add(imul(y, 57), x);
    n = (n << 13) ^ n;
    const nSq = imul(n, n);
    const inner = add(imul(nSq, 15731), 789221);
    const n2 = add(imul(n, inner), 1376312589);
    const masked = n2 & 0x7fffffff;
    return (masked >>> 19) & 0xff;
}

function smoothedNoise1(x: number, y: number): number {
    const corners =
        noise(x - 1, y - 1) + noise(x + 1, y - 1) + noise(x - 1, y + 1) + noise(x + 1, y + 1);
    const sides = noise(x - 1, y) + noise(x + 1, y) + noise(x, y - 1) + noise(x, y + 1);
    const center = noise(x, y);
    return add(add(idiv(center, 4), idiv(sides, 8)), idiv(corners, 16));
}

function interpolateNoise(x: number, y: number, freq: number): number {
    const freqMask = freq - 1;
    const intX = idiv(x, freq);
    const fracX = x & freqMask;
    const intY = idiv(y, freq);
    const fracY = y & freqMask;
    const v1 = smoothedNoise1(intX, intY);
    const v2 = smoothedNoise1(intX + 1, intY);
    const v3 = smoothedNoise1(intX, intY + 1);
    const v4 = smoothedNoise1(intX + 1, intY + 1);
    const i1 = interpolate(v1, v2, fracX, freq);
    const i2 = interpolate(v3, v4, fracX, freq);
    return interpolate(i1, i2, fracY, freq);
}

export function generateHeight(x: number, y: number) {
    const a = sub(interpolateNoise(x + 45365, y + 91923, 4), 128);
    const b = shr(sub(interpolateNoise(x + 10294, y + 37821, 2), 128), 1);
    const c = shr(sub(interpolateNoise(x, y, 1), 128), 2);
    let n = add(add(a, b), c);
    n = Math.trunc(0.3 * n) + 35;
    if (n < 10) {
        n = 10;
    } else if (n > 60) {
        n = 60;
    }
    return n;
}
