import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class SquareWaveformOperation extends TextureOperation {
    periodCount = 10;
    dutyCycleQ12 = 2048;
    direction = 0;

    pulseEndQ12!: Int32Array;
    segmentStartQ12!: Int32Array;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.periodCount = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.dutyCycleQ12 = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.direction = buffer.readUnsignedByte();
        }
    }

    override init() {
        this.pulseEndQ12 = new Int32Array(this.periodCount + 1);
        this.segmentStartQ12 = new Int32Array(this.periodCount + 1);

        let segmentStartQ12 = 0;
        const segmentSizeQ12 = (4096 / this.periodCount) | 0;
        const pulseWidthQ12 = (segmentSizeQ12 * this.dutyCycleQ12) >> 12;
        for (let periodIndex = 0; periodIndex < this.periodCount; periodIndex++) {
            this.segmentStartQ12[periodIndex] = segmentStartQ12;
            this.pulseEndQ12[periodIndex] = segmentStartQ12 + pulseWidthQ12;
            segmentStartQ12 += segmentSizeQ12;
        }
        this.segmentStartQ12[this.periodCount] = 4096;
        this.pulseEndQ12[this.periodCount] = this.pulseEndQ12[0] + 4096;
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const verticalGradient = textureGenerator.verticalGradient[line];
            if (this.direction === 0) {
                let outputValueQ12 = 0;
                for (let periodIndex = 0; periodIndex < this.periodCount; periodIndex++) {
                    if (
                        verticalGradient >= this.segmentStartQ12[periodIndex] &&
                        verticalGradient < this.segmentStartQ12[periodIndex + 1]
                    ) {
                        if (verticalGradient < this.pulseEndQ12[periodIndex]) {
                            outputValueQ12 = 4096;
                        }
                        break;
                    }
                }

                output.fill(outputValueQ12, 0, textureGenerator.width);
            } else {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    let phaseQ12 = 0;
                    let outputValueQ12 = 0;
                    const horizontalGradient = textureGenerator.horizontalGradient[pixel];
                    switch (this.direction) {
                        case 3:
                            phaseQ12 = ((horizontalGradient - verticalGradient) >> 1) + 2048;
                            break;
                        case 2:
                            phaseQ12 =
                                ((horizontalGradient - (4096 - verticalGradient)) >> 1) + 2048;
                            break;
                        case 1:
                            phaseQ12 = horizontalGradient;
                            break;
                    }
                    for (let periodIndex = 0; periodIndex < this.periodCount; periodIndex++) {
                        if (
                            phaseQ12 >= this.segmentStartQ12[periodIndex] &&
                            phaseQ12 < this.segmentStartQ12[periodIndex + 1]
                        ) {
                            if (phaseQ12 < this.pulseEndQ12[periodIndex]) {
                                outputValueQ12 = 4096;
                            }
                            break;
                        }
                    }
                    output[pixel] = outputValueQ12;
                }
            }
        }
        return output;
    }
}
