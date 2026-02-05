import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class TextureSourceOperation extends TextureOperation {
    textureId: number = -1;

    pixels?: Int32Array;
    width: number = 0;
    height: number = 0;

    constructor() {
        super(0, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.textureId = buffer.readUnsignedShort();
        }
    }

    override initCaches(textureGenerator: TextureGenerator, width: number, height: number): void {
        super.initCaches(textureGenerator, width, height);
        if (this.textureId >= 0) {
            const width = textureGenerator.textureLoader.isSmall(this.textureId) ? 64 : 128;
            this.pixels = textureGenerator.textureLoader.tryGetPixelsRgb(
                this.textureId,
                width,
                false,
                1.0,
            );
            this.width = width;
            this.height = width;
        }
    }

    override clearCaches(): void {
        super.clearCaches();
        this.pixels = undefined;
    }

    override getTextureId(): number {
        return this.textureId;
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache is not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            const pixels = this.pixels;
            if (!pixels || this.width <= 0 || this.height <= 0) {
                output[0].fill(0);
                output[1].fill(0);
                output[2].fill(0);
                return output;
            }
            let start =
                (textureGenerator.height === this.height
                    ? line
                    : ((this.height * line) / textureGenerator.height) | 0) * this.width;
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];

            if (textureGenerator.width === this.width) {
                for (let x = 0; x < textureGenerator.width; x++) {
                    const value = pixels[start++];
                    outputB[x] = (value & 0xff) << 4;
                    outputG[x] = (value & 0xff00) >> 4;
                    outputR[x] = (value & 0xff0000) >> 12;
                }
            } else {
                for (let x = 0; x < textureGenerator.width; x++) {
                    const idx = ((this.width * x) / textureGenerator.width) | 0;
                    const value = pixels[idx + start];
                    outputB[x] = (value & 0xff) << 4;
                    outputG[x] = (value & 0xff00) >> 4;
                    outputR[x] = (value & 0xff0000) >> 12;
                }
            }
        }
        return output;
    }
}
