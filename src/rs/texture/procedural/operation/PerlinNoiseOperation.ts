import { ByteBuffer } from "../../../io/ByteBuffer";
import { mulShift } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

const PERLIN_FADE_TABLE_Q12 = (() => {
    const table = new Int32Array(4096);
    for (let i = 0; i < 4096; i++) {
        const iSqQ12 = mulShift(i, i, 12);
        const nCubedQ12 = mulShift(iSqQ12, i, 12);
        const sixNMinus15Q12 = i * 6 - 61440;
        const innerTermQ12 = mulShift(i, sixNMinus15Q12, 12);
        const innerQ12 = 40960 + innerTermQ12;
        table[i] = mulShift(nCubedQ12, innerQ12, 12);
    }
    return table;
})();

export class PerlinNoiseOperation extends TextureOperation {
    static readonly gradientDirections: number[][] = [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
    ];

    unsignedOutput = true;
    octaveCount = 4;
    persistenceQ12 = 1638;
    seed = 0;
    repeatX = 4;
    repeatY = 4;

    amplitudeByOctaveQ12!: Int16Array;
    frequencyByOctave!: Int16Array;

    permutations = new Int8Array(512);

    static dotGradient2D(x: number, y: number, gradient: number[]): number {
        return x * gradient[0] + y * gradient[1];
    }

    static fade(n: number): number {
        return PERLIN_FADE_TABLE_Q12[n & 0xfff];
    }

