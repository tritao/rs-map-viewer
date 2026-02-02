import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

enum ArithmeticBlendMode {
    Add = 1,
    Subtract = 2,
    Multiply = 3,
    Divide = 4,
    Screen = 5,
    Overlay = 6,
    ColorDodge = 7,
    ColorBurn = 8,
    Min = 9,
    Max = 10,
    Difference = 11,
    Exclusion = 12,
}

export class ArithmeticOperation extends TextureOperation {
    blendMode: ArithmeticBlendMode = ArithmeticBlendMode.Overlay;

    constructor() {
        super(2, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.blendMode = buffer.readUnsignedByte() as ArithmeticBlendMode;
        } else if (field === 1) {
            this.isMonochrome = buffer.readUnsignedByte() === 1;
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }

        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const inputA = this.getMonochromeInput(textureGenerator, 0, line);
            const inputB = this.getMonochromeInput(textureGenerator, 1, line);
            switch (this.blendMode) {
                case ArithmeticBlendMode.Add:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        output[pixel] = inputA[pixel] + inputB[pixel];
                    }
                    break;
                case ArithmeticBlendMode.Subtract:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        output[pixel] = inputA[pixel] - inputB[pixel];
                    }
                    break;
                case ArithmeticBlendMode.Multiply:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        output[pixel] = (inputB[pixel] * inputA[pixel]) / 4096;
                    }
                    break;
                case ArithmeticBlendMode.Divide:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputBValue = inputB[pixel];
                        output[pixel] =
                            inputBValue === 0 ? 4096 : (inputA[pixel] * 4096) / inputBValue;
                    }
                    break;
                case ArithmeticBlendMode.Screen:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        output[pixel] =
                            4096 - ((4096 - inputA[pixel]) * (4096 - inputB[pixel])) / 4096;
                    }
                    break;
                case ArithmeticBlendMode.Overlay:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputBValue = inputB[pixel];
                        output[pixel] =
                            inputBValue < 2048
                                ? (inputBValue * inputA[pixel]) / 2048
                                : 4096 -
                                  ((((4096 - inputA[pixel]) * (4096 - inputBValue)) / 2048) | 0);
                    }
                    break;
                case ArithmeticBlendMode.ColorDodge:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputAValue = inputA[pixel];
                        output[pixel] =
                            inputAValue === 4096
                                ? 4096
                                : (inputB[pixel] * 4096) / (4096 - inputAValue);
                    }
                    break;
                case ArithmeticBlendMode.ColorBurn:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputAValue = inputA[pixel];
                        output[pixel] =
                            inputAValue === 0
                                ? 0
                                : 4096 - ((4096 - inputB[pixel]) * 4096) / inputAValue;
                    }
                    break;
                case ArithmeticBlendMode.Min:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputAValue = inputA[pixel];
                        const inputBValue = inputB[pixel];
                        output[pixel] = Math.min(inputAValue, inputBValue);
                    }
                    break;
                case ArithmeticBlendMode.Max:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputAValue = inputA[pixel];
                        const inputBValue = inputB[pixel];
                        output[pixel] = Math.max(inputAValue, inputBValue);
                    }
                    break;
                case ArithmeticBlendMode.Difference:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputAValue = inputA[pixel];
                        const inputBValue = inputB[pixel];
                        output[pixel] =
                            inputBValue < inputAValue
                                ? inputAValue - inputBValue
                                : inputBValue - inputAValue;
                    }
                    break;
                case ArithmeticBlendMode.Exclusion:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const inputAValue = inputA[pixel];
                        const inputBValue = inputB[pixel];
                        output[pixel] =
                            inputBValue + inputAValue - (inputBValue * inputAValue) / 2048;
                    }
                    break;
            }
        }
        return output;
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache is not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            const inputA = this.getColourInput(textureGenerator, 0, line);
            const inputB = this.getColourInput(textureGenerator, 1, line);
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];
            const inputAR = inputA[0];
            const inputAG = inputA[1];
            const inputAB = inputA[2];
            const inputBR = inputB[0];
            const inputBG = inputB[1];
            const inputBB = inputB[2];
            switch (this.blendMode) {
                case ArithmeticBlendMode.Add:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        outputR[pixel] = inputAR[pixel] + inputBR[pixel];
                        outputG[pixel] = inputAG[pixel] + inputBG[pixel];
                        outputB[pixel] = inputAB[pixel] + inputBB[pixel];
                    }
                    break;
                case ArithmeticBlendMode.Subtract:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        outputR[pixel] = inputAR[pixel] - inputBR[pixel];
                        outputG[pixel] = inputAG[pixel] - inputBG[pixel];
                        outputB[pixel] = inputAB[pixel] - inputBB[pixel];
                    }
                    break;
                case ArithmeticBlendMode.Multiply:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        outputR[pixel] = (inputBR[pixel] * inputAR[pixel]) / 4096;
                        outputG[pixel] = (inputBG[pixel] * inputAG[pixel]) / 4096;
                        outputB[pixel] = (inputBB[pixel] * inputAB[pixel]) / 4096;
                    }
                    break;
                case ArithmeticBlendMode.Divide:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const bR = inputBR[pixel];
                        const bG = inputBG[pixel];
                        const bB = inputBB[pixel];
                        outputR[pixel] = bR === 0 ? 4096 : (inputAR[pixel] * 4096) / bR;
                        outputG[pixel] = bG === 0 ? 4096 : (inputAG[pixel] * 4096) / bG;
                        outputB[pixel] = bB === 0 ? 4096 : (inputAB[pixel] * 4096) / bB;
                    }
                    break;
                case ArithmeticBlendMode.Screen:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        outputR[pixel] =
                            4096 - ((4096 - inputAR[pixel]) * (4096 - inputBR[pixel])) / 4096;
                        outputG[pixel] =
                            4096 - ((4096 - inputAG[pixel]) * (4096 - inputBG[pixel])) / 4096;
                        outputB[pixel] =
                            4096 - ((4096 - inputAB[pixel]) * (4096 - inputBB[pixel])) / 4096;
                    }
                    break;
                case ArithmeticBlendMode.Overlay:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const bR = inputBR[pixel];
                        const bG = inputBG[pixel];
                        const bB = inputBB[pixel];
                        outputR[pixel] =
                            bR < 2048
                                ? (bR * inputAR[pixel]) / 2048
                                : 4096 - ((((4096 - inputAR[pixel]) * (4096 - bR)) / 2048) | 0);
                        outputG[pixel] =
                            bG < 2048
                                ? (bG * inputAG[pixel]) / 2048
                                : 4096 - ((((4096 - inputAG[pixel]) * (4096 - bG)) / 2048) | 0);
                        outputB[pixel] =
                            bB < 2048
                                ? (bB * inputAB[pixel]) / 2048
                                : 4096 - ((((4096 - inputAB[pixel]) * (4096 - bB)) / 2048) | 0);
                    }
                    break;
                case ArithmeticBlendMode.ColorDodge:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const aR = inputAR[pixel];
                        const aG = inputAG[pixel];
                        const aB = inputAB[pixel];
                        outputR[pixel] = aR === 4096 ? 4096 : (inputBR[pixel] * 4096) / (4096 - aR);
                        outputG[pixel] = aG === 4096 ? 4096 : (inputBG[pixel] * 4096) / (4096 - aG);
                        outputB[pixel] = aB === 4096 ? 4096 : (inputBB[pixel] * 4096) / (4096 - aB);
                    }
                    break;
                case ArithmeticBlendMode.ColorBurn:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const aR = inputAR[pixel];
                        const aG = inputAG[pixel];
                        const aB = inputAB[pixel];
                        outputR[pixel] =
                            aR === 0 ? 0 : 4096 - ((4096 - inputBR[pixel]) * 4096) / aR;
                        outputG[pixel] =
                            aG === 0 ? 0 : 4096 - ((4096 - inputBG[pixel]) * 4096) / aG;
                        outputB[pixel] =
                            aB === 0 ? 0 : 4096 - ((4096 - inputBB[pixel]) * 4096) / aB;
                    }
                    break;
                case ArithmeticBlendMode.Min:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const aR = inputAR[pixel];
                        const aG = inputAG[pixel];
                        const aB = inputAB[pixel];
                        const bR = inputBR[pixel];
                        const bG = inputBG[pixel];
                        const bB = inputBB[pixel];
                        outputR[pixel] = Math.min(aR, bR);
                        outputG[pixel] = Math.min(aG, bG);
                        outputB[pixel] = Math.min(aB, bB);
                    }
                    break;
                case ArithmeticBlendMode.Max:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const aR = inputAR[pixel];
                        const aG = inputAG[pixel];
                        const aB = inputAB[pixel];
                        const bR = inputBR[pixel];
                        const bG = inputBG[pixel];
                        const bB = inputBB[pixel];
                        outputR[pixel] = Math.max(aR, bR);
                        outputG[pixel] = Math.max(aG, bG);
                        outputB[pixel] = Math.max(aB, bB);
                    }
                    break;
                case ArithmeticBlendMode.Difference:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const aR = inputAR[pixel];
                        const aG = inputAG[pixel];
                        const aB = inputAB[pixel];
                        const bR = inputBR[pixel];
                        const bG = inputBG[pixel];
                        const bB = inputBB[pixel];
                        outputR[pixel] = bR < aR ? aR - bR : bR - aR;
                        outputG[pixel] = bG < aG ? aG - bG : bG - aG;
                        outputB[pixel] = bB < aB ? aB - bB : bB - aB;
                    }
                    break;
                case ArithmeticBlendMode.Exclusion:
                    for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                        const aR = inputBR[pixel];
                        const aG = inputBG[pixel];
                        const aB = inputBB[pixel];
                        const bR = inputAR[pixel];
                        const bG = inputAG[pixel];
                        const bB = inputAB[pixel];
                        outputR[pixel] = aR + bR - (aR * bR) / 2048;
                        outputG[pixel] = aG + bG - (aG * bG) / 2048;
                        outputB[pixel] = aB + bB - (aB * bB) / 2048;
                    }
                    break;
            }
        }
        return output;
    }
}
