import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class HslOperation extends TextureOperation {
    deltaHue = 0;
    deltaSaturation = 0;
    deltaLightness = 0;

    hue = 0;
    saturation = 0;
    lightness = 0;

    rgbR = 0;
    rgbG = 0;
    rgbB = 0;

    constructor() {
        super(1, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.deltaHue = buffer.readSignedShort();
        } else if (field === 1) {
            // TODO: check if this is correct
            this.deltaSaturation = ((buffer.readByte() << 12) / 100) | 0;
        } else if (field === 2) {
            this.deltaLightness = ((buffer.readByte() << 12) / 100) | 0;
        }
    }

    setHsl(r: number, g: number, b: number): void {
        const maxValue = Math.max(r, g, b);
        const minValue = Math.min(r, g, b);
        const delta = maxValue - minValue;
        this.lightness = ((maxValue + minValue) / 2) | 0;
        if (delta > 0) {
            const invR = ((maxValue - r) << 12) / delta;
            const invG = ((maxValue - g) << 12) / delta;
            const invB = ((maxValue - b) << 12) / delta;
            if (r === maxValue) {
                this.hue = g === minValue ? invB + 0x5000 : 4096 - invG;
            } else if (g === maxValue) {
                this.hue = b === minValue ? invR + 4096 : 0x3000 - invB;
            } else {
                this.hue = minValue === r ? invG + 0x3000 : 0x5000 - invR;
            }
            this.hue = (this.hue / 6) | 0;
        } else {
            this.hue = 0;
        }
        if (this.lightness > 0 && this.lightness < 4096) {
            this.saturation =
                (delta << 12) /
                (this.lightness > 2048 ? 8192 - this.lightness * 2 : this.lightness * 2);
        } else {
            this.saturation = 0;
        }
    }

    setRgb(hue: number, saturation: number, lightness: number) {
        const q =
            lightness > 2048
                ? saturation + lightness - ((saturation * lightness) >> 12)
                : (lightness * (4096 + saturation)) >> 12;
        if (q > 0) {
            const p = lightness - q + lightness;
            const qMinusPOverQQ12 = ((q - p) << 12) / q;
            const hue6Q12 = hue * 6;
            const hueSector = hue6Q12 >> 12;
            const hueFracQ12 = hue6Q12 - (hueSector << 12);
            let deltaQ12 = q;
            deltaQ12 = (deltaQ12 * qMinusPOverQQ12) >> 12;
            deltaQ12 = (hueFracQ12 * deltaQ12) >> 12;
            const pPlusDelta = p + deltaQ12;
            const qMinusDelta = q - deltaQ12;
            if (hueSector === 0) {
                this.rgbR = q;
                this.rgbG = pPlusDelta;
                this.rgbB = p;
            } else if (hueSector === 1) {
                this.rgbR = qMinusDelta;
                this.rgbG = q;
                this.rgbB = p;
            } else if (hueSector === 2) {
                this.rgbR = p;
                this.rgbG = q;
                this.rgbB = pPlusDelta;
            } else if (hueSector === 3) {
                this.rgbR = p;
                this.rgbG = qMinusDelta;
                this.rgbB = q;
            } else if (hueSector === 4) {
                this.rgbR = pPlusDelta;
                this.rgbG = p;
                this.rgbB = q;
            } else if (hueSector === 5) {
                this.rgbR = q;
                this.rgbG = p;
                this.rgbB = qMinusDelta;
            }
        } else {
            this.rgbR = this.rgbG = this.rgbB = lightness;
        }
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache is not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            const input = this.getColourInput(textureGenerator, 0, line);
            const inputR = input[0];
            const inputG = input[1];
            const inputB = input[2];
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                this.setHsl(inputR[pixel], inputG[pixel], inputB[pixel]);
                this.hue += this.deltaHue;
                this.saturation += this.deltaSaturation;
                this.lightness += this.deltaLightness;
                for (; this.hue < 0; this.hue += 4096) {}
                for (; this.hue > 4096; this.hue -= 4096) {}
                if (this.saturation < 0) {
                    this.saturation = 0;
                }
                if (this.saturation > 4096) {
                    this.saturation = 4096;
                }
                if (this.lightness < 0) {
                    this.lightness = 0;
                }
                if (this.lightness > 4096) {
                    this.lightness = 4096;
                }
                this.setRgb(this.hue, this.saturation, this.lightness);
                outputR[pixel] = this.rgbR;
                outputG[pixel] = this.rgbG;
                outputB[pixel] = this.rgbB;
            }
        }
        return output;
    }
}
