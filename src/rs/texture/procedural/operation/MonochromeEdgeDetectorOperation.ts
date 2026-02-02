import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class MonochromeEdgeDetectorOperation extends TextureOperation {
    strengthQ12: number = 4096;

    constructor() {
        super(1, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.strengthQ12 = buffer.readUnsignedShort();
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const prevInput = this.getMonochromeInput(
                textureGenerator,
                0,
                (line - 1) & textureGenerator.heightMask,
            );
            const input = this.getMonochromeInput(textureGenerator, 0, line);
            const nextInput = this.getMonochromeInput(
                textureGenerator,
                0,
                (line + 1) & textureGenerator.heightMask,
            );
            for (let x = 0; x < textureGenerator.width; x++) {
                const dyScaled = this.strengthQ12 * (nextInput[x] - prevInput[x]);
                const dxScaled =
                    this.strengthQ12 *
                    (input[(x + 1) & textureGenerator.widthMask] -
                        input[(x - 1) & textureGenerator.widthMask]);
                const dxQ12 = dxScaled >> 12;
                const dyQ12 = dyScaled >> 12;
                const dySquaredQ12 = (dyQ12 * dyQ12) >> 12;
                const dxSquaredQ12 = (dxQ12 * dxQ12) >> 12;
                const normalizerQ12 =
                    (Math.sqrt((dySquaredQ12 + dxSquaredQ12 + 4096) / 4096.0) * 4096.0) | 0;
                const invNormalizerQ24 = normalizerQ12 === 0 ? 0 : (16777216 / normalizerQ12) | 0;
                output[x] = 4096 - invNormalizerQ24;
            }
        }
        return output;
    }
}
