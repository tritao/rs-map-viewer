import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class EmbossOperation extends TextureOperation {
    // Gradient scale factor (applied in screen-space)
    strengthQ12 = 4096;
    // Light direction in spherical coordinates (Q12 angles)
    lightAzimuthQ12 = 3216;
    lightElevationQ12 = 3216;

    lightDirQ12 = new Int32Array(3);

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
        this.lightDirQ12[0] =
            4096 * (cosElevation * Math.sin(Math.fround(this.lightAzimuthQ12 / 4096)));
        this.lightDirQ12[1] =
            4096 * (cosElevation * Math.cos(Math.fround(this.lightAzimuthQ12 / 4096)));
        this.lightDirQ12[2] = 4096 * Math.sin(Math.fround(this.lightElevationQ12 / 4096));
        const t0 = (this.lightDirQ12[0] * this.lightDirQ12[0]) >> 12;
        const t1 = (this.lightDirQ12[1] * this.lightDirQ12[1]) >> 12;
        const t2 = (this.lightDirQ12[2] * this.lightDirQ12[2]) >> 12;
        const scale = (Math.sqrt((t0 + t1 + t2) >> 12) * 4096) | 0;
        if (scale !== 0) {
            this.lightDirQ12[0] = (this.lightDirQ12[0] << 12) / scale;
            this.lightDirQ12[1] = (this.lightDirQ12[1] << 12) / scale;
            this.lightDirQ12[2] = (this.lightDirQ12[2] << 12) / scale;
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const widthMult = (this.strengthQ12 * textureGenerator.widthTimes32) >> 12;
            const prevLine = this.getMonochromeInput(
                textureGenerator,
                0,
                (line - 1) & textureGenerator.heightMask,
            );
            const currLine = this.getMonochromeInput(textureGenerator, 0, line);
            const nextLine = this.getMonochromeInput(
                textureGenerator,
                0,
                (line + 1) & textureGenerator.heightMask,
            );
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const prevPixel = currLine[(pixel - 1) & textureGenerator.widthMask];
                const nextPixel = currLine[(pixel + 1) & textureGenerator.widthMask];

                const gradY = (widthMult * (nextLine[pixel] - prevLine[pixel])) >> 12;
                const gradX = (widthMult * (prevPixel - nextPixel)) >> 12;

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
                const invMagnitude =
                    TextureGenerator.INVERSE_SQUARE_ROOT[
                        gradXAbs + (((gradYAbs + 1) * gradYAbs) >> 1)
                    ] & 0xff;
                let v0 = (invMagnitude * gradX) >> 8;
                let v1 = (invMagnitude * gradY) >> 8;
                let v2 = (invMagnitude * 4096) >> 8;
                v0 = (this.lightDirQ12[0] * v0) >> 12;
                v1 = (this.lightDirQ12[1] * v1) >> 12;
                v2 = (this.lightDirQ12[2] * v2) >> 12;
                output[pixel] = v0 + v1 + v2;
            }
        }
        return output;
    }
}
