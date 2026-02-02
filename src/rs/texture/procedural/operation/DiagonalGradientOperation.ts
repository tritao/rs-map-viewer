import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class DiagonalGradientOperation extends TextureOperation {
    // 0: diagonal distance (x - y), 1: radial distance from center
    distanceMode = 0;
    // 0: sine, 1: sawtooth (raw phase), 2: triangle
    waveformMode = 0;
    frequency = 1;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.distanceMode = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.waveformMode = buffer.readUnsignedByte();
        } else if (field === 3) {
            this.frequency = buffer.readUnsignedByte();
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const y = textureGenerator.verticalGradient[line];
            const yCenteredHalf = (y - 2048) >> 1;
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const x = textureGenerator.horizontalGradient[pixel];
                const xCenteredHalf = (x - 2048) >> 1;
                let phaseQ12: number;
                if (this.distanceMode === 0) {
                    phaseQ12 = (x - y) * this.frequency;
                } else {
                    const radiusSqQ12 =
                        (yCenteredHalf * yCenteredHalf + xCenteredHalf * xCenteredHalf) >> 12;
                    phaseQ12 = (4096.0 * Math.sqrt(radiusSqQ12 / 4096.0)) | 0;
                    phaseQ12 = (this.frequency * phaseQ12 * 3.141592653589793) | 0;
                }
                phaseQ12 -= phaseQ12 & ~0xfff;
                if (this.waveformMode === 0) {
                    phaseQ12 = (TextureGenerator.SINE[(phaseQ12 >> 4) & 0xff] + 4096) >> 1;
                } else if (this.waveformMode === 2) {
                    phaseQ12 -= 2048;
                    if (phaseQ12 < 0) {
                        phaseQ12 = -phaseQ12;
                    }
                    phaseQ12 = (2048 - phaseQ12) << 1;
                }
                output[pixel] = phaseQ12;
            }
        }
        return output;
    }
}
