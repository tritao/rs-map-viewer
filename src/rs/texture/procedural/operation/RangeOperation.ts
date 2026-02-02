import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class RangeOperation extends TextureOperation {
    minOutputQ12 = 1024;
    maxOutputQ12 = 3072;

    outputRangeQ12 = this.maxOutputQ12 - this.minOutputQ12;

    constructor() {
        super(1, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.minOutputQ12 = buffer.readUnsignedShort();
        } else if (field === 1) {
            this.maxOutputQ12 = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.isMonochrome = buffer.readUnsignedByte() === 1;
        }
    }

    override init() {
        this.outputRangeQ12 = this.maxOutputQ12 - this.minOutputQ12;
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const input = this.getMonochromeInput(textureGenerator, 0, line);
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                output[pixel] = ((this.outputRangeQ12 * input[pixel]) >> 12) + this.minOutputQ12;
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
            const input = this.getColourInput(textureGenerator, 0, line);
            const inputR = input[0];
            const inputG = input[1];
            const inputB = input[2];
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                outputR[pixel] = ((this.outputRangeQ12 * inputR[pixel]) >> 12) + this.minOutputQ12;
                outputG[pixel] = ((this.outputRangeQ12 * inputG[pixel]) >> 12) + this.minOutputQ12;
                outputB[pixel] = ((this.outputRangeQ12 * inputB[pixel]) >> 12) + this.minOutputQ12;
            }
        }
        return output;
    }
}
