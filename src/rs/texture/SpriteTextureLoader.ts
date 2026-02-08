import { Result, err, ok } from "../../util/Result";
import { DecodeError, decodeFailedError, notFoundError } from "../errors/DecodeError";
import { ByteBuffer } from "../io/ByteBuffer";
import { BytesProvider, EnumeratingBytesProvider } from "../io/BytesProvider";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { SpriteLoader } from "../sprite/SpriteLoader";
import { brightenRgb } from "../util/ColorUtil";
import { TextureLoader } from "./TextureLoader";
import { TextureMaterial } from "./TextureMaterial";

export class SpriteTextureLoader implements TextureLoader {
    static readonly ANIM_DIRECTION_UV = [
        [0.0, 0.0],
        [0.0, -1.0],
        [-1.0, 0.0],
        [0.0, 1.0],
        [1.0, 0.0],
    ];

    idIndexMap: Map<number, number>;
    private readonly errors: Map<number, DecodeError>;

    static create(
        textureDefinitionSource: EnumeratingBytesProvider | undefined,
        spriteSource: BytesProvider,
    ): SpriteTextureLoader {
        const definitions = new Map<number, TextureDefinition>();
        const errors = new Map<number, DecodeError>();

        if (!textureDefinitionSource) {
            return new SpriteTextureLoader(spriteSource, [], definitions, errors);
        }
        const textureIds = Array.from(textureDefinitionSource.getIds());
        for (let i = 0; i < textureIds.length; i++) {
            const textureId = textureIds[i];
            const bytes = textureDefinitionSource.getBytes(textureId);
            if (!bytes) {
                continue;
            }
            const buffer = new ByteBuffer(bytes);
            const definitionResult = TextureDefinition.tryDecode(textureId, buffer);
            if (definitionResult.ok) {
                const definition = definitionResult.value;
                definitions.set(textureId, definition);
            } else {
                errors.set(textureId, definitionResult.error);
            }
        }

        return new SpriteTextureLoader(spriteSource, textureIds, definitions, errors);
    }

    constructor(
        readonly spriteSource: BytesProvider,
        readonly textureIds: number[],
        readonly definitions: Map<number, TextureDefinition>,
        errors?: Map<number, DecodeError>,
    ) {
        this.errors = errors ?? new Map();
        this.idIndexMap = new Map();
        for (let i = 0; i < textureIds.length; i++) {
            this.idIndexMap.set(textureIds[i], i);
        }
    }

    getTextureIds(): number[] {
        return this.textureIds;
    }

    getTextureIndex(id: number): number {
        return this.idIndexMap.get(id) ?? -1;
    }

    isSd(id: number): boolean {
        return true;
    }

    isSmall(id: number): boolean {
        const sprite = this.tryLoadTextureSprite(id);
        return sprite?.subWidth === 64;
    }

    getAverageHsl(id: number): number {
        return this.definitions.get(id)?.averageHsl ?? 0;
    }

    getAnimationUv(id: number): [number, number] {
        const def = this.definitions.get(id);
        if (!def) {
            return [0, 0];
        }

        const direction = def.animationDirection;
        const speed = def.animationSpeed;

        const uv = SpriteTextureLoader.ANIM_DIRECTION_UV[direction];

        return [uv[0] * speed, uv[1] * speed];
    }

    isTransparent(id: number): boolean {
        const def = this.definitions.get(id);
        if (!def) {
            return false;
        }
        return !def.opaque;
    }

    getMaterial(id: number): TextureMaterial {
        const def = this.definitions.get(id);
        if (!def) {
            return {
                animU: 0,
                animV: 0,
                alphaCutOff: 0.1,
            };
        }

        const direction = def.animationDirection;
        const speed = def.animationSpeed;

        const uv = SpriteTextureLoader.ANIM_DIRECTION_UV[direction];

        const animU = uv[0] * speed;
        const animV = uv[1] * speed;

        let alphaCutOff = 0.5;
        if (animU !== 0 || animV !== 0) {
            alphaCutOff = 0.1;
        }

        return {
            animU,
            animV,
            alphaCutOff,
        };
    }

    tryGetMaterial(id: number): TextureMaterial | undefined {
        const def = this.definitions.get(id);
        if (!def) {
            return undefined;
        }
        return this.getMaterial(id);
    }

    tryLoadMaterial(id: number): Result<TextureMaterial, DecodeError> {
        const def = this.definitions.get(id);
        if (!def) {
            return err(notFoundError("SpriteTextureMaterial", id));
        }
        return ok(this.getMaterial(id));
    }

    tryLoadTextureSprite(id: number): IndexedSprite | undefined {
        const result = this.tryLoadTextureSpriteResult(id);
        return result.ok ? result.value : undefined;
    }

