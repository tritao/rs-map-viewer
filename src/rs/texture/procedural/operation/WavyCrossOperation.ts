import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class WavyCrossOperation extends TextureOperation {
    // Offsets for the two diagonal bands (wrapped into [-2048, 2048])
    band0OffsetX = 2048;
    band0OffsetY = 0;
    band1OffsetX = 0;
    band1OffsetY = 2048;

    // Controls the cosine phase and band half-width scaling (all Q12 fixed-point)
    phaseScaleQ12 = 12288;
    widthScaleQ12 = 4096;
    widthNormalizationQ12 = 8192;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.band0OffsetX = buffer.readUnsignedShort();
        } else if (field === 1) {
            this.band0OffsetY = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.band1OffsetX = buffer.readUnsignedShort();
        } else if (field === 3) {
            this.band1OffsetY = buffer.readUnsignedShort();
        } else if (field === 4) {
            this.phaseScaleQ12 = buffer.readUnsignedShort();
        } else if (field === 5) {
            this.widthScaleQ12 = buffer.readUnsignedShort();
        } else if (field === 6) {
            this.widthNormalizationQ12 = buffer.readUnsignedShort();
        }
    }

    isInWavyAntiDiagonalBand(x: number, y: number) {
        const phase = ((y - x) * this.phaseScaleQ12) >> 12;
        let halfWidth = TextureGenerator.COSINE[((phase * 255) >> 12) & 0xff];
        halfWidth = ((halfWidth << 12) / this.phaseScaleQ12) | 0;
        halfWidth = ((halfWidth << 12) / this.widthNormalizationQ12) | 0;
        halfWidth = (this.widthScaleQ12 * halfWidth) >> 12;
        const sum = x + y;
        return halfWidth > sum && -halfWidth < sum;
    }

    isInWavyDiagonalBand(x: number, y: number) {
        const phase = ((y + x) * this.phaseScaleQ12) >> 12;
        let halfWidth = TextureGenerator.COSINE[((phase * 255) >> 12) & 0xff];
        halfWidth = ((halfWidth << 12) / this.phaseScaleQ12) | 0;
        halfWidth = ((halfWidth << 12) / this.widthNormalizationQ12) | 0;
        halfWidth = (halfWidth * this.widthScaleQ12) >> 12;
        const diff = y - x;
        return halfWidth > diff && diff > -halfWidth;
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const local22 = textureGenerator.verticalGradient[line] - 2048;
            for (let x = 0; x < textureGenerator.width; x++) {
                const local33 = textureGenerator.horizontalGradient[x] - 2048;
                let local38 = local33 + this.band0OffsetX;
                local38 = local38 >= -2048 ? local38 : local38 + 4096;
                let local53 = local22 + this.band0OffsetY;
                local38 = local38 <= 2048 ? local38 : local38 - 4096;
                local53 = local53 >= -2048 ? local53 : local53 + 4096;
                local53 = local53 <= 2048 ? local53 : local53 - 4096;
                let local87 = local33 + this.band1OffsetX;
                let local92 = local22 + this.band1OffsetY;
                local87 = local87 >= -2048 ? local87 : local87 + 4096;
                local87 = local87 <= 2048 ? local87 : local87 - 4096;
                local92 = local92 >= -2048 ? local92 : local92 + 4096;
                local92 = local92 <= 2048 ? local92 : local92 - 4096;
                output[x] =
                    this.isInWavyAntiDiagonalBand(local38, local53) ||
                    this.isInWavyDiagonalBand(local87, local92)
                        ? 4096
                        : 0;
            }
        }
        return output;
    }
}
