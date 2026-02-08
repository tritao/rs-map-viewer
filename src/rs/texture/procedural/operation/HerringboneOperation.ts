import { ByteBuffer } from "../../../io/ByteBuffer";
import { idiv, mulShift } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class HerringboneOperation extends TextureOperation {
    scaleX: number = 1;
    scaleY: number = 1;

    gapQ12: number = 204;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.scaleX = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.scaleY = buffer.readUnsignedByte();
        } else if (field === 2) {
            this.gapQ12 = buffer.readUnsignedShort();
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            for (let x = 0; x < textureGenerator.width; x++) {
                const xQ12 = textureGenerator.horizontalGradient[x];
                const yQ12 = textureGenerator.verticalGradient[line];

                const xTileIndex = mulShift(this.scaleX, xQ12, 12);
                const yTileIndex = mulShift(this.scaleY, yQ12, 12);

                const xFracQ12 = this.scaleX * (xQ12 % idiv(4096, this.scaleX));
                const yFracQ12 = this.scaleY * (yQ12 % idiv(4096, this.scaleY));

                if (yFracQ12 < this.gapQ12) {
                    let phase = xTileIndex - yTileIndex;
                    for (; phase < 0; phase += 4) {}
                    while (phase > 3) {
                        phase -= 4;
                    }
                    if (phase !== 1) {
                        output[x] = 0;
                        continue;
                    }
                    if (xFracQ12 < this.gapQ12) {
                        output[x] = 0;
                        continue;
                    }
                }
                if (xFracQ12 < this.gapQ12) {
                    let phase = xTileIndex - yTileIndex;
                    for (; phase < 0; phase += 4) {}
                    while (phase > 3) {
                        phase -= 4;
                    }
                    if (phase > 0) {
                        output[x] = 0;
                        continue;
                    }
                }
                output[x] = 4096;
            }
        }
        return output;
    }
}
