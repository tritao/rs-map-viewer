import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class TrigWarpOperation extends TextureOperation {
    radiusMultiplierQ16: number = 32768;

    constructor() {
        super(3, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.radiusMultiplierQ16 = buffer.readUnsignedShort() << 4;
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
            const angleInput = this.getMonochromeInput(textureGenerator, 1, line);
            const radiusInput = this.getMonochromeInput(textureGenerator, 2, line);
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const angle = (angleInput[pixel] >> 4) & 0xff;
                const radius = (radiusInput[pixel] * this.radiusMultiplierQ16) >> 12;
                const dx = (textureGenerator.cosine[angle] * radius) >> 12;
                const dy = (textureGenerator.sine[angle] * radius) >> 12;
                const sampleX = (pixel + (dx >> 12)) & textureGenerator.widthMask;
                const sampleY = (line + (dy >> 12)) & textureGenerator.heightMask;
                const input = this.getMonochromeInput(textureGenerator, 0, sampleY);
                output[pixel] = input[sampleX];
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
            const angleInput = this.getMonochromeInput(textureGenerator, 1, line);
            const radiusInput = this.getMonochromeInput(textureGenerator, 2, line);
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const angle = ((angleInput[pixel] * 255) >> 12) & 0xff;
                const radius = (radiusInput[pixel] * this.radiusMultiplierQ16) >> 12;
                const dx = (textureGenerator.cosine[angle] * radius) >> 12;
                const dy = (textureGenerator.sine[angle] * radius) >> 12;
                const sampleX = (pixel + (dx >> 12)) & textureGenerator.widthMask;
                const sampleY = (line + (dy >> 12)) & textureGenerator.heightMask;
                const input = this.getColourInput(textureGenerator, 0, sampleY);
                outputR[pixel] = input[0][sampleX];
                outputG[pixel] = input[1][sampleX];
                outputB[pixel] = input[2][sampleX];
            }
        }
        return output;
    }
}
