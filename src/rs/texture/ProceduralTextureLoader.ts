import { CacheIndex } from "../cache/CacheIndex";
import { ByteBuffer } from "../io/ByteBuffer";
import { BytesProvider, EnumeratingBytesProvider } from "../io/BytesProvider";
import { TextureCombineMode } from "./TextureCombineMode";
import { TextureLoader } from "./TextureLoader";
import { TextureMaterial } from "./TextureMaterial";
import { ProceduralTexture } from "./procedural/ProceduralTexture";
import { TextureGenerator } from "./procedural/TextureGenerator";
import { errorToString } from "../../util/ErrorUtil";

export class ProceduralTextureLoader implements TextureLoader {
    textureGenerator: TextureGenerator;

    textures: Map<number, ProceduralTextureDefinition> = new Map();
    private readonly textureDecodeErrors: Set<number> = new Set();
    private readonly pixelDecodeErrors: Set<number> = new Set();

    transparentTextureMap: Map<number, boolean> = new Map();

    static create(
        hasAlphaMaterialField: boolean,
        hasAlphaOperation: boolean,
        materialsIndex: CacheIndex,
        textureSource: EnumeratingBytesProvider,
        spriteSource: BytesProvider,
    ): ProceduralTextureLoader {
        const materialsFile = materialsIndex.tryGetFile(0, 0);
        if (!materialsFile) {
            throw new Error("ProceduralTextureLoader: materials file not found (archive=0 file=0)");
        }
        const buffer = new ByteBuffer(materialsFile.data);
        const count = buffer.readUnsignedShort();
        const materials: (ProcTextureMaterial | undefined)[] = new Array(count);
        for (let i = 0; i < count; i++) {
            // 1
            const exists = buffer.readUnsignedByte() === 1;
            if (exists) {
                materials[i] = new ProcTextureMaterial(i);
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.valid = buffer.readUnsignedByte() === 1;
            }
        }
        if (hasAlphaMaterialField) {
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.alpha = buffer.readUnsignedByte() === 1;
                }
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.small = buffer.readUnsignedByte() === 1;
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.disabled = buffer.readUnsignedByte() === 1;
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.brightness = buffer.readByte();
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.blanch = buffer.readByte();
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.shaderId = buffer.readByte();
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.shaderParam = buffer.readByte();
            }
        }
        for (let i = 0; i < count; i++) {
            const material = materials[i];
            if (material) {
                material.averageHsl = buffer.readUnsignedShort();
            }
        }

        if (buffer.remaining > 0) {
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.animU = buffer.readByte();
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.animV = buffer.readByte();
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    buffer.readByte();
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.flipV = buffer.readUnsignedByte() === 1;
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.mipmap = buffer.readByte();
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.repeatS = buffer.readUnsignedByte() === 1;
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.repeatT = buffer.readUnsignedByte() === 1;
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.floatTexture = buffer.readUnsignedByte() === 1;
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.combineMode = buffer.readUnsignedByte();
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.shaderParam2 = buffer.readInt();
                }
            }
            for (let i = 0; i < count; i++) {
                const material = materials[i];
                if (material) {
                    material.alphaMode = buffer.readUnsignedByte();
                }
            }
        }

        const textureIds = Array.from(textureSource.getIds());

        return new ProceduralTextureLoader(
            hasAlphaOperation,
            textureSource,
            spriteSource,
            textureIds,
            materials,
        );
    }

    constructor(
        readonly hasAlphaOperation: boolean,
        readonly textureSource: BytesProvider,
        readonly spriteSource: BytesProvider,
        readonly textureIds: number[],
        readonly materials: (ProcTextureMaterial | undefined)[],
    ) {
        this.textureGenerator = new TextureGenerator(spriteSource, this);
    }

    getTexture(id: number): ProceduralTextureDefinition | undefined {
        const cached = this.textures.get(id);
        if (cached) {
            return cached;
        }
        if (this.textureDecodeErrors.has(id)) {
            return undefined;
        }

        const bytes = this.textureSource.getBytes(id);
        if (!bytes) {
            return undefined;
        }
        try {
            const buffer = new ByteBuffer(bytes);
            const texture = new ProceduralTextureDefinition(id, buffer, this.hasAlphaOperation);
            this.textures.set(id, texture);
            this.textureDecodeErrors.delete(id);
            return texture;
        } catch (e) {
            console.error(`ProceduralTextureLoader: failed decoding texture definition id=${id}: ${errorToString(e)}`);
            this.textureDecodeErrors.add(id);
            return undefined;
        }
    }

    getTextureIds(): number[] {
        return this.textureIds;
    }

    getTextureIndex(id: number): number {
        return id;
    }

    isSd(id: number): boolean {
        return this.materials[id]?.valid ?? false;
    }

    isSmall(id: number): boolean {
        return this.materials[id]?.small ?? false;
    }

    isTransparent(id: number): boolean {
        if (!this.transparentTextureMap.has(id)) {
            if (!this.getTexture(id)) {
                this.transparentTextureMap.set(id, false);
            } else if (!this.tryGetPixelsArgb(id, 128, false, 1.0)) {
                this.transparentTextureMap.set(id, false);
            }
        }
        return this.transparentTextureMap.get(id) ?? false;
    }

    getAverageHsl(id: number): number {
        return this.materials[id]?.averageHsl ?? 0;
    }

    getAnimationUv(id: number): [number, number] {
        const texture = this.getTexture(id);
        if (!texture) {
            return [0, 0];
        }

        return [texture.animU, texture.animV];
    }

    getMaterial(id: number): TextureMaterial {
        const texture = this.getTexture(id);
        const material = this.materials[id];
        if (!texture || !material) {
            return {
                animU: 0,
                animV: 0,
                alphaCutOff: 0.1,
            };
        }

        let alphaCutOff = 0.9;
        if (texture.animU !== 0 || texture.animV !== 0 || material.alphaMode === 2) {
            alphaCutOff = 0.01;
        }

        return {
            animU: texture.animU,
            animV: texture.animV,
            alphaCutOff,
        };
    }

    tryGetMaterial(id: number): TextureMaterial | undefined {
        const texture = this.getTexture(id);
        const material = this.materials[id];
        if (!texture || !material) {
            return undefined;
        }

        let alphaCutOff = 0.9;
        if (texture.animU !== 0 || texture.animV !== 0 || material.alphaMode === 2) {
            alphaCutOff = 0.01;
        }

        return {
            animU: texture.animU,
            animV: texture.animV,
            alphaCutOff,
        };
    }

    private tryGetPixelsRgbInternal(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        if (this.pixelDecodeErrors.has(id)) {
            return undefined;
        }
        const texture = this.getTexture(id);
        if (!texture) {
            return undefined;
        }

        try {
            const pixels = texture.proceduralTexture.getPixelsRgb(
                this.textureGenerator,
                size,
                size,
                flipH,
                texture.flipV,
                brightness,
            );

            this.transparentTextureMap.set(id, this.textureGenerator.isTransparent);

            return pixels;
        } catch (e) {
            if (!this.pixelDecodeErrors.has(id)) {
                console.error("ProceduralTextureLoader: failed decoding texture pixels", id, e);
                this.pixelDecodeErrors.add(id);
            }
            return undefined;
        }
    }

    private tryGetPixelsArgbInternal(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        if (this.pixelDecodeErrors.has(id)) {
            return undefined;
        }
        const texture = this.getTexture(id);
        if (!texture) {
            return undefined;
        }

        try {
            const pixels = texture.proceduralTexture.getPixelsArgb(
                this.textureGenerator,
                size,
                size,
                flipH,
                texture.flipV,
                brightness,
            );

            this.transparentTextureMap.set(id, this.textureGenerator.isTransparent);

            return pixels;
        } catch (e) {
            if (!this.pixelDecodeErrors.has(id)) {
                console.error("ProceduralTextureLoader: failed decoding texture pixels", id, e);
                this.pixelDecodeErrors.add(id);
            }
            return undefined;
        }
    }

    tryGetPixelsRgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined {
        return this.tryGetPixelsRgbInternal(id, size, flipH, brightness);
    }

    tryGetPixelsArgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined {
        return this.tryGetPixelsArgbInternal(id, size, flipH, brightness);
    }

    clearCache(): void {
        this.textureGenerator.clearCache();
        this.textures.clear();
        this.textureDecodeErrors.clear();
        this.pixelDecodeErrors.clear();
        this.transparentTextureMap.clear();
    }
}

