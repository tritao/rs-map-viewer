import { Result, err, ok } from "../../util/Result";
import { Archive } from "../cache/format/Archive";
import { DecodeError, decodeFailedError, notFoundError } from "../errors/DecodeError";
import { ArchiveNamedBytesProvider, NamedBytesProvider } from "../io/NamedBytesProvider";
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
    private readonly textureSpriteErrors: Map<number, DecodeError> = new Map();

    idAverageHslMap: Map<number, number>;
    transparentTextureMap: Map<number, boolean> = new Map();
    private readonly pixelErrors: Map<number, DecodeError> = new Map();
    private readonly spriteSource: NamedBytesProvider;

    constructor(
        readonly textureArchive: Archive,
        animatedTextureIds: number[],
    ) {
        this.spriteSource = new ArchiveNamedBytesProvider(textureArchive);
        this.animatedTextureIds = new Set(animatedTextureIds);
        this.textureIds = Array.from({ length: this.getTextureCount() }, (_, i) => i);
        this.textureSprites = Array.from({ length: this.getLastTextureId() }, () => undefined);
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

        const avgRed = Math.trunc(red / colourCount);
        const avgGreen = Math.trunc(green / colourCount);
        const avgBlue = Math.trunc(blue / colourCount);
        const averageRgb = avgRed * 0x10000 + avgGreen * 0x100 + avgBlue;

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

    tryLoadMaterial(id: number): Result<TextureMaterial, DecodeError> {
        if (id < 0 || id > this.getLastTextureId()) {
            return err(notFoundError("DatTextureMaterial", id));
        }
        return ok(this.getMaterial(id));
    }

    private tryLoadPixelsInternal(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Result<Int32Array, DecodeError> {
        const cachedError = this.pixelErrors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        const spriteResult = this.tryLoadTextureSpriteResult(id);
        if (!spriteResult.ok) {
            return err(spriteResult.error);
        }
        const sprite = spriteResult.value;

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
                const e = decodeFailedError({
                    typeName: "DatTexturePixels",
                    id,
                    message: `DatTextureLoader: unsupported sprite size for texture id=${id} sprite.subWidth=${sprite.subWidth} size=${size}`,
                });
                this.pixelErrors.set(id, e);
                return err(e);
            }

            let pixelIndex = 0;

            for (let x = 0; x < size; x++) {
                for (let y = 0; y < size; y++) {
                    const paletteIndex = palettePixels[(y << 1) + ((x << 1) << 7)];
                    pixels[pixelIndex++] = paletteArgb[paletteIndex];
                }
            }
        }

        return ok(pixels);
    }

    tryGetPixelsRgb(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        const result = this.tryLoadPixelsRgb(id, size, flipH, brightness);
        return result.ok ? result.value : undefined;
    }

    tryGetPixelsArgb(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        const result = this.tryLoadPixelsArgb(id, size, flipH, brightness);
        return result.ok ? result.value : undefined;
    }

    tryLoadPixelsRgb(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Result<Int32Array, DecodeError> {
        return this.tryLoadPixelsInternal(id, size, flipH, brightness);
    }

    tryLoadPixelsArgb(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Result<Int32Array, DecodeError> {
        return this.tryLoadPixelsInternal(id, size, flipH, brightness);
    }

    tryLoadTextureSprite(id: number): IndexedSprite | undefined {
        const result = this.tryLoadTextureSpriteResult(id);
        return result.ok ? result.value : undefined;
    }

    private tryLoadTextureSpriteResult(id: number): Result<IndexedSprite, DecodeError> {
        if (this.missingTextureSpriteIds.has(id)) {
            return err(this.textureSpriteErrors.get(id) ?? notFoundError("DatTextureSprite", id));
        }

        const cachedError = this.textureSpriteErrors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        let sprite = this.textureSprites[id];
        if (!sprite) {
            sprite = SpriteLoader.tryLoadIndexedSpriteDatFromNamedBytes(
                this.spriteSource,
                id.toString(),
                0,
            );
            if (!sprite) {
                this.transparentTextureMap.set(id, false);
                const e = notFoundError("DatTextureSprite", id);
                this.textureSpriteErrors.set(id, e);
                this.missingTextureSpriteIds.add(id);
                return err(e);
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
        return ok(sprite);
    }

    clearCache(): void {
        this.textureSprites = Array.from({ length: this.getLastTextureId() }, () => undefined);
        this.missingTextureSpriteIds.clear();
        this.textureSpriteErrors.clear();
        this.idAverageHslMap.clear();
        this.transparentTextureMap.clear();
        this.pixelErrors.clear();
    }
}
