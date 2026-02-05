import { Archive } from "../cache/format/Archive";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { SpriteLoader } from "../sprite/SpriteLoader";
import { brightenRgb, rgbToHsl } from "../util/ColorUtil";
import { TextureLoader } from "./TextureLoader";
import { TextureMaterial } from "./TextureMaterial";

export class DatTextureLoader implements TextureLoader {
    static readonly WATER_DROPLETS_TEXTURE_ID = 17;

    animatedTextureIds: Set<number>;

    textureIds: number[];

    textureSprites: Array<IndexedSprite | undefined>;
    missingTextureSpriteIds: Set<number> = new Set();

    idAverageHslMap: Map<number, number>;
    transparentTextureMap: Map<number, boolean> = new Map();
    private readonly pixelErrors: Set<number> = new Set();

    constructor(
        readonly textureArchive: Archive,
        animatedTextureIds: number[],
    ) {
        this.animatedTextureIds = new Set(animatedTextureIds);
        this.textureIds = new Array(this.getTextureCount());
        for (let i = 0; i < this.textureIds.length; i++) {
            this.textureIds[i] = i;
        }
        this.textureSprites = new Array(this.getLastTextureId());
        this.idAverageHslMap = new Map();
    }

    getTextureIds(): number[] {
        return this.textureIds;
    }

    getTextureIndex(id: number): number {
        return id;
    }

    getTextureCount(): number {
        // one is for index.dat
        return this.textureArchive.fileCount - 1;
    }

    getLastTextureId(): number {
        return this.getTextureCount() - 1;
    }

    isSd(id: number): boolean {
        return true;
    }

    isSmall(id: number): boolean {
        const sprite = this.tryLoadTextureSprite(id);
        return sprite?.subWidth === 64;
    }

    isTransparent(id: number): boolean {
        this.tryLoadTextureSprite(id);
        return this.transparentTextureMap.get(id) ?? false;
    }

    getAverageHsl(id: number): number {
        let averageHsl = this.idAverageHslMap.get(id);
        if (averageHsl !== undefined) {
            return averageHsl;
        }

        const sprite = this.tryLoadTextureSprite(id);
        if (!sprite) {
            return 0;
        }

        let red = 0;
        let green = 0;
        let blue = 0;

        const colourCount = sprite.palette.length;
        for (let i = 0; i < colourCount; i++) {
            red += (sprite.palette[i] >> 16) & 0xff;
            green += (sprite.palette[i] >> 8) & 0xff;
            blue += sprite.palette[i] & 0xff;
        }

        const averageRgb =
            ((red / colourCount) << 16) + ((green / colourCount) << 8) + ((blue / colourCount) | 0);

        averageHsl = rgbToHsl(averageRgb);

        this.idAverageHslMap.set(id, averageHsl);

        return averageHsl;
    }

    getAnimationUv(id: number): [number, number] {
        if (this.animatedTextureIds.has(id)) {
            return [0, -1];
        }
        return [0, 0];
    }

    getMaterial(id: number): TextureMaterial {
        let animV = 0;
        let alphaCutOff = 0.5;
        if (this.animatedTextureIds.has(id)) {
            animV = -1;
            alphaCutOff = 0.1;
        }

        return {
            animU: 0,
            animV,
            alphaCutOff,
        };
    }

    tryGetMaterial(id: number): TextureMaterial | undefined {
        if (id < 0 || id > this.getLastTextureId()) {
            return undefined;
        }
        return this.getMaterial(id);
    }

    private tryGetPixelsRgbInternal(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        if (this.pixelErrors.has(id)) {
            return undefined;
        }
        const sprite = this.tryLoadTextureSprite(id);
        if (!sprite) {
            return undefined;
        }

        const palettePixels = sprite.pixels;
        const sourcePalette = sprite.palette;
        const paletteArgb = new Int32Array(sourcePalette.length);
        for (let pi = 0; pi < sourcePalette.length; pi++) {
            const rgb = sourcePalette[pi];
            let alpha = 0xff;
            if (rgb === 0) {
                alpha = 0;
            }
            paletteArgb[pi] = (alpha << 24) | brightenRgb(rgb, brightness);
        }

        const pixelCount = size * size;
        const pixels = new Int32Array(pixelCount);

        if (size === sprite.subWidth) {
            for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
                const paletteIndex = palettePixels[pixelIndex];
                pixels[pixelIndex] = paletteArgb[paletteIndex];
            }
        } else if (sprite.subWidth === 64 && size === 128) {
            let pixelIndex = 0;

            for (let x = 0; x < size; x++) {
                for (let y = 0; y < size; y++) {
                    const paletteIndex = palettePixels[((x >> 1) << 6) + (y >> 1)];
                    pixels[pixelIndex++] = paletteArgb[paletteIndex];
                }
            }
        } else {
            if (sprite.subWidth !== 128 || size !== 64) {
                if (!this.pixelErrors.has(id)) {
                    console.error("DatTextureLoader: unsupported sprite size for texture", id, sprite.subWidth, size);
                    this.pixelErrors.add(id);
                }
                return undefined;
            }

            let pixelIndex = 0;

            for (let x = 0; x < size; x++) {
                for (let y = 0; y < size; y++) {
                    const paletteIndex = palettePixels[(y << 1) + ((x << 1) << 7)];
                    pixels[pixelIndex++] = paletteArgb[paletteIndex];
                }
            }
        }

        return pixels;
    }

    getPixelsRgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array {
        const pixels = this.tryGetPixelsRgbInternal(id, size, flipH, brightness);
        if (!pixels) {
            throw new Error("Failed decoding texture pixels: " + id);
        }
        return pixels;
    }

    getPixelsArgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array {
        return this.getPixelsRgb(id, size, flipH, brightness);
    }

    tryGetPixelsRgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined {
        return this.tryGetPixelsRgbInternal(id, size, flipH, brightness);
    }

    tryGetPixelsArgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined {
        return this.tryGetPixelsRgbInternal(id, size, flipH, brightness);
    }

    loadTextureSprite(id: number): IndexedSprite {
        const sprite = this.tryLoadTextureSprite(id);
        if (!sprite) {
            throw new Error("Texture sprite not found: " + id);
        }
        return sprite;
    }

    tryLoadTextureSprite(id: number): IndexedSprite | undefined {
        if (this.missingTextureSpriteIds.has(id)) {
            return undefined;
        }

        let sprite = this.textureSprites[id];
        if (!sprite) {
            sprite = SpriteLoader.tryLoadIndexedSpriteDat(
                this.textureArchive,
                id.toString(),
                0,
            );
            if (!sprite) {
                this.transparentTextureMap.set(id, false);
                console.error("DatTextureLoader: missing texture sprite", id);
                this.missingTextureSpriteIds.add(id);
                return undefined;
            }
            this.textureSprites[id] = sprite;
            sprite.normalize();

            const palette = sprite.palette;

            const alphaPaletteIndices: Set<number> = new Set();
            for (let pi = 0; pi < palette.length; pi++) {
                if (palette[pi] === 0) {
                    alphaPaletteIndices.add(pi);
                }
            }

            const isTransparent =
                sprite.pixels.findIndex((pi) => alphaPaletteIndices.has(pi)) !== -1;

            this.transparentTextureMap.set(id, isTransparent);
        }
        return sprite;
    }
}
