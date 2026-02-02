import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

enum DiagonalGradientDistanceMode {
    DiagonalDifference = 0,
    RadialDistance = 1,
}

enum DiagonalGradientWaveformMode {
    Sine = 0,
    Sawtooth = 1,
    Triangle = 2,
}

export class DiagonalGradientOperation extends TextureOperation {
    // 0: diagonal distance (x - y), 1: radial distance from center
    distanceMode: DiagonalGradientDistanceMode = DiagonalGradientDistanceMode.DiagonalDifference;
    // 0: sine, 1: sawtooth (raw phase), 2: triangle
    waveformMode: DiagonalGradientWaveformMode = DiagonalGradientWaveformMode.Sine;
    frequency = 1;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.distanceMode = buffer.readUnsignedByte() as DiagonalGradientDistanceMode;
        } else if (field === 1) {
            this.waveformMode = buffer.readUnsignedByte() as DiagonalGradientWaveformMode;
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
            const yQ12 = textureGenerator.verticalGradient[line];
            const yCenteredHalfQ12 = (yQ12 - 2048) >> 1;
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const xQ12 = textureGenerator.horizontalGradient[pixel];
                const xCenteredHalfQ12 = (xQ12 - 2048) >> 1;
                let phaseQ12: number;
                if (this.distanceMode === DiagonalGradientDistanceMode.DiagonalDifference) {
                    phaseQ12 = (xQ12 - yQ12) * this.frequency;
                } else {
                    const radiusSqQ12 =
                        (yCenteredHalfQ12 * yCenteredHalfQ12 + xCenteredHalfQ12 * xCenteredHalfQ12) >>
                        12;
                    phaseQ12 = (4096.0 * Math.sqrt(radiusSqQ12 / 4096.0)) | 0;
                    phaseQ12 = (this.frequency * phaseQ12 * 3.141592653589793) | 0;
                }
                phaseQ12 -= phaseQ12 & ~0xfff;
                if (this.waveformMode === DiagonalGradientWaveformMode.Sine) {
                    phaseQ12 = (TextureGenerator.SINE[(phaseQ12 >> 4) & 0xff] + 4096) >> 1;
                } else if (this.waveformMode === DiagonalGradientWaveformMode.Triangle) {
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
