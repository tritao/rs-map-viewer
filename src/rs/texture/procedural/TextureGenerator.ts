import JavaRandom from "../../../util/JavaRandom";
import { nextIntJagex } from "../../../util/MathUtil";
import { BytesProvider } from "../../io/BytesProvider";
import { IndexedSprite } from "../../sprite/IndexedSprite";
import { SpriteLoader } from "../../sprite/SpriteLoader";
import { TextureLoader } from "../TextureLoader";

function buildTrigTable(fn: (radians: number) => number): Int32Array {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        const radians = (i / 255.0) * 6.283185307179586;
        table[i] = fn(radians) * 4096.0;
    }
    return table;
}

export const TEXTURE_SINE_TABLE_Q12 = buildTrigTable(Math.sin);
export const TEXTURE_COSINE_TABLE_Q12 = buildTrigTable(Math.cos);

export const TEXTURE_INVERSE_SQUARE_ROOT_TABLE = (() => {
    const table = new Int8Array(32896);
    let i = 0;
    for (let x = 0; x < 256; x++) {
        for (let y = 0; y <= x; y++) {
            table[i++] = (255.0 / Math.sqrt(Math.fround((x * x + y * y + 65535) / 65535.0))) | 0;
        }
    }
    return table;
})();

export function createPermutations(seed: number): Int8Array {
    const permutations = new Int8Array(512);
    const random = new JavaRandom(seed);
    for (let i = 0; i < 255; i++) {
        permutations[i] = i;
    }
    for (let i = 0; i < 255; i++) {
        const index0 = 255 - i;
        const index1 = nextIntJagex(random, index0);
        const perm1 = permutations[index1];
        permutations[index1] = permutations[index0];
        permutations[index0] = permutations[511 - i] = perm1;
    }
    return permutations;
}

export class TextureGenerator {
    readonly sine = TEXTURE_SINE_TABLE_Q12;
    readonly cosine = TEXTURE_COSINE_TABLE_Q12;
    readonly inverseSquareRoot = TEXTURE_INVERSE_SQUARE_ROOT_TABLE;

    private readonly permutationCache: Map<number, Int8Array>;

    spriteSource: BytesProvider;
    textureLoader: TextureLoader;

    width: number = 0;
    height: number = 0;

    widthTimes32: number = 0;

    widthMask: number = 0;
    heightMask: number = 0;

    horizontalGradient!: Int32Array;
    verticalGradient!: Int32Array;

    brightnessTable: Int32Array = new Int32Array(256);
    brightness: number = -1.0;

    isTransparent: boolean = false;

    debug: boolean = false;

    constructor(
        spriteSource: BytesProvider,
        textureLoader: TextureLoader,
        permutationCache: Map<number, Int8Array> = new Map(),
    ) {
        this.spriteSource = spriteSource;
        this.textureLoader = textureLoader;
        this.permutationCache = permutationCache;
    }

    init(width: number, height: number): void {
        this.isTransparent = false;
        if (this.width !== width) {
            this.horizontalGradient = new Int32Array(width);
            for (let i = 0; i < width; i++) {
                this.horizontalGradient[i] = (i << 12) / width;
            }
            this.widthMask = width - 1;
            this.width = width;
            this.widthTimes32 = width * 32;
        }
        if (this.height !== height) {
            if (height !== this.width) {
                this.verticalGradient = new Int32Array(height);
                for (let i = 0; i < height; i++) {
                    this.verticalGradient[i] = (i << 12) / height;
                }
            } else {
                this.verticalGradient = this.horizontalGradient;
            }
            this.heightMask = height - 1;
            this.height = height;
        }
    }

    initBrightness(brightness: number): void {
        if (this.brightness !== brightness) {
            for (let i = 0; i < this.brightnessTable.length; i++) {
                const v = (Math.pow(i / 255.0, brightness) * 255.0) | 0;
                this.brightnessTable[i] = Math.min(v, 255);
            }

            this.brightness = brightness;
        }
    }

    getPermutations(seed: number): Int8Array {
        const cached = this.permutationCache.get(seed);
        if (cached) {
            return cached;
        }
        const permutations = createPermutations(seed);
        this.permutationCache.set(seed, permutations);
        return permutations;
    }

    tryLoadSprite(spriteId: number): IndexedSprite | undefined {
        return SpriteLoader.loadIntoIndexedSpriteFromSource(this.spriteSource, spriteId) ?? undefined;
    }
}
