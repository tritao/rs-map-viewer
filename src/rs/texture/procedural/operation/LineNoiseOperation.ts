import JavaRandom from "java-random";

import { nextIntJagex } from "../../../../util/MathUtil";
import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class LineNoiseOperation extends TextureOperation {
    seed = 0;
    lineCount = 2000;
    lineLength = 16;
    angleCenterQ12 = 0;
    angleRangeQ12 = 4096;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.seed = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.lineCount = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.lineLength = buffer.readUnsignedByte();
        } else if (field === 3) {
            this.angleCenterQ12 = buffer.readUnsignedShort();
        } else if (field === 4) {
            this.angleRangeQ12 = buffer.readUnsignedShort();
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const halfAngleRangeQ12 = this.angleRangeQ12 >> 1;
            const pixelsByX = this.monochromeImageCache.getAll();
            const random = new JavaRandom(this.seed);
            for (let i = 0; i < this.lineCount; i++) {
                const angleQ12 =
                    this.angleRangeQ12 > 0
                        ? this.angleCenterQ12 -
                          halfAngleRangeQ12 +
                          nextIntJagex(random, this.angleRangeQ12)
                        : this.angleCenterQ12;
                const angleIndex = (angleQ12 >> 4) & 0xff;

                let startX = nextIntJagex(random, textureGenerator.width);
                let startY = nextIntJagex(random, textureGenerator.height);
                let endX = ((TextureGenerator.COSINE[angleIndex] * this.lineLength) >> 12) + startX;
                let endY = ((TextureGenerator.SINE[angleIndex] * this.lineLength) >> 12) + startY;
                let absDx = endX - startX;
                let absDy = endY - startY;
                if (absDx !== 0 || absDy !== 0) {
                    if (absDx < 0) {
                        absDx = -absDx;
                    }
                    if (absDy < 0) {
                        absDy = -absDy;
                    }
                    const isSteep = absDx < absDy;
                    if (isSteep) {
                        const startXPrev = startX;
                        const endXPrev = endX;
                        startX = startY;
                        startY = startXPrev;
                        endX = endY;
                        endY = endXPrev;
                    }
                    if (startX > endX) {
                        const startXPrev = startX;
                        const startYPrev = startY;
                        startX = endX;
                        startY = endY;
                        endX = startXPrev;
                        endY = startYPrev;
                    }
                    const dx = endX - startX;
                    let dy = endY - startY;
                    let y = startY;
                    if (dy < 0) {
                        dy = -dy;
                    }
                    let error = (-dx / 2) | 0;
                    const valueStep = (2048 / dx) | 0;
                    const intensityJitter = 1024 - (nextIntJagex(random, 4096) >> 2);
                    const intensityBase = 1024 + intensityJitter;
                    const yStep = endY <= startY ? -1 : 1;

                    for (let x = startX; x < endX; x++) {
                        error += dy;
                        const value = valueStep * (x - startX) + intensityBase;
                        const yMasked = y & textureGenerator.heightMask;
                        if (error > 0) {
                            y += yStep;
                            error = error - dx;
                        }
                        const xMasked = x & textureGenerator.widthMask;
                        if (!isSteep) {
                            pixelsByX[xMasked][yMasked] = value;
                        } else {
                            pixelsByX[yMasked][xMasked] = value;
                        }
                    }
                }
            }
        }
        return output;
    }
}
