import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class PerlinNoiseOperation extends TextureOperation {
    static readonly invertTable: number[][] = [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
    ];

    static noise: Int32Array = new Int32Array(4096);

    field0 = true;
    field1 = 4;
    field2 = 1638;
    seed = 0;
    field5 = 4;
    field6 = 4;

    noiseInput0!: Int16Array;
    noiseInput1!: Int16Array;

    permutations = new Int8Array(512);

    static initNoise(): void {
        // correct
        for (let i = 0; i < 4096; i++) {
            PerlinNoiseOperation.noise[i] = PerlinNoiseOperation.calcNoise(i);
        }
    }

    static addInvert(x: number, y: number, invert: number[]): number {
        return x * invert[0] + y * invert[1];
    }

    static fade(n: number): number {
        const i = (((n * n) >> 12) * n) >> 12;
        const j = 6 * n - 61440;
        const k = 40960 + ((j * n) >> 12);
        return (k * i) >> 12;
    }

    static calcNoise(n: number) {
        const i = (((n * n) >> 12) * n) >> 12;
        const j = n * 6 - 61440;
        const k = 40960 + ((n * j) >> 12);
        return (i * k) >> 12;
    }

    static lerp(start: number, end: number, amount: number): number {
        return (start * (4096 - amount) + end * amount) >> 12;
    }

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.field0 = buffer.readUnsignedByte() === 1;
        } else if (field === 1) {
            this.field1 = buffer.readUnsignedByte();
        } else if (field === 2) {
            this.field2 = buffer.readSignedShort();
            if (this.field2 < 0) {
                this.noiseInput0 = new Int16Array(this.field1);
                for (let i = 0; i < this.field1; i++) {
                    this.noiseInput0[i] = buffer.readSignedShort();
                }
            }
        } else if (field === 3) {
            this.field5 = this.field6 = buffer.readUnsignedByte();
        } else if (field === 4) {
            this.seed = buffer.readUnsignedByte();
        } else if (field === 5) {
            this.field5 = buffer.readUnsignedByte();
        } else if (field === 6) {
            this.field6 = buffer.readUnsignedByte();
        }
    }

    override init() {
        this.initTable();
        this.initNoiseInput();
        for (let i = this.field1 - 1; i >= 1; i--) {
            const v = this.noiseInput0[i];
            if (v > 8 || v < -8) {
                break;
            }
            this.field1--;
        }
    }

    initTable() {
        this.permutations = TextureGenerator.initPermutations(this.seed); // correct
    }

    initNoiseInput() {
        if (this.field2 <= 0) {
            if (this.noiseInput0 && this.noiseInput0.length === this.field1) {
                this.noiseInput1 = new Int16Array(this.field1);
                for (let i = 0; i < this.field1; i++) {
                    this.noiseInput1[i] = Math.pow(2, i);
                }
            }
        } else {
            this.noiseInput0 = new Int16Array(this.field1); // correct
            this.noiseInput1 = new Int16Array(this.field1); // correct
            for (let i = 0; i < this.field1; i++) {
                this.noiseInput0[i] = Math.pow(Math.fround(this.field2 / 4096), i) * 4096;
                this.noiseInput1[i] = Math.pow(2, i);
            }
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            this.noise0(textureGenerator, line, output);
        }
        return output;
    }

    noise0(textureGenerator: TextureGenerator, line: number, output: Int32Array): void {
        const vGrad = this.field6 * textureGenerator.verticalGradient[line];
        if (this.field1 === 1) {
            const amplitude = this.noiseInput0[0];
            const freq12 = this.noiseInput1[0] << 12;
            const xWrap = (freq12 * this.field5) >> 12;
            const yWrap = (freq12 * this.field6) >> 12;
            let yCoord = (freq12 * vGrad) >> 12;
            const permIndex0 = yCoord >> 12;
            let permIndex1 = permIndex0 + 1;
            if (yWrap <= permIndex1) {
                permIndex1 = 0;
            }
            yCoord &= 0xfff;
            const fadeY = PerlinNoiseOperation.noise[yCoord];
            const perm0 = this.permutations[permIndex0 & 0xff] & 0xff;
            const perm1 = this.permutations[permIndex1 & 0xff] & 0xff;
            if (this.field0) {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const hGrad = this.field5 * textureGenerator.horizontalGradient[pixel];
                    let v = this.noise1((freq12 * hGrad) >> 12, xWrap, perm0, perm1, yCoord, fadeY);
                    v = (amplitude * v) >> 12;
                    output[pixel] = (v >> 1) + 2048;
                }
            } else {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const hGrad = this.field5 * textureGenerator.horizontalGradient[pixel];
                    const v = this.noise1(
                        (freq12 * hGrad) >> 12,
                        xWrap,
                        perm0,
                        perm1,
                        yCoord,
                        fadeY,
                    );
                    output[pixel] = (v * amplitude) >> 12;
                }
            }
        } else {
            let amplitude = this.noiseInput0[0];
            if (amplitude > 8 || amplitude < -8) {
                const freq12 = this.noiseInput1[0] << 12;
                let yCoord = (freq12 * vGrad) >> 12;
                const xWrap = (freq12 * this.field5) >> 12;
                const yWrap = (freq12 * this.field6) >> 12;
                const yCell = yCoord >> 12;
                let yCellNext = yCell + 1;
                yCoord &= 0xfff;
                if (yWrap <= yCellNext) {
                    yCellNext = 0;
                }
                const permY0 = this.permutations[yCell & 0xff] & 0xff;
                const fadeY = PerlinNoiseOperation.noise[yCoord];
                const permY1 = this.permutations[yCellNext & 0xff] & 0xff;
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const xBase = this.field5 * textureGenerator.horizontalGradient[pixel];
                    const v = this.noise1(
                        (xBase * freq12) >> 12,
                        xWrap,
                        permY0,
                        permY1,
                        yCoord,
                        fadeY,
                    );
                    output[pixel] = (amplitude * v) >> 12;
                }
            }

            for (let octave = 1; octave < this.field1; octave++) {
                amplitude = this.noiseInput0[octave];
                if (amplitude > 8 || amplitude < -8) {
                    const freq12 = this.noiseInput1[octave] << 12;
                    const yWrap = (this.field6 * freq12) >> 12;
                    const xWrap = (this.field5 * freq12) >> 12;
                    let yCoord = (vGrad * freq12) >> 12;
                    const yCell = yCoord >> 12;
                    let yCellNext = yCell + 1;
                    yCoord &= 0xfff;
                    if (yWrap <= yCellNext) {
                        yCellNext = 0;
                    }
                    const permY1 = this.permutations[yCellNext & 0xff] & 0xff;
                    const permY0 = this.permutations[yCell & 0xff] & 0xff;
                    const fadeY = PerlinNoiseOperation.noise[yCoord];
                    if (this.field0 && this.field1 - 1 === octave) {
                        for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                            const xBase = textureGenerator.horizontalGradient[pixel] * this.field5;
                            let v = this.noise1(
                                (freq12 * xBase) >> 12,
                                xWrap,
                                permY0,
                                permY1,
                                yCoord,
                                fadeY,
                            );
                            v = output[pixel] + ((v * amplitude) >> 12);
                            output[pixel] = 2048 + (v >> 1);
                        }
                    } else {
                        for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                            const xBase = textureGenerator.horizontalGradient[pixel] * this.field5;
                            const v = this.noise1(
                                (freq12 * xBase) >> 12,
                                xWrap,
                                permY0,
                                permY1,
                                yCoord,
                                fadeY,
                            );
                            output[pixel] += (amplitude * v) >> 12;
                        }
                    }
                }
            }
        }
    }

    noise1(
        xCoord: number,
        xWrap: number,
        permY0: number,
        permY1: number,
        yFrac: number,
        fadeY: number,
    ): number {
        let xCell = xCoord >> 12;
        let xCellNext = xCell + 1;
        xCoord &= 0xfff;
        if (xCellNext >= xWrap) {
            xCellNext = 0;
        }
        xCell &= 0xff;
        const yFracMinusOne = yFrac - 4096;
        const xFracMinusOne = xCoord - 4096;
        xCellNext &= 0xff;
        let gradIndex = this.permutations[permY0 + xCell] & 0x3;
        const fadeX = PerlinNoiseOperation.noise[xCoord];
        let dot00: number;
        if (gradIndex > 1) {
            dot00 = gradIndex === 2 ? -yFrac + xCoord : -yFrac + -xCoord;
        } else {
            dot00 = gradIndex === 0 ? yFrac + xCoord : -xCoord + yFrac;
        }
        gradIndex = this.permutations[permY0 + xCellNext] & 0x3;
        let dot01: number;
        if (gradIndex <= 1) {
            dot01 = gradIndex === 0 ? yFrac + xFracMinusOne : yFrac - xFracMinusOne;
        } else {
            dot01 = gradIndex === 2 ? xFracMinusOne - yFrac : -xFracMinusOne + -yFrac;
        }
        const interpTop = ((fadeX * (dot01 - dot00)) >> 12) + dot00;
        gradIndex = this.permutations[permY1 + xCell] & 0x3;
        if (gradIndex <= 1) {
            dot00 = gradIndex !== 0 ? yFracMinusOne - xCoord : xCoord + yFracMinusOne;
        } else {
            dot00 = gradIndex !== 2 ? -yFracMinusOne + -xCoord : xCoord - yFracMinusOne;
        }
        gradIndex = this.permutations[xCellNext + permY1] & 0x3;
        if (gradIndex <= 1) {
            dot01 = gradIndex === 0 ? xFracMinusOne + yFracMinusOne : yFracMinusOne - xFracMinusOne;
        } else {
            dot01 =
                gradIndex === 2 ? -yFracMinusOne + xFracMinusOne : -yFracMinusOne + -xFracMinusOne;
        }
        const interpBottom = dot00 + ((fadeX * (dot01 - dot00)) >> 12);
        return interpTop + ((fadeY * (interpBottom - interpTop)) >> 12);
    }

    noise(x: number, y: number, verticalGradient: number, horizontalGradient: number): number {
        let k = x & 0xfffff000;
        x -= k;
        let l = y & 0xfffff000;
        y -= l;
        const j1 = verticalGradient & 0xfffff000;
        const i1 = horizontalGradient & 0xfffff000;
        l >>= 12;
        let j = l + 1;
        l &= 0xff;
        k >>= 12;
        let i = k + 1;
        if (i1 >> 12 <= i) {
            i = 0;
        }
        k &= 0xff;
        i &= 0xff;
        if (j >= j1 >> 12) {
            j = 0;
        }
        const i2 = this.permutations[this.permutations[l] + i] % 4;
        const k1 = this.permutations[this.permutations[l] + k] % 4;
        j &= 0xff;
        const j2 = this.permutations[this.permutations[j] + i] % 4;
        const l1 = this.permutations[this.permutations[j] + k] % 4;
        const k2 = PerlinNoiseOperation.addInvert(x, y, PerlinNoiseOperation.invertTable[k1]);
        const l2 = PerlinNoiseOperation.addInvert(
            x - 4096,
            y,
            PerlinNoiseOperation.invertTable[i2],
        );
        const i3 = PerlinNoiseOperation.addInvert(
            x,
            y - 4096,
            PerlinNoiseOperation.invertTable[l1],
        );
        const j3 = PerlinNoiseOperation.addInvert(
            x - 4096,
            y - 4096,
            PerlinNoiseOperation.invertTable[j2],
        );
        const k3 = PerlinNoiseOperation.fade(x);
        const l3 = PerlinNoiseOperation.fade(y);
        const i4 = PerlinNoiseOperation.lerp(k2, l2, k3);
        const j4 = PerlinNoiseOperation.lerp(i3, j3, k3);
        return PerlinNoiseOperation.lerp(i4, j4, l3);
    }
}

PerlinNoiseOperation.initNoise();
