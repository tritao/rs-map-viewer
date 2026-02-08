import { ByteBuffer } from "../../../io/ByteBuffer";
import { idiv, mulShift, shl } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class MandelbrotOperation extends TextureOperation {
    zoomQ12 = 1365;
    maxIterations = 20;
    centerXQ12 = 0;
    centerYQ12 = 0;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.zoomQ12 = buffer.readUnsignedShort();
        } else if (field === 1) {
            this.maxIterations = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.centerXQ12 = buffer.readUnsignedShort();
        } else if (field === 3) {
            this.centerYQ12 = buffer.readUnsignedShort();
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            for (let x = 0; x < textureGenerator.width; x++) {
                const cReQ12 =
                    this.centerXQ12 +
                    idiv(shl(textureGenerator.horizontalGradient[x], 12), this.zoomQ12);
                const cImQ12 =
                    this.centerYQ12 +
                    idiv(shl(textureGenerator.verticalGradient[line], 12), this.zoomQ12);

                let zImQ12 = cImQ12;
                let zReQ12 = cReQ12;
                let iter = 0;
                let zReSqQ12 = mulShift(cReQ12, cReQ12, 12);
                let zImSqQ12 = mulShift(cImQ12, cImQ12, 12);
                while (zReSqQ12 + zImSqQ12 < 16384 && iter < this.maxIterations) {
                    iter++;
                    const zImReQ12 = mulShift(zImQ12, zReQ12, 12);
                    zImQ12 = cImQ12 + zImReQ12 * 2;
                    zReQ12 = cReQ12 + zReSqQ12 - zImSqQ12;
                    zImSqQ12 = mulShift(zImQ12, zImQ12, 12);
                    zReSqQ12 = mulShift(zReQ12, zReQ12, 12);
                }
                output[x] =
                    iter >= this.maxIterations - 1 ? 0 : idiv(shl(iter, 12), this.maxIterations);
            }
        }
        return output;
    }
}
