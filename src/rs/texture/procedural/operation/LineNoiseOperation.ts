import JavaRandom from "../../../../util/JavaRandom";
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
            const pixelsByColumn = this.monochromeImageCache.getAll();
            const rng = new JavaRandom(this.seed);
            for (let lineIndex = 0; lineIndex < this.lineCount; lineIndex++) {
                const angleQ12 =
                    this.angleRangeQ12 > 0
                        ? this.angleCenterQ12 -
                          halfAngleRangeQ12 +
                          nextIntJagex(rng, this.angleRangeQ12)
                        : this.angleCenterQ12;
                const angleTableIndex = (angleQ12 >> 4) & 0xff;

                let startX = nextIntJagex(rng, textureGenerator.width);
                let startY = nextIntJagex(rng, textureGenerator.height);
                let endX =
                    ((textureGenerator.cosine[angleTableIndex] * this.lineLength) >> 12) + startX;
                let endY =
                    ((textureGenerator.sine[angleTableIndex] * this.lineLength) >> 12) + startY;
                let absDeltaX = endX - startX;
                let absDeltaY = endY - startY;
                if (absDeltaX !== 0 || absDeltaY !== 0) {
                    if (absDeltaX < 0) {
                        absDeltaX = -absDeltaX;
                    }
                    if (absDeltaY < 0) {
                        absDeltaY = -absDeltaY;
                    }
                    const isSteep = absDeltaX < absDeltaY;
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
                    const deltaX = endX - startX;
                    let deltaY = endY - startY;
                    let y = startY;
                    if (deltaY < 0) {
                        deltaY = -deltaY;
                    }
                    let error = (-deltaX / 2) | 0;
                    const valueStep = (2048 / deltaX) | 0;
                    const intensityJitter = 1024 - (nextIntJagex(rng, 4096) >> 2);
                    const intensityBase = 1024 + intensityJitter;
                    const yStep = endY <= startY ? -1 : 1;

                    for (let x = startX; x < endX; x++) {
                        error += deltaY;
                        const valueQ12 = valueStep * (x - startX) + intensityBase;
                        const yMasked = y & textureGenerator.heightMask;
                        if (error > 0) {
                            y += yStep;
                            error = error - deltaX;
                        }
                        const xMasked = x & textureGenerator.widthMask;
                        if (!isSteep) {
                            pixelsByColumn[xMasked][yMasked] = valueQ12;
                        } else {
                            pixelsByColumn[yMasked][xMasked] = valueQ12;
                        }
                    }
                }
            }
        }
        return output;
    }
}
