import { BytesProvider, EnumeratingBytesProvider } from "../io/BytesProvider";
import { ByteBuffer } from "../io/ByteBuffer";
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
    private readonly errors: Set<number> = new Set();

    static create(textureDefinitionSource: EnumeratingBytesProvider | undefined, spriteSource: BytesProvider): SpriteTextureLoader {
        const definitions = new Map<number, TextureDefinition>();

        if (!textureDefinitionSource) {
            console.error("SpriteTextureLoader: missing texture archive 0");
            return new SpriteTextureLoader(spriteSource, [], definitions);
        }
        const textureIds = Array.from(textureDefinitionSource.getIds());
        for (let i = 0; i < textureIds.length; i++) {
            const textureId = textureIds[i];
            const bytes = textureDefinitionSource.getBytes(textureId);
            if (!bytes) {
                continue;
            }
            try {
                const buffer = new ByteBuffer(bytes);
                const definition = TextureDefinition.decode(textureId, buffer);
                definitions.set(textureId, definition);
            } catch (e) {
                console.error("SpriteTextureLoader: failed decoding texture definition", textureId, e);
            }
        }

        return new SpriteTextureLoader(spriteSource, textureIds, definitions);
    }

    constructor(
        readonly spriteSource: BytesProvider,
        readonly textureIds: number[],
        readonly definitions: Map<number, TextureDefinition>,
    ) {
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

    loadTextureSprite(id: number): IndexedSprite {
        const def = this.definitions.get(id);
        if (!def) {
            throw new Error("Texture definition not found: " + id);
        }

        for (let i = 0; i < def.spriteIds.length; i++) {
            const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(this.spriteSource, def.spriteIds[i]);
            if (!sprite) {
                throw new Error("Texture references invalid sprite");
            }
            sprite.normalize();
            return sprite;
        }
        throw new Error("Texture has no sprites");
    }

    tryLoadTextureSprite(id: number): IndexedSprite | undefined {
        if (this.errors.has(id)) {
            return undefined;
        }
        const def = this.definitions.get(id);
        if (!def) {
            if (!this.errors.has(id)) {
                console.error("SpriteTextureLoader: missing texture definition", id);
                this.errors.add(id);
            }
            return undefined;
        }

        for (let i = 0; i < def.spriteIds.length; i++) {
            const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(this.spriteSource, def.spriteIds[i]);
            if (!sprite) {
                if (!this.errors.has(id)) {
                    console.error("SpriteTextureLoader: missing sprite for texture", id, def.spriteIds[i]);
                    this.errors.add(id);
                }
                return undefined;
            }
            sprite.normalize();
            return sprite;
        }
        return undefined;
    }

    private tryGetPixelsRgbInternal(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        if (this.errors.has(id)) {
            return undefined;
        }
        const def = this.definitions.get(id);
        if (!def) {
            if (!this.errors.has(id)) {
                console.error("SpriteTextureLoader: missing texture definition", id);
                this.errors.add(id);
            }
            return undefined;
        }

        const pixelCount = size * size;
        const pixels = new Int32Array(pixelCount);

        for (let i = 0; i < def.spriteIds.length; i++) {
            const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(this.spriteSource, def.spriteIds[i]);
            if (!sprite) {
                if (!this.errors.has(id)) {
                    console.error("SpriteTextureLoader: missing sprite for texture", id, def.spriteIds[i]);
                    this.errors.add(id);
                }
                return undefined;
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
                            rgb = (((r_b * blue) >> 8) & 0xff00ff) | ((green * blue) & 0xff00);
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
                        if (!this.errors.has(id)) {
                            console.error("SpriteTextureLoader: unsupported sprite size for texture", id, sprite.subWidth, size);
                            this.errors.add(id);
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
            }
        }

        return pixels;
    }

    tryGetPixelsRgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined {
        return this.tryGetPixelsRgbInternal(id, size, flipH, brightness);
    }

    tryGetPixelsArgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined {
        return this.tryGetPixelsRgbInternal(id, size, flipH, brightness);
    }
}

class TextureDefinition {
    static decode(id: number, buffer: ByteBuffer): TextureDefinition {
        const averageHsl = buffer.readUnsignedShort();
        const opaque = buffer.readUnsignedByte() === 1;
        const spriteCount = buffer.readUnsignedByte();
        if (spriteCount < 1 || spriteCount > 4) {
            throw new Error("Invalid sprite count for texture: " + spriteCount);
        }

        const spriteIds = new Array<number>(spriteCount);
        for (let i = 0; i < spriteCount; i++) {
            spriteIds[i] = buffer.readUnsignedShort();
        }

        let spriteTypes: number[] | undefined;
        if (spriteCount > 1) {
            spriteTypes = new Array(spriteCount - 1);
            for (let i = 0; i < spriteCount - 1; i++) {
                spriteTypes[i] = buffer.readUnsignedByte();
            }
        }
        let unused: number[] | undefined;
        if (spriteCount > 1) {
            unused = new Array(spriteCount - 1);
            for (let i = 0; i < spriteCount - 1; i++) {
                unused[i] = buffer.readUnsignedByte();
            }
        }

        const transforms = new Array<number>(spriteCount);
        for (let i = 0; i < spriteCount; i++) {
            transforms[i] = buffer.readInt();
        }

        const animationDirection = buffer.readUnsignedByte();
        const animationSpeed = buffer.readUnsignedByte();

        return new TextureDefinition(
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
