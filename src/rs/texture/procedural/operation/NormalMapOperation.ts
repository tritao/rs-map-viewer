import { ByteBuffer } from "../../../io/ByteBuffer";
import { i32, idiv, imul, maskIndex, mulShift } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class NormalMapOperation extends TextureOperation {
    strengthQ12: number = 4096;
    unsignedOutput: boolean = true;

    constructor() {
        super(1, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 1) {
            this.strengthQ12 = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.unsignedOutput = buffer.readUnsignedByte() === 1;
        }
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache is not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            const prevHeightRow = this.getMonochromeInput(
                textureGenerator,
                0,
                maskIndex(line - 1, textureGenerator.heightMask),
            );
            const heightRow = this.getMonochromeInput(textureGenerator, 0, line);
            const nextHeightRow = this.getMonochromeInput(
                textureGenerator,
                0,
                maskIndex(line + 1, textureGenerator.heightMask),
            );
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];
            for (let x = 0; x < textureGenerator.width; x++) {
                const dyScaled = imul(this.strengthQ12, nextHeightRow[x] - prevHeightRow[x]);
                const dxScaled = imul(
                    this.strengthQ12,
                    heightRow[maskIndex(x + 1, textureGenerator.widthMask)] -
                        heightRow[maskIndex(x - 1, textureGenerator.widthMask)],
                );
                const dyQ12 = dyScaled >> 12;
                const dxQ12 = dxScaled >> 12;
                const dySquaredQ12 = mulShift(dyQ12, dyQ12, 12);
                const dxSquaredQ12 = mulShift(dxQ12, dxQ12, 12);
                const normalizerQ12 = i32(
                    Math.sqrt((dySquaredQ12 + dxSquaredQ12 + 4096) / 4096.0) * 4096.0,
                );
                let red: number;
                let green: number;
                let blue: number;
                if (normalizerQ12 === 0) {
                    red = 0;
                    green = 0;
                    blue = 0;
                } else {
                    red = idiv(dxScaled, normalizerQ12);
                    green = idiv(dyScaled, normalizerQ12);
                    blue = idiv(16777216, normalizerQ12);
                }
                if (this.unsignedOutput) {
                    red = (red >> 1) + 2048;
                    green = (green >> 1) + 2048;
                    blue = (blue >> 1) + 2048;
                }
                outputR[x] = red;
                outputG[x] = green;
                outputB[x] = blue;
            }
        }
        return output;
    }
}
