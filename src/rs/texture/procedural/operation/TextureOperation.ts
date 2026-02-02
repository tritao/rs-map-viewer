import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { ColourImageCache } from "../cache/ColourImageCache";
import { MonochromeImageCache } from "../cache/MonochromeImageCache";

export abstract class TextureOperation {
    operationId: number = -1;

    // Number of cache slots (lines) to keep. `0xff` means "cache all lines" (full height).
    cacheSlotCount: number = 0;
    isMonochrome: boolean;

    inputs: TextureOperation[];

    monochromeImageCache?: MonochromeImageCache;
    colourImageCache?: ColourImageCache;

    constructor(inputCount: number, isMonochrome: boolean) {
        this.isMonochrome = isMonochrome;
        this.inputs = new Array(inputCount);
    }

    decode(field: number, buffer: ByteBuffer): void {}

    init(): void {}

    initCaches(textureGenerator: TextureGenerator, width: number, height: number): void {
        const slotCount = this.cacheSlotCount === 0xff ? height : this.cacheSlotCount;
        if (this.isMonochrome) {
            this.monochromeImageCache = new MonochromeImageCache(slotCount, height, width);
        } else {
            this.colourImageCache = new ColourImageCache(slotCount, height, width);
        }
    }

    clearCaches(): void {
        this.monochromeImageCache = undefined;
        this.colourImageCache = undefined;
    }

    getSpriteId(): number {
        return -1;
    }

    getTextureId(): number {
        return -1;
    }

    getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        throw new Error("This operation does not have a monochrome output");
    }

    getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        throw new Error("This operation does not have a colour output");
    }

    getMonochromeInput(
        textureGenerator: TextureGenerator,
        inputIndex: number,
        line: number,
    ): Int32Array {
        if (this.inputs[inputIndex].isMonochrome) {
            return this.inputs[inputIndex].getMonochromeOutput(textureGenerator, line);
        }
        return this.inputs[inputIndex].getColourOutput(textureGenerator, line)[0];
    }

    getColourInput(textureGenerator: TextureGenerator, inputIndex: number, line: number): Int32Array[] {
        if (this.inputs[inputIndex].isMonochrome) {
            const monochromeOutputs = this.inputs[inputIndex].getMonochromeOutput(
                textureGenerator,
                line,
            );
            const colourOutputs = new Array<Int32Array>(3).fill(monochromeOutputs);
            return colourOutputs;
        }
        return this.inputs[inputIndex].getColourOutput(textureGenerator, line);
    }
}
