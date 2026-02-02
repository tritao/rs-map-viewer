import { Archive } from "../cache/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { ByteBuffer } from "../io/ByteBuffer";
import { IndexedSprite } from "./IndexedSprite";

export class SpriteLoader {
    spriteCount: number = 0;
    xOffsets!: Int32Array;
    yOffsets!: Int32Array;
    widths!: Int32Array;
    heights!: Int32Array;
    pixels!: Uint8Array[];
    width: number = 0;
    height: number = 0;
    palette!: Int32Array;

    load(data: Int8Array): this {
        const buffer = new ByteBuffer(data);

        buffer.offset = data.length - 2;

        this.spriteCount = buffer.readUnsignedShort();
        this.xOffsets = new Int32Array(this.spriteCount);
        this.yOffsets = new Int32Array(this.spriteCount);
        this.widths = new Int32Array(this.spriteCount);
        this.heights = new Int32Array(this.spriteCount);
        this.pixels = new Array(this.spriteCount);

        buffer.offset = data.length - 7 - this.spriteCount * 8;

        this.width = buffer.readUnsignedShort();
        this.height = buffer.readUnsignedShort();
        const paletteSize = (buffer.readUnsignedByte() & 0xff) + 1;

        for (let i = 0; i < this.spriteCount; i++) {
            this.xOffsets[i] = buffer.readUnsignedShort();
        }

        for (let i = 0; i < this.spriteCount; i++) {
            this.yOffsets[i] = buffer.readUnsignedShort();
        }

        for (let i = 0; i < this.spriteCount; i++) {
            this.widths[i] = buffer.readUnsignedShort();
        }

        for (let i = 0; i < this.spriteCount; i++) {
            this.heights[i] = buffer.readUnsignedShort();
        }

        buffer.offset = data.length - 7 - this.spriteCount * 8 - (paletteSize - 1) * 3;

        this.palette = new Int32Array(paletteSize);

        for (let i = 1; i < paletteSize; i++) {
            this.palette[i] = buffer.readMedium();
            if (this.palette[i] === 0) {
                this.palette[i] = 1;
            }
        }

        buffer.offset = 0;

        for (let i = 0; i < this.spriteCount; i++) {
            const width = this.widths[i];
            const height = this.heights[i];
            const pixelCount = width * height;
            const pixels = (this.pixels[i] = new Uint8Array(pixelCount));
            const readPixelsDimension = buffer.readUnsignedByte();
            if (readPixelsDimension === 0) {
                for (let pi = 0; pi < pixelCount; pi++) {
                    pixels[pi] = buffer.readByte();
                }
            } else if (readPixelsDimension === 1) {
                for (let x = 0; x < width; x++) {
                    for (let y = 0; y < height; y++) {
                        pixels[x + y * width] = buffer.readByte();
                    }
                }
            }
        }

        return this;
    }

    loadFromIndex(spriteIndex: CacheIndex, id: number): boolean {
        const file = spriteIndex.getFile(id, 0);
        if (file) {
            this.load(file.data);
            return true;
        }
        return false;
    }

    static loadIndexedSpriteDat(archive: Archive, name: string, offset: number): IndexedSprite {
        return this.loadIndexedSpriteDatId(archive, archive.getFileId(name + ".dat"), offset);
    }

    static loadIndexedSpriteDatId(archive: Archive, id: number, offset: number): IndexedSprite {
        const dataFile = archive.getFile(id);
        const indexFile = archive.getFileNamed("index.dat");
        if (!dataFile) {
            throw new Error(id + " sprite not found");
        }
        if (!indexFile) {
            throw new Error("index.dat not found");
        }

        const dataBuffer = new ByteBuffer(dataFile.data);
        const indexBuffer = new ByteBuffer(indexFile.data);

        indexBuffer.offset = dataBuffer.readUnsignedShort();

        const sprite = new IndexedSprite();

        sprite.width = indexBuffer.readUnsignedShort();
        sprite.height = indexBuffer.readUnsignedShort();

        let paletteSize = indexBuffer.readUnsignedByte();

        sprite.palette = new Int32Array(paletteSize);
        for (let i = 0; i < paletteSize - 1; i++) {
            sprite.palette[i + 1] = indexBuffer.readMedium();
        }

        for (let i = 0; i < offset; i++) {
            indexBuffer.offset += 2;
            dataBuffer.offset += indexBuffer.readUnsignedShort() * indexBuffer.readUnsignedShort();
            indexBuffer.offset++;
        }

        sprite.xOffset = indexBuffer.readUnsignedByte();
        sprite.yOffset = indexBuffer.readUnsignedByte();
        sprite.subWidth = indexBuffer.readUnsignedShort();
        sprite.subHeight = indexBuffer.readUnsignedShort();

        const pixelCount = sprite.subWidth * sprite.subHeight;
        sprite.pixels = new Uint8Array(pixelCount);

        const type = indexBuffer.readUnsignedByte();
        if (type === 0) {
            for (let i = 0; i < pixelCount; i++) {
                sprite.pixels[i] = dataBuffer.readByte();
            }
        } else if (type === 1) {
            for (let x = 0; x < sprite.subWidth; x++) {
                for (let y = 0; y < sprite.subHeight; y++) {
                    sprite.pixels[x + y * sprite.subWidth] = dataBuffer.readByte();
                }
            }
        }

        return sprite;
    }

    toIndexedSprite(index: number = 0): IndexedSprite {
        const sprite = new IndexedSprite();
        sprite.width = this.width;
        sprite.height = this.height;
        sprite.xOffset = this.xOffsets[index];
        sprite.yOffset = this.yOffsets[index];
        sprite.subWidth = this.widths[index];
        sprite.subHeight = this.heights[index];
        sprite.palette = this.palette;
        sprite.pixels = this.pixels[index];
        return sprite;
    }

    toIndexedSprites(): IndexedSprite[] {
        const sprites = new Array<IndexedSprite>(this.spriteCount);
        for (let i = 0; i < this.spriteCount; i++) {
            const sprite = (sprites[i] = new IndexedSprite());
            sprite.width = this.width;
            sprite.height = this.height;
            sprite.xOffset = this.xOffsets[i];
            sprite.yOffset = this.yOffsets[i];
            sprite.subWidth = this.widths[i];
            sprite.subHeight = this.heights[i];
            sprite.palette = this.palette;
            sprite.pixels = this.pixels[i];
        }
        return sprites;
    }

    static loadIntoIndexedSprite(spriteIndex: CacheIndex, id: number): IndexedSprite | undefined {
        const loader = new SpriteLoader();
        if (!loader.loadFromIndex(spriteIndex, id) || loader.spriteCount === 0) {
            return undefined;
        }
        return loader.toIndexedSprite(0);
    }

    static loadIntoIndexedSprites(
        spriteIndex: CacheIndex,
        id: number,
    ): IndexedSprite[] | undefined {
        const loader = new SpriteLoader();
        if (!loader.loadFromIndex(spriteIndex, id) || loader.spriteCount === 0) {
            return undefined;
        }
        return loader.toIndexedSprites();
    }
}
