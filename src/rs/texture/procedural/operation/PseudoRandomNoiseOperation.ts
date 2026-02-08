import { add, i32, idiv, imul, shl } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class PseudoRandomNoiseOperation extends TextureOperation {
    static noise(x: number, y: number): number {
        // Mirrors Java (TextureOpPseudoRandomNoise.method3103):
        //   int n = x + y*57;
        //   n ^= n << 1;
        //   return 4096 - (((((789221 + 15731*(n*n)) * n + 1376312589) & 0x7fffffff) / 262144));
        let n = add(x, imul(y, 57));
        n = i32(n ^ shl(n, 1));

        const nn = imul(n, n);
        const t = add(imul(add(789221, imul(15731, nn)), n), 1376312589);
        const masked = t & 0x7fffffff;
        return 4096 - idiv(masked, 262144);
    }

    constructor() {
        super(0, true);
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const vertGradient = textureGenerator.verticalGradient[line];
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                const horzGradient = textureGenerator.horizontalGradient[pixel];
                output[pixel] = PseudoRandomNoiseOperation.noise(horzGradient, vertGradient) % 4096;
            }
        }
        return output;
    }
}
