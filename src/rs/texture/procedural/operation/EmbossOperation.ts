import { ByteBuffer } from "../../../io/ByteBuffer";
import { i32, idiv, maskIndex, mulShift, shl } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class EmbossOperation extends TextureOperation {
    // Gradient scale factor (applied in screen-space)
    strengthQ12 = 4096;
    // Light direction in spherical coordinates (Q12 angles)
    lightAzimuthQ12 = 3216;
    lightElevationQ12 = 3216;

    lightDirectionQ12 = new Int32Array(3);

    constructor() {
        super(1, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.strengthQ12 = buffer.readUnsignedShort();
        } else if (field === 1) {
            this.lightAzimuthQ12 = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.lightElevationQ12 = buffer.readUnsignedShort();
        }
    }

    override init() {
        const cosElevation = Math.cos(Math.fround(this.lightElevationQ12 / 4096));
        this.lightDirectionQ12[0] =
            4096 * (cosElevation * Math.sin(Math.fround(this.lightAzimuthQ12 / 4096)));
        this.lightDirectionQ12[1] =
            4096 * (cosElevation * Math.cos(Math.fround(this.lightAzimuthQ12 / 4096)));
        this.lightDirectionQ12[2] = 4096 * Math.sin(Math.fround(this.lightElevationQ12 / 4096));
        const xSqQ12 = mulShift(this.lightDirectionQ12[0], this.lightDirectionQ12[0], 12);
        const ySqQ12 = mulShift(this.lightDirectionQ12[1], this.lightDirectionQ12[1], 12);
        const zSqQ12 = mulShift(this.lightDirectionQ12[2], this.lightDirectionQ12[2], 12);
        const magnitudeSqQ12 = xSqQ12 + ySqQ12 + zSqQ12;
        const magnitudeQ12 = i32(Math.sqrt(magnitudeSqQ12 / 4096) * 4096);
        if (magnitudeQ12 !== 0) {
            this.lightDirectionQ12[0] = idiv(shl(this.lightDirectionQ12[0], 12), magnitudeQ12);
            this.lightDirectionQ12[1] = idiv(shl(this.lightDirectionQ12[1], 12), magnitudeQ12);
            this.lightDirectionQ12[2] = idiv(shl(this.lightDirectionQ12[2], 12), magnitudeQ12);
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const widthMult = mulShift(this.strengthQ12, textureGenerator.widthTimes32, 12);
            const prevLine = this.getMonochromeInput(
                textureGenerator,
                0,
                maskIndex(line - 1, textureGenerator.heightMask),
            );
            const currLine = this.getMonochromeInput(textureGenerator, 0, line);
            const nextLine = this.getMonochromeInput(
                textureGenerator,
                0,
                maskIndex(line + 1, textureGenerator.heightMask),
            );
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const prevPixel = currLine[maskIndex(pixel - 1, textureGenerator.widthMask)];
                const nextPixel = currLine[maskIndex(pixel + 1, textureGenerator.widthMask)];

                const deltaY = nextLine[pixel] - prevLine[pixel];
                const deltaX = prevPixel - nextPixel;
                const gradY = mulShift(widthMult, deltaY, 12);
                const gradX = mulShift(widthMult, deltaX, 12);

                let gradXAbs = gradX >> 4;
                let gradYAbs = gradY >> 4;
                if (gradXAbs < 0) {
                    gradXAbs = -gradXAbs;
                }
                if (gradXAbs > 255) {
                    gradXAbs = 255;
                }
                if (gradYAbs < 0) {
                    gradYAbs = -gradYAbs;
                }
                if (gradYAbs > 255) {
                    gradYAbs = 255;
                }
                const triProduct = (gradYAbs + 1) * gradYAbs;
                const tri = triProduct >> 1;
                const invMagnitude = textureGenerator.inverseSquareRoot[gradXAbs + tri] & 0xff;
                const normalXQ12 = mulShift(invMagnitude, gradX, 8);
                const normalYQ12 = mulShift(invMagnitude, gradY, 8);
                const normalZNumerator = invMagnitude * 4096;
                const normalZQ12 = normalZNumerator >> 8;
                const lightDotXQ12 = mulShift(this.lightDirectionQ12[0], normalXQ12, 12);
                const lightDotYQ12 = mulShift(this.lightDirectionQ12[1], normalYQ12, 12);
                const lightDotZQ12 = mulShift(this.lightDirectionQ12[2], normalZQ12, 12);
                output[pixel] = lightDotXQ12 + lightDotYQ12 + lightDotZQ12;
            }
        }
        return output;
    }
}