    static lerp(start: number, end: number, amount: number): number {
        const inv = 4096 - amount;
        const startTerm = start * inv;
        const endTerm = end * amount;
        const numerator = startTerm + endTerm;
        return numerator >> 12;
    }

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.unsignedOutput = buffer.readUnsignedByte() === 1;
        } else if (field === 1) {
            this.octaveCount = buffer.readUnsignedByte();
        } else if (field === 2) {
            this.persistenceQ12 = buffer.readSignedShort();
            if (this.persistenceQ12 < 0) {
                this.amplitudeByOctaveQ12 = new Int16Array(this.octaveCount);
                for (let i = 0; i < this.octaveCount; i++) {
                    this.amplitudeByOctaveQ12[i] = buffer.readSignedShort();
                }
            }
        } else if (field === 3) {
            this.repeatX = this.repeatY = buffer.readUnsignedByte();
        } else if (field === 4) {
            this.seed = buffer.readUnsignedByte();
        } else if (field === 5) {
            this.repeatX = buffer.readUnsignedByte();
        } else if (field === 6) {
            this.repeatY = buffer.readUnsignedByte();
        }
    }

    override init() {
        this.initNoiseInput();
        for (let i = this.octaveCount - 1; i >= 1; i--) {
            const v = this.amplitudeByOctaveQ12[i];
            if (v > 8 || v < -8) {
                break;
            }
            this.octaveCount--;
        }
    }

    override initCaches(textureGenerator: TextureGenerator, width: number, height: number): void {
        super.initCaches(textureGenerator, width, height);
        this.permutations = textureGenerator.getPermutations(this.seed); // correct
    }

    initNoiseInput() {
        if (this.persistenceQ12 <= 0) {
            if (
                this.amplitudeByOctaveQ12 &&
                this.amplitudeByOctaveQ12.length === this.octaveCount
            ) {
                this.frequencyByOctave = new Int16Array(this.octaveCount);
                for (let i = 0; i < this.octaveCount; i++) {
                    this.frequencyByOctave[i] = Math.pow(2, i);
                }
            }
        } else {
            this.amplitudeByOctaveQ12 = new Int16Array(this.octaveCount); // correct
            this.frequencyByOctave = new Int16Array(this.octaveCount); // correct
            for (let i = 0; i < this.octaveCount; i++) {
                this.amplitudeByOctaveQ12[i] =
                    Math.pow(Math.fround(this.persistenceQ12 / 4096), i) * 4096;
                this.frequencyByOctave[i] = Math.pow(2, i);
            }
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            this.renderNoiseLine(textureGenerator, line, output);
        }
        return output;
    }

    renderNoiseLine(textureGenerator: TextureGenerator, line: number, output: Int32Array): void {
        const vGrad = this.repeatY * textureGenerator.verticalGradient[line];
        if (this.octaveCount === 1) {
            const amplitude = this.amplitudeByOctaveQ12[0];
            const freq12 = this.frequencyByOctave[0] << 12;
            const xWrap = mulShift(freq12, this.repeatX, 12);
            const yWrap = mulShift(freq12, this.repeatY, 12);
            let yCoord = mulShift(freq12, vGrad, 12);
            const permIndex0 = yCoord >> 12;
            let permIndex1 = permIndex0 + 1;
            if (yWrap <= permIndex1) {
                permIndex1 = 0;
            }
            yCoord &= 0xfff;
            const fadeY = PERLIN_FADE_TABLE_Q12[yCoord];
            const perm0 = this.permutations[permIndex0 & 0xff] & 0xff;
            const perm1 = this.permutations[permIndex1 & 0xff] & 0xff;
            if (this.unsignedOutput) {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const hGrad = this.repeatX * textureGenerator.horizontalGradient[pixel];
                    let v = this.sampleNoise2D(
                        mulShift(freq12, hGrad, 12),
                        xWrap,
                        perm0,
                        perm1,
                        yCoord,
                        fadeY,
                    );
                    v = mulShift(amplitude, v, 12);
                    output[pixel] = (v >> 1) + 2048;
                }
            } else {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const hGrad = this.repeatX * textureGenerator.horizontalGradient[pixel];
                    const v = this.sampleNoise2D(
                        mulShift(freq12, hGrad, 12),
                        xWrap,
                        perm0,
                        perm1,
                        yCoord,
                        fadeY,
                    );
                    output[pixel] = mulShift(v, amplitude, 12);
                }
            }
        } else {
            let amplitude = this.amplitudeByOctaveQ12[0];
            if (amplitude > 8 || amplitude < -8) {
                const freq12 = this.frequencyByOctave[0] << 12;
                let yCoord = mulShift(freq12, vGrad, 12);
                const xWrap = mulShift(freq12, this.repeatX, 12);
                const yWrap = mulShift(freq12, this.repeatY, 12);
                const yCell = yCoord >> 12;
                let yCellNext = yCell + 1;
                yCoord &= 0xfff;
                if (yWrap <= yCellNext) {
                    yCellNext = 0;
                }
                const permY0 = this.permutations[yCell & 0xff] & 0xff;
                const fadeY = PERLIN_FADE_TABLE_Q12[yCoord];
                const permY1 = this.permutations[yCellNext & 0xff] & 0xff;
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const xBase = this.repeatX * textureGenerator.horizontalGradient[pixel];
                    const v = this.sampleNoise2D(
                        mulShift(xBase, freq12, 12),
                        xWrap,
                        permY0,
                        permY1,
                        yCoord,
                        fadeY,
                    );
                    output[pixel] = mulShift(amplitude, v, 12);
                }
            }

            for (let octave = 1; octave < this.octaveCount; octave++) {
                amplitude = this.amplitudeByOctaveQ12[octave];
                if (amplitude > 8 || amplitude < -8) {
                    const freq12 = this.frequencyByOctave[octave] << 12;
                    const yWrap = mulShift(this.repeatY, freq12, 12);
                    const xWrap = mulShift(this.repeatX, freq12, 12);
                    let yCoord = mulShift(vGrad, freq12, 12);
                    const yCell = yCoord >> 12;
                    let yCellNext = yCell + 1;
                    yCoord &= 0xfff;
                    if (yWrap <= yCellNext) {
                        yCellNext = 0;
                    }
                    const permY1 = this.permutations[yCellNext & 0xff] & 0xff;
                    const permY0 = this.permutations[yCell & 0xff] & 0xff;
                    const fadeY = PERLIN_FADE_TABLE_Q12[yCoord];
                    if (this.unsignedOutput && this.octaveCount - 1 === octave) {
                        for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                            const xBase = textureGenerator.horizontalGradient[pixel] * this.repeatX;
                            let v = this.sampleNoise2D(
                                mulShift(freq12, xBase, 12),
                                xWrap,
                                permY0,
                                permY1,
                                yCoord,
                                fadeY,
                            );
                            v = output[pixel] + mulShift(v, amplitude, 12);
                            output[pixel] = 2048 + (v >> 1);
                        }
                    } else {
                        for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                            const xBase = textureGenerator.horizontalGradient[pixel] * this.repeatX;
                            const v = this.sampleNoise2D(
                                mulShift(freq12, xBase, 12),
                                xWrap,
                                permY0,
                                permY1,
                                yCoord,
                                fadeY,
                            );
                            output[pixel] += mulShift(amplitude, v, 12);
                        }
                    }
                }
            }
        }
    }

    sampleNoise2D(
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
        const fadeX = PERLIN_FADE_TABLE_Q12[xCoord];
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
        const interpTop = mulShift(fadeX, dot01 - dot00, 12) + dot00;
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
        const interpBottom = dot00 + mulShift(fadeX, dot01 - dot00, 12);
        return interpTop + mulShift(fadeY, interpBottom - interpTop, 12);
    }

    sampleNoise2DReference(
        x: number,
        y: number,
        verticalGradient: number,
        horizontalGradient: number,
    ): number {
        let xCellBaseQ12 = x & 0xfffff000;
        x -= xCellBaseQ12;
        let yCellBaseQ12 = y & 0xfffff000;
        y -= yCellBaseQ12;
        const yWrapQ12 = verticalGradient & 0xfffff000;
        const xWrapQ12 = horizontalGradient & 0xfffff000;

        let yCell = yCellBaseQ12 >> 12;
        let yCellNext = yCell + 1;
        yCell &= 0xff;
        xCellBaseQ12 >>= 12;
        let xCellNext = xCellBaseQ12 + 1;
        if (xWrapQ12 >> 12 <= xCellNext) {
            xCellNext = 0;
        }
        const xCell = xCellBaseQ12 & 0xff;
        xCellNext &= 0xff;
        if (yCellNext >= yWrapQ12 >> 12) {
            yCellNext = 0;
        }
        yCellNext &= 0xff;

        const grad00 = this.permutations[this.permutations[yCell] + xCell] % 4;
        const grad10 = this.permutations[this.permutations[yCell] + xCellNext] % 4;
        const grad11 = this.permutations[this.permutations[yCellNext] + xCellNext] % 4;
        const grad01 = this.permutations[this.permutations[yCellNext] + xCell] % 4;

        const dot00 = PerlinNoiseOperation.dotGradient2D(
            x,
            y,
            PerlinNoiseOperation.gradientDirections[grad00],
        );
        const dot10 = PerlinNoiseOperation.dotGradient2D(
            x - 4096,
            y,
            PerlinNoiseOperation.gradientDirections[grad10],
        );
        const dot01 = PerlinNoiseOperation.dotGradient2D(
            x,
            y - 4096,
            PerlinNoiseOperation.gradientDirections[grad01],
        );
        const dot11 = PerlinNoiseOperation.dotGradient2D(
            x - 4096,
            y - 4096,
            PerlinNoiseOperation.gradientDirections[grad11],
        );
        const fadeX = PerlinNoiseOperation.fade(x);
        const fadeY = PerlinNoiseOperation.fade(y);
        const interpTop = PerlinNoiseOperation.lerp(dot00, dot10, fadeX);
        const interpBottom = PerlinNoiseOperation.lerp(dot01, dot11, fadeX);
        return PerlinNoiseOperation.lerp(interpTop, interpBottom, fadeY);
    }
}
