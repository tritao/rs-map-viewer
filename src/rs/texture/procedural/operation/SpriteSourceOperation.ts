import { ByteBuffer } from "../../../io/ByteBuffer";
import { idiv } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class SpriteSourceOperation extends TextureOperation {
    spriteId: number = -1;

    pixels?: Int32Array;
    width: number = 0;
    height: number = 0;

    constructor() {
        super(0, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.spriteId = buffer.readUnsignedShort();
        }
    }

    override getSpriteId(): number {
        return this.spriteId;
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            if (
                !this.loadSprite(textureGenerator) ||
                !this.pixels ||
                this.width <= 0 ||
                this.height <= 0
            ) {
                output[0].fill(0);
                output[1].fill(0);
                output[2].fill(0);
                return output;
            }

            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];

            let offset =
                this.width *
                (textureGenerator.height === this.height
                    ? line
                    : idiv(line * this.height, textureGenerator.height));

            if (textureGenerator.width === this.width) {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const value = this.pixels[offset++];
                    outputB[pixel] = (value << 4) & 0xff0;
                    outputG[pixel] = (value >> 4) & 0xff0;
                    outputR[pixel] = (value & 0xff0000) >> 12;
                }
            } else {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const srcX = idiv(this.width * pixel, textureGenerator.width);
                    const value = this.pixels[offset + srcX];
                    outputB[pixel] = (value << 4) & 0xff0;
                    outputG[pixel] = (value & 0xff00) >> 4;
                    outputR[pixel] = (value >> 12) & 0xff0;
                }
            }
        }
        return output;
    }

    loadSprite(textureGenerator: TextureGenerator): boolean {
        if (this.pixels) {
            return true;
        }
        if (this.spriteId >= 0) {
            const sprite = textureGenerator.tryLoadSprite(this.spriteId);
            if (!sprite) {
                return false;
            }
            sprite.normalize();

            this.pixels = sprite.getPixelsRgb();
            this.width = sprite.width;
            this.height = sprite.height;
            return true;
        }

        return false;
    }
}