    private tryLoadTextureSpriteResult(id: number): Result<IndexedSprite, DecodeError> {
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        const def = this.definitions.get(id);
        if (!def) {
            const e = notFoundError("SpriteTextureDefinition", id);
            this.errors.set(id, e);
            return err(e);
        }

        for (let i = 0; i < def.spriteIds.length; i++) {
            const spriteId = def.spriteIds[i];
            const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(
                this.spriteSource,
                spriteId,
            );
            if (!sprite) {
                const e = decodeFailedError({
                    typeName: "SpriteTextureSprite",
                    id,
                    message: `SpriteTextureLoader: missing sprite for texture id=${id} spriteId=${spriteId}`,
                });
                this.errors.set(id, e);
                return err(e);
            }
            sprite.normalize();
            return ok(sprite);
        }

        const e = decodeFailedError({
            typeName: "SpriteTextureSprite",
            id,
            message: `SpriteTextureLoader: no sprites referenced by texture id=${id}`,
        });
        this.errors.set(id, e);
        return err(e);
    }

    private tryLoadPixelsInternal(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Result<Int32Array, DecodeError> {
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        const def = this.definitions.get(id);
        if (!def) {
            const e = notFoundError("SpriteTexturePixels", id);
            this.errors.set(id, e);
            return err(e);
        }

        const pixelCount = size * size;
        const pixels = new Int32Array(pixelCount);

        for (let i = 0; i < def.spriteIds.length; i++) {
            const spriteId = def.spriteIds[i];
            const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(
                this.spriteSource,
                spriteId,
            );
            if (!sprite) {
                const e = decodeFailedError({
                    typeName: "SpriteTexturePixels",
                    id,
                    message: `SpriteTextureLoader: missing sprite for texture id=${id} spriteId=${spriteId}`,
                });
                this.errors.set(id, e);
                return err(e);
            }
            sprite.normalize();

            const palettePixels = sprite.pixels;
            const transform = def.transforms[i];

            let index = 0;
            if (i > 0 && def.spriteTypes) {
                index = def.spriteTypes[i - 1];
            }

            if (index === 0) {
                const sourcePalette = sprite.palette;
                const paletteArgb = new Int32Array(sourcePalette.length);

                // not used by any texture but who knows
                const hasTransform = (transform & -0x1000000) === 0x3000000;
                const r_b = transform & 0xff00ff;
                const green = (transform >> 8) & 0xff;

                for (let pi = 0; pi < sourcePalette.length; pi++) {
                    let rgb = sourcePalette[pi];

                    if (hasTransform) {
                        const rg = rgb >> 8;
                        const gb = rgb & 0xffff;
                        if (rg === gb) {
                            const blue = rgb & 0xff;
                            const rbScaled = r_b * blue;
                            const gScaled = green * blue;
                            rgb = ((rbScaled >> 8) & 0xff00ff) | (gScaled & 0xff00);
                        }
                    }

                    let alpha = 0xff;
                    if (rgb === 0) {
                        alpha = 0;
                    }
                    paletteArgb[pi] = (alpha << 24) | brightenRgb(rgb, brightness);
                }

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
                            typeName: "SpriteTexturePixels",
                            id,
                            message: `SpriteTextureLoader: unsupported sprite size for texture id=${id} sprite.subWidth=${sprite.subWidth} size=${size}`,
                        });
                        this.errors.set(id, e);
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

    clearCache(): void {
        this.errors.clear();
    }
}

class TextureDefinition {
    static tryDecode(id: number, buffer: ByteBuffer): Result<TextureDefinition, DecodeError> {
        const averageHsl = buffer.readUnsignedShort();
        const opaque = buffer.readUnsignedByte() === 1;
        const spriteCount = buffer.readUnsignedByte();
        if (spriteCount < 1 || spriteCount > 4) {
            return err(
                decodeFailedError({
                    typeName: "SpriteTextureDefinition",
                    id,
                    message: `SpriteTextureLoader: invalid spriteCount=${spriteCount} for texture id=${id}`,
                }),
            );
        }

        const spriteIds = Array.from({ length: spriteCount }, () => buffer.readUnsignedShort());

        let spriteTypes: number[] | undefined;
        if (spriteCount > 1) {
            spriteTypes = Array.from({ length: spriteCount - 1 }, () => buffer.readUnsignedByte());
        }
        let unused: number[] | undefined;
        if (spriteCount > 1) {
            unused = Array.from({ length: spriteCount - 1 }, () => buffer.readUnsignedByte());
        }

        const transforms = Array.from({ length: spriteCount }, () => buffer.readInt());

        const animationDirection = buffer.readUnsignedByte();
        const animationSpeed = buffer.readUnsignedByte();

        return ok(
            new TextureDefinition(
                id,
                averageHsl,
                opaque,
                spriteCount,
                spriteIds,
                transforms,
                animationDirection,
                animationSpeed,
                spriteTypes,
                unused,
            ),
        );
    }

    constructor(
        readonly id: number,
        readonly averageHsl: number,
        readonly opaque: boolean,
        readonly spriteCount: number,
        readonly spriteIds: number[],
        readonly transforms: number[],
        readonly animationDirection: number,
        readonly animationSpeed: number,
        readonly spriteTypes?: number[],
        readonly unused?: number[],
    ) {}
}
