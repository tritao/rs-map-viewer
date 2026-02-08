import { ByteBuffer } from "../../../io/ByteBuffer";
import { absI32, idiv, shl } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class WeaveOperation extends TextureOperation {
    strandHalfThicknessQ12 = 585;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.strandHalfThicknessQ12 = buffer.readUnsignedShort();
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const yQ12 = textureGenerator.verticalGradient[line];
            const denomQ12 = 2048 - this.strandHalfThicknessQ12;
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const xQ12 = textureGenerator.horizontalGradient[pixel];
                if (
                    xQ12 > this.strandHalfThicknessQ12 &&
                    4096 - this.strandHalfThicknessQ12 > xQ12 &&
                    yQ12 > 2048 - this.strandHalfThicknessQ12 &&
                    yQ12 < this.strandHalfThicknessQ12 + 2048
                ) {
                    let distFromCenterX = absI32(2048 - xQ12);
                    distFromCenterX = idiv(shl(distFromCenterX, 12), denomQ12);
                    output[pixel] = 4096 - distFromCenterX;
                } else if (
                    2048 - this.strandHalfThicknessQ12 < xQ12 &&
                    2048 + this.strandHalfThicknessQ12 > xQ12
                ) {
                    let distFromCenterY = absI32(yQ12 - 2048);
                    distFromCenterY -= this.strandHalfThicknessQ12;
                    output[pixel] = idiv(shl(distFromCenterY, 12), denomQ12);
                } else if (
                    this.strandHalfThicknessQ12 > yQ12 ||
                    yQ12 > 4096 - this.strandHalfThicknessQ12
                ) {
                    let distFromCenterX = absI32(xQ12 - 2048);
                    distFromCenterX -= this.strandHalfThicknessQ12;
                    output[pixel] = idiv(shl(distFromCenterX, 12), denomQ12);
                } else if (
                    xQ12 < this.strandHalfThicknessQ12 ||
                    4096 - this.strandHalfThicknessQ12 < xQ12
                ) {
                    let distFromCenterY = absI32(2048 - yQ12);
                    distFromCenterY = idiv(shl(distFromCenterY, 12), denomQ12);
                    output[pixel] = 4096 - distFromCenterY;
                } else {
                    output[pixel] = 0;
                }
            }
        }
        return output;
    }
}