class ProcTextureMaterial {
    valid: boolean = false;
    alpha: boolean = false;
    small: boolean = false;
    disabled: boolean = false;
    brightness: number = 0;
    blanch: number = 0;
    shaderId: number = 0;
    shaderParam: number = 0;
    averageHsl: number = 0;

    animU: number = 0;
    animV: number = 0;

    flipV: boolean = false;
    mipmap: number = 0;
    repeatS: boolean = false;
    repeatT: boolean = false;
    floatTexture: boolean = false;
    combineMode: number = 0;

    shaderParam2: number = 0;

    alphaMode: number = 0;

    constructor(readonly id: number) {}
}

class ProceduralTextureDefinition {
    id: number;
    proceduralTexture: ProceduralTexture;

    bool1: boolean = false;
    flipV: boolean = false;

    repeatS: boolean = false;
    repeatT: boolean = false;

    animU: number = 0;
    animV: number = 0;

    combineMode: TextureCombineMode;

    constructor(id: number, buffer: ByteBuffer, hasAlphaOperation: boolean) {
        this.id = id;
        this.proceduralTexture = new ProceduralTexture(buffer, hasAlphaOperation);
        this.bool1 = buffer.readUnsignedByte() === 1;
        this.flipV = buffer.readUnsignedByte() === 1;
        this.repeatS = buffer.readUnsignedByte() === 1;
        this.repeatT = buffer.readUnsignedByte() === 1;
        const combineMode = buffer.readUnsignedByte() & 0x3;
        this.animU = buffer.readByte();
        this.animV = buffer.readByte();
        if (combineMode === 1) {
            this.combineMode = TextureCombineMode.ADD;
        } else if (combineMode === 2) {
            this.combineMode = TextureCombineMode.SUBTRACT;
        } else if (combineMode === 3) {
            this.combineMode = TextureCombineMode.ADD_SIGNED;
        } else {
            this.combineMode = TextureCombineMode.MODULATE;
        }
    }
}
