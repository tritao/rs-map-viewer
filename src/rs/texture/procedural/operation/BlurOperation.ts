import { ByteBuffer } from "../../../io/ByteBuffer";
import { idiv, imul, maskIndex } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class BlurOperation extends TextureOperation {
    hExtent: number = 1;
    vExtent: number = 1;

    constructor() {
        super(1, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.hExtent = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.vExtent = buffer.readUnsignedByte();
        } else if (field === 2) {
            this.isMonochrome = buffer.readUnsignedByte() === 1;
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const nPasses = 1 + (this.vExtent + this.vExtent);
            const invPasses = idiv(65536, nPasses);
            const nPixels = 1 + this.hExtent + this.hExtent;
            const invPixels = idiv(65536, nPixels);
            const passes: Int32Array[] = [];
            for (let pass = -this.vExtent + line; pass <= line + this.vExtent; pass++) {
                const input = this.getMonochromeInput(
                    textureGenerator,
                    0,
                    pass & textureGenerator.heightMask,
                );
                const passOut = new Int32Array(textureGenerator.width);
                let sum = 0;
                for (let pixel = -this.hExtent; pixel <= this.hExtent; pixel++) {
                    sum += input[pixel & textureGenerator.widthMask];
                }
                let ptr = 0;
                while (ptr < textureGenerator.width) {
                    passOut[ptr] = idiv(imul(sum, invPixels), 65536);
                    sum -= input[maskIndex(ptr - this.hExtent, textureGenerator.widthMask)];
                    ptr++;
                    sum += input[maskIndex(ptr + this.hExtent, textureGenerator.widthMask)];
                }
                passes.push(passOut);
            }
            /* Now average over passes */
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                let sum = 0;
                for (const passOut of passes) {
                    sum += passOut[pixel];
                }
                output[pixel] = idiv(imul(sum, invPasses), 65536);
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
            const nPasses = 1 + (this.vExtent + this.vExtent);
            const invPasses = idiv(65536, nPasses);
            const nPixels = 1 + this.hExtent + this.hExtent;
            const invPixels = idiv(65536, nPixels);
            const passes: Int32Array[][] = [];
            for (let pass = -this.vExtent + line; pass <= line + this.vExtent; pass++) {
                const input = this.getColourInput(
                    textureGenerator,
                    0,
                    pass & textureGenerator.heightMask,
                );
                const passOut = [
                    new Int32Array(textureGenerator.width),
                    new Int32Array(textureGenerator.width),
                    new Int32Array(textureGenerator.width),
                ];
                let sumR = 0;
                let sumG = 0;
                let sumB = 0;
                for (let pixel = -this.hExtent; pixel <= this.hExtent; pixel++) {
                    sumR += input[0][pixel & textureGenerator.widthMask];
                    sumG += input[1][pixel & textureGenerator.widthMask];
                    sumB += input[2][pixel & textureGenerator.widthMask];
                }
                let ptr = 0;
                while (ptr < textureGenerator.width) {
                    passOut[0][ptr] = idiv(imul(sumR, invPixels), 65536);
                    passOut[1][ptr] = idiv(imul(sumG, invPixels), 65536);
                    passOut[2][ptr] = idiv(imul(sumB, invPixels), 65536);
                    const idxSub = maskIndex(ptr - this.hExtent, textureGenerator.widthMask);
                    sumR -= input[0][idxSub];
                    sumG -= input[1][idxSub];
                    sumB -= input[2][idxSub];
                    ptr++;
                    const idxAdd = maskIndex(ptr + this.hExtent, textureGenerator.widthMask);
                    sumR += input[0][idxAdd];
                    sumG += input[1][idxAdd];
                    sumB += input[2][idxAdd];
                }
                passes.push(passOut);
            }
            /* Now average over passes */
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                let sumR = 0;
                let sumG = 0;
                let sumB = 0;
                for (const passOut of passes) {
                    sumR += passOut[0][pixel];
                    sumG += passOut[1][pixel];
                    sumB += passOut[2][pixel];
                }
                output[0][pixel] = idiv(imul(sumR, invPasses), 65536);
                output[1][pixel] = idiv(imul(sumG, invPasses), 65536);
                output[2][pixel] = idiv(imul(sumB, invPasses), 65536);
            }
        }
        return output;
    }
}
