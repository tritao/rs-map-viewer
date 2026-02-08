import { ByteBuffer } from "../../src/rs/io/ByteBuffer";
import { BytesProvider, EnumeratingBytesProvider } from "../../src/rs/io/BytesProvider";
import { SpriteTextureLoader } from "../../src/rs/texture/SpriteTextureLoader";
import { ProceduralTexture } from "../../src/rs/texture/procedural/ProceduralTexture";
import { TextureGenerator } from "../../src/rs/texture/procedural/TextureGenerator";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function fnv1a32Ints(ints: Int32Array): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < ints.length; i++) {
        const v = ints[i] | 0;
        h ^= v & 0xff;
        h = Math.imul(h, 0x01000193);
        h ^= (v >>> 8) & 0xff;
        h = Math.imul(h, 0x01000193);
        h ^= (v >>> 16) & 0xff;
        h = Math.imul(h, 0x01000193);
        h ^= (v >>> 24) & 0xff;
        h = Math.imul(h, 0x01000193);
    }
    return h | 0;
}

class MemoryEnumeratingBytesProvider implements EnumeratingBytesProvider {
    private readonly ids: Int32Array;
    constructor(private readonly entries: Map<number, Uint8Array>) {
        this.ids = Int32Array.from(entries.keys());
    }
    getBytes(id: number): Uint8Array | undefined {
        return this.entries.get(id);
    }
    getCount(): number {
        return this.ids.length;
    }
    getIds(): Int32Array {
        return this.ids;
    }
}

class MemoryBytesProvider implements BytesProvider<number> {
    constructor(private readonly entries: Map<number, Uint8Array>) {}
    getBytes(id: number): Uint8Array | undefined {
        return this.entries.get(id);
    }
}

function u16be(v: number): number[] {
    return [(v >>> 8) & 0xff, v & 0xff];
}

function i32be(v: number): number[] {
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u24be(v: number): number[] {
    return [(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function i16be(v: number): number[] {
    const u = v & 0xffff;
    return [(u >>> 8) & 0xff, u & 0xff];
}

function buildPackedSpriteSingle2x2(): Uint8Array {
    const width = 2;
    const height = 2;
    const spriteCount = 1;

    const pixels = [
        0, // readPixelsDimension=0
        0,
        1,
        1,
        0,
    ];

    const paletteSize = 2;
    const palette = [
        // palette[1] = 0xFF0000 (red)
        ...u24be(0xff0000),
    ];

    const meta: number[] = [
        ...u16be(width),
        ...u16be(height),
        (paletteSize - 1) & 0xff,
        ...u16be(0), // xOffset
        ...u16be(0), // yOffset
        ...u16be(width),
        ...u16be(height),
    ];

    const out: number[] = [...pixels, ...palette, ...meta, ...u16be(spriteCount)];
    return new Uint8Array(out);
}

function buildPackedSpriteSingle2x2ColumnMajor(): Uint8Array {
    const width = 2;
    const height = 2;
    const spriteCount = 1;

    // readPixelsDimension=1 (column-major read order)
    // desired pixels (row-major): [1,2,0,1]
    // bytes read in order (x then y): (0,0)=1 (0,1)=0 (1,0)=2 (1,1)=1
    const pixels = [1, 1, 0, 2, 1];

    const paletteSize = 3;
    const palette = [
        ...u24be(0x00ff00), // palette[1] = green
        ...u24be(0x0000ff), // palette[2] = blue
    ];

    const meta: number[] = [
        ...u16be(width),
        ...u16be(height),
        (paletteSize - 1) & 0xff,
        ...u16be(0), // xOffset
        ...u16be(0), // yOffset
        ...u16be(width),
        ...u16be(height),
    ];

    const out: number[] = [...pixels, ...palette, ...meta, ...u16be(spriteCount)];
    return new Uint8Array(out);
}

function buildSpriteTextureDefinitionSingleSprite(spriteId: number): Uint8Array {
    const averageHsl = 0x1234;
    const opaque = 1;
    const spriteCount = 1;
    const transform = 0;
    const animDir = 0;
    const animSpeed = 0;

    const out: number[] = [
        ...u16be(averageHsl),
        opaque,
        spriteCount,
        ...u16be(spriteId),
        ...i32be(transform),
        animDir,
        animSpeed,
    ];
    return new Uint8Array(out);
}

function buildProceduralTextureBytesConstantColour(rgb: number): Uint8Array {
    // Encodes a `ProceduralTexture` with one ConstantColour operation and no inputs.
    // This exercises the procedural decode + caching + output path without depending on cache files.
    const operationCount = 1;
    const operationId = 0;
    const typeIdConstantColour = 1;
    const cacheSlotCount = 0xff;
    const propertyCount = 1;
    const propertyId0 = 0;
    const colourOpIndex = 0;
    const monoOpIndex = 0;

    const out: number[] = [
        operationCount,
        operationId,
        typeIdConstantColour,
        cacheSlotCount,
        propertyCount,
        propertyId0,
        ...u24be(rgb),
        // inputs: none
        colourOpIndex,
        monoOpIndex,
    ];
    return new Uint8Array(out);
}

function buildProceduralTextureBytesPerlinSimple(seed: number): Uint8Array {
    // One PerlinNoise operation with defaults (unsignedOutput=true, persistenceQ12=1638, repeatX=repeatY=4),
    // but octaveCount=1 and explicit seed.
    const operationCount = 1;
    const operationId = 0;
    const typeIdPerlin = 34;
    const cacheSlotCount = 0xff;
    const propertyCount = 3;

    const out: number[] = [
        operationCount,
        operationId,
        typeIdPerlin,
        cacheSlotCount,
        propertyCount,
        0x00, // field 0: unsignedOutput
        0x01, // true
        0x01, // field 1: octaveCount
        0x01, // 1 octave
        0x04, // field 4: seed
        seed & 0xff,
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];

    return new Uint8Array(out);
}

function buildProceduralTextureBytesPerlinExplicitAmplitudes(): Uint8Array {
    // One PerlinNoise op with explicit amplitudes (persistenceQ12<0), 3 octaves, repeatX=5 repeatY=7.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x22, // type id: PerlinNoise (34)
        0xff, // cache slots
        0x06, // property count
        0x00, // field 0: unsignedOutput
        0x01, // true
        0x01, // field 1: octaveCount
        0x03, // 3
        0x02, // field 2: persistenceQ12 + explicit amplitudes
        ...i16be(-1),
        ...i16be(4096),
        ...i16be(2048),
        ...i16be(1024),
        0x05, // field 5: repeatX
        0x05,
        0x06, // field 6: repeatY
        0x07,
        0x04, // field 4: seed
        0x00, // seed=0
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function buildProceduralTextureBytesPerlinSignedMultiOctave(): Uint8Array {
    // One PerlinNoise op, unsignedOutput=false, 4 octaves, persistenceQ12=2867, seed=2, repeatX=3 repeatY=6.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x22, // type id: PerlinNoise (34)
        0xff, // cache slots
        0x06, // property count
        0x00, // field 0: unsignedOutput
        0x00, // false
        0x01, // field 1: octaveCount
        0x04, // 4
        0x02, // field 2: persistenceQ12
        ...i16be(2867),
        0x04, // field 4: seed
        0x02, // seed=2
        0x05, // field 5: repeatX
        0x03,
        0x06, // field 6: repeatY
        0x06,
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function buildProceduralTextureBytesEmbossOnHorizontalGradient(): Uint8Array {
    // Two ops: HorizontalGradient -> Emboss (defaults).
    const out: number[] = [
        0x02, // op count
        // op0: HorizontalGradient
        0x00, // op id
        0x02, // type id
        0xff, // cache slots
        0x00, // property count
        // op1: Emboss
        0x01, // op id
        0x20, // type id: Emboss (32)
        0xff, // cache slots
        0x00, // property count (use defaults)
        // inputs for op1: op0
        0x00,
        // colour op index
        0x01,
        // mono op index
        0x01,
    ];
    return new Uint8Array(out);
}

function buildProceduralTextureBytesEmbossOnHorizontalGradientLru(): Uint8Array {
    // Two ops: HorizontalGradient(cacheSlotCount=3) -> Emboss(cacheSlotCount=3).
    const out: number[] = [
        0x02, // op count
        // op0: HorizontalGradient
        0x00, // op id
        0x02, // type id
        0x03, // cache slots
        0x00, // property count
        // op1: Emboss
        0x01, // op id
        0x20, // type id: Emboss (32)
        0x03, // cache slots
        0x00, // property count (use defaults)
        // inputs for op1: op0
        0x00,
        // colour op index
        0x01,
        // mono op index
        0x01,
    ];
    return new Uint8Array(out);
}

function testSpriteTextureGolden(): void {
    const spriteBytes = buildPackedSpriteSingle2x2();
    const defBytes = buildSpriteTextureDefinitionSingleSprite(0);

    const defProvider = new MemoryEnumeratingBytesProvider(new Map([[0, defBytes]]));
    const spriteProvider = new MemoryBytesProvider(new Map([[0, spriteBytes]]));
    const loader = SpriteTextureLoader.create(defProvider, spriteProvider);

    const pixelsResult = loader.tryLoadPixelsArgb(0, 2, false, 1.0);
    assert(pixelsResult.ok, "SpriteTextureLoader: expected ok");
    const pixels = pixelsResult.value;
    const hash = fnv1a32Ints(pixels);

    // Stable value for this synthetic fixture. If this changes, we likely changed decode math/packing.
    assert(hash === 1187273937, `SpriteTextureLoader: hash changed (got=${hash})`);
}

function testSpriteTextureColumnMajorGolden(): void {
    const spriteBytes = buildPackedSpriteSingle2x2ColumnMajor();
    const defBytes = buildSpriteTextureDefinitionSingleSprite(0);

    const defProvider = new MemoryEnumeratingBytesProvider(new Map([[0, defBytes]]));
    const spriteProvider = new MemoryBytesProvider(new Map([[0, spriteBytes]]));
    const loader = SpriteTextureLoader.create(defProvider, spriteProvider);

    const pixelsResult = loader.tryLoadPixelsArgb(0, 2, false, 1.0);
    assert(pixelsResult.ok, "SpriteTextureLoader (column-major): expected ok");
    const pixels = pixelsResult.value;
    const hash = fnv1a32Ints(pixels);

    assert(hash === -1075740621, `SpriteTextureLoader (column-major): hash changed (got=${hash})`);
}

function testProceduralTextureGolden(): void {
    const bytes = buildProceduralTextureBytesConstantColour(0x112233);
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 4, 4, false, false, 1.0);
    for (let i = 0; i < pixels.length; i++) {
        assert(pixels[i] === (0xff112233 | 0), `ProceduralTexture: unexpected pixel at ${i}`);
    }
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1690597541, `ProceduralTexture: hash changed (got=${hash})`);
}

function testPerlinTextureGolden(): void {
    const bytes = buildProceduralTextureBytesPerlinSimple(0);
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1083685253, `PerlinNoise: hash changed (got=${hash})`);
}

function testPerlinExplicitAmplitudesTextureGolden(): void {
    const bytes = buildProceduralTextureBytesPerlinExplicitAmplitudes();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 994396825, `PerlinNoise(explicit): hash changed (got=${hash})`);
}

function testPerlinSignedMultiOctaveTextureGolden(): void {
    const bytes = buildProceduralTextureBytesPerlinSignedMultiOctave();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -1896865793, `PerlinNoise(signed): hash changed (got=${hash})`);
}

function testEmbossTextureGolden(): void {
    const bytes = buildProceduralTextureBytesEmbossOnHorizontalGradient();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 1, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 498467797, `Emboss: hash changed (got=${hash})`);
}

function testEmbossLruCacheTextureGolden(): void {
    const bytes = buildProceduralTextureBytesEmbossOnHorizontalGradientLru();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1953712197, `Emboss(LRU): hash changed (got=${hash})`);
}

function buildProceduralTextureBytesVoronoiSimple(): Uint8Array {
    // One VoronoiNoise op with defaults (repeat=5, seed=0, jitter=2048, outputMode=SecondMinusNearest, metric=1).
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x0f, // type id: VoronoiNoise (15)
        0xff, // cache slots
        0x00, // property count
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testVoronoiTextureGolden(): void {
    const bytes = buildProceduralTextureBytesVoronoiSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 16, 16, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1281243685, `VoronoiNoise: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesTrigWarpSimple(): Uint8Array {
    // ConstantColour -> TrigWarp(angle=HorizontalGradient, radius=ConstantMonochrome).
    const out: number[] = [
        0x04, // op count
        // op0: ConstantColour (rgb=0x112233)
        0x00,
        0x01,
        0xff,
        0x01,
        0x00,
        ...u24be(0x112233),
        // op1: HorizontalGradient
        0x01,
        0x02,
        0xff,
        0x00,
        // op2: ConstantMonochrome (v=255 -> 4096)
        0x02,
        0x00,
        0xff,
        0x01,
        0x00,
        0xff,
        // op3: TrigWarp (defaults, colour output)
        0x03,
        0x13, // type id: TrigWarp (19)
        0xff,
        0x00, // property count
        // inputs: base=op0, angle=op1, radius=op2
        0x00,
        0x01,
        0x02,
        // outputs
        0x03, // colour op index
        0x03, // mono op index
    ];
    return new Uint8Array(out);
}

function testTrigWarpTextureGolden(): void {
    const bytes = buildProceduralTextureBytesTrigWarpSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 16, 16, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -366360635, `TrigWarp: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesHslSimple(): Uint8Array {
    // ConstantColour -> Hsl(deltaHue=256, deltaSaturation=+10%, deltaLightness=-10%).
    const out: number[] = [
        0x02, // op count
        // op0: ConstantColour
        0x00,
        0x01,
        0xff,
        0x01,
        0x00,
        ...u24be(0x336699),
        // op1: Hsl
        0x01,
        0x11, // type id: Hsl (17)
        0xff,
        0x03, // property count
        0x00,
        ...i16be(256),
        0x01,
        10 & 0xff,
        0x02,
        -10 & 0xff,
        // inputs for op1: op0
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testHslTextureGolden(): void {
    const bytes = buildProceduralTextureBytesHslSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -1873673019, `Hsl: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesTilingSimple(): Uint8Array {
    // HorizontalGradient -> Tiling(tileCountH=2, tileCountV=2).
    const out: number[] = [
        0x02, // op count
        // op0: HorizontalGradient
        0x00,
        0x02,
        0xff,
        0x00,
        // op1: Tiling
        0x01,
        0x14, // type id: Tiling (20)
        0xff,
        0x02,
        0x00,
        0x02,
        0x01,
        0x02,
        // inputs for op1: op0
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testTilingTextureGolden(): void {
    const bytes = buildProceduralTextureBytesTilingSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -2062456891, `Tiling: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesSquareWaveformSimple(): Uint8Array {
    // One SquareWaveform op: periodCount=4, direction=Horizontal, dutyCycle default.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x1b, // type id: SquareWaveform (27)
        0xff, // cache slots
        0x02, // property count
        0x00, // field 0: periodCount
        0x04,
        0x02, // field 2: directionMode
        0x01, // Horizontal
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testSquareWaveformTextureGolden(): void {
    const bytes = buildProceduralTextureBytesSquareWaveformSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -857058491, `SquareWaveform: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesLineNoiseSimple(): Uint8Array {
    // One LineNoise op with small lineCount for a fast golden.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x26, // type id: LineNoise (38)
        0xff, // cache slots
        0x03, // property count
        0x00, // field 0: seed
        0x00,
        0x01, // field 1: lineCount
        ...u16be(20),
        0x02, // field 2: lineLength
        0x04,
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testLineNoiseTextureGolden(): void {
    const bytes = buildProceduralTextureBytesLineNoiseSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 16, 16, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1075852014, `LineNoise: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesShapeRasterizerSimple(): Uint8Array {
    // One ShapeRasterizer op with a few basic shapes. This is synthetic, but mirrors the TS decode/render path.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x1d, // type id: ShapeRasterizer (29)
        0xff, // cache slots
        0x02, // property count
        0x00, // field 0: shapes
        0x03, // 3 shapes
        // shape0: Line
        0x00, // type
        ...i16be(0),
        ...i16be(0),
        ...i16be(4096),
        ...i16be(4096),
        ...u24be(0xff0000),
        0x01, // outlineWidth (unused by renderer)
        // shape1: Rectangle
        0x02, // type
        ...i16be(512),
        ...i16be(512),
        ...i16be(3584),
        ...i16be(2048),
        ...u24be(0x00ff00), // fill
        ...u24be(0x0000ff), // outline
        0x02, // outlineWidth
        // shape2: Ellipse (fill-only via outlineWidth=0)
        0x03, // type
        ...i16be(2048), // centerX
        ...i16be(3072), // centerY
        ...i16be(1024), // radiusX
        ...i16be(512), // radiusY
        ...u24be(0xffff00), // fill
        ...u24be(0x00ffff), // outline (ignored with outlineWidth=0)
        0x00, // outlineWidth=0 => fill-only
        0x01, // field 1: isMonochrome
        0x00, // colour output
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testShapeRasterizerTextureGolden(): void {
    const bytes = buildProceduralTextureBytesShapeRasterizerSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -68779725, `ShapeRasterizer: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesBricksSimple(): Uint8Array {
    // One Bricks op (monochrome) with a few non-default params.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x04, // type id: Bricks (4)
        0xff, // cache slots
        0x03, // property count
        0x00, // field 0: columns
        0x05, // 5
        0x01, // field 1: rowCount
        0x07, // 7
        0x06, // field 6: mortarThicknessQ12 (u16)
        ...u16be(120),
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testBricksTextureGolden(): void {
    const bytes = buildProceduralTextureBytesBricksSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -1080788923, `Bricks: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesRangeThresholdSimple(): Uint8Array {
    // PseudoRandomNoise -> RangeThreshold(min=1500, max=3000).
    const out: number[] = [
        0x02, // op count
        // op0: PseudoRandomNoise (13)
        0x00,
        0x0d,
        0xff,
        0x00,
        // op1: RangeThreshold (26)
        0x01,
        0x1a,
        0xff,
        0x02, // property count
        0x00, // min
        ...u16be(1500),
        0x01, // max
        ...u16be(3000),
        // inputs for op1: op0
        0x00,
        // outputs
        0x01, // colour op index
        0x01, // mono op index
    ];
    return new Uint8Array(out);
}

function testRangeThresholdTextureGolden(): void {
    const bytes = buildProceduralTextureBytesRangeThresholdSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -671145707, `RangeThreshold: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesEdgeDetectorSimple(): Uint8Array {
    // PseudoRandomNoise -> MonochromeEdgeDetector(strength=4096).
    const out: number[] = [
        0x02, // op count
        // op0: PseudoRandomNoise (13)
        0x00,
        0x0d,
        0xff,
        0x00,
        // op1: MonochromeEdgeDetector (35)
        0x01,
        0x23,
        0xff,
        0x01, // property count
        0x00,
        ...u16be(4096),
        // inputs for op1: op0
        0x00,
        // outputs
        0x01, // colour op index
        0x01, // mono op index
    ];
    return new Uint8Array(out);
}

function testEdgeDetectorTextureGolden(): void {
    const bytes = buildProceduralTextureBytesEdgeDetectorSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -921469807, `MonochromeEdgeDetector: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesPseudoRandomNoiseOnly(): Uint8Array {
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x0d, // type id: PseudoRandomNoise (13)
        0xff, // cache slots
        0x00, // property count
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testPseudoRandomNoiseTextureGolden(): void {
    const bytes = buildProceduralTextureBytesPseudoRandomNoiseOnly();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -1014956354, `PseudoRandomNoise: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesKaleidoscopeSimple(): Uint8Array {
    // HorizontalGradient -> Kaleidoscope (colour output).
    const out: number[] = [
        0x02, // op count
        // op0: HorizontalGradient (2)
        0x00,
        0x02,
        0xff,
        0x00,
        // op1: Kaleidoscope (23)
        0x01,
        0x17,
        0xff,
        0x01, // property count
        0x00, // field 0: isMonochrome
        0x00, // false
        // inputs for op1: op0
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testKaleidoscopeTextureGolden(): void {
    const bytes = buildProceduralTextureBytesKaleidoscopeSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 903669829, `Kaleidoscope: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesIrregularBricksSimple(): Uint8Array {
    // One IrregularBricks op (seed=1) with defaults otherwise.
    const out: number[] = [
        0x01, // op count
        0x00, // op id
        0x1c, // type id: IrregularBricks (28)
        0xff, // cache slots
        0x01, // property count
        0x00, // field 0: seed
        0x01, // seed=1
        // inputs: none
        0x00, // colour op index
        0x00, // mono op index
    ];
    return new Uint8Array(out);
}

function testIrregularBricksTextureGolden(): void {
    const bytes = buildProceduralTextureBytesIrregularBricksSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -1988142712, `IrregularBricks: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesColourStripSimple(): Uint8Array {
    // ConstantMonochrome -> ColourStrip(colourR/G/B factors).
    const out: number[] = [
        0x02, // op count
        // op0: ConstantMonochrome (v=128)
        0x00,
        0x00,
        0xff,
        0x01,
        0x00,
        0x80,
        // op1: ColourStrip (11)
        0x01,
        0x0b,
        0xff,
        0x03,
        0x00,
        ...u16be(3000),
        0x01,
        ...u16be(2000),
        0x02,
        ...u16be(1000),
        // inputs for op1: op0
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testColourStripTextureGolden(): void {
    const bytes = buildProceduralTextureBytesColourStripSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -665541179, `ColourStrip: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesDiagonalGradientSimple(): Uint8Array {
    // One DiagonalGradient op (radial distance, triangle waveform, frequency=2).
    const out: number[] = [
        0x01,
        0x00,
        0x0c,
        0xff,
        0x03,
        0x00,
        0x01, // radial
        0x01,
        0x02, // triangle
        0x03,
        0x02, // frequency=2
        0x00,
        0x00,
    ];
    return new Uint8Array(out);
}

function testDiagonalGradientTextureGolden(): void {
    const bytes = buildProceduralTextureBytesDiagonalGradientSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1793811663, `DiagonalGradient: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesWeaveSimple(): Uint8Array {
    // One Weave op with strandHalfThicknessQ12=700.
    const out: number[] = [0x01, 0x00, 0x0e, 0xff, 0x01, 0x00, ...u16be(700), 0x00, 0x00];
    return new Uint8Array(out);
}

function testWeaveTextureGolden(): void {
    const bytes = buildProceduralTextureBytesWeaveSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 339314581, `Weave: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesWavyCrossSimple(): Uint8Array {
    // One WavyCross op (defaults).
    const out: number[] = [0x01, 0x00, 0x25, 0xff, 0x00, 0x00, 0x00];
    return new Uint8Array(out);
}

function testWavyCrossTextureGolden(): void {
    const bytes = buildProceduralTextureBytesWavyCrossSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1350480285, `WavyCross: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesGrayScaleSimple(): Uint8Array {
    // ConstantColour -> GrayScale.
    const out: number[] = [
        0x02,
        // op0: ConstantColour
        0x00,
        0x01,
        0xff,
        0x01,
        0x00,
        ...u24be(0x336699),
        // op1: GrayScale (24)
        0x01,
        0x18,
        0xff,
        0x00,
        // inputs for op1: op0
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testGrayScaleTextureGolden(): void {
    const bytes = buildProceduralTextureBytesGrayScaleSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1718949061, `GrayScale: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesHerringboneSimple(): Uint8Array {
    // One Herringbone op with scaleX=2, scaleY=3, gap=300.
    const out: number[] = [
        0x01,
        0x00,
        0x10,
        0xff,
        0x03,
        0x00,
        0x02,
        0x01,
        0x03,
        0x02,
        ...u16be(300),
        0x00,
        0x00,
    ];
    return new Uint8Array(out);
}

function testHerringboneTextureGolden(): void {
    const bytes = buildProceduralTextureBytesHerringboneSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === -535527363, `Herringbone: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesNormalMapSimple(): Uint8Array {
    // HorizontalGradient -> NormalMap(strength=4096, unsignedOutput=1).
    const out: number[] = [
        0x02,
        // op0: HorizontalGradient
        0x00,
        0x02,
        0xff,
        0x00,
        // op1: NormalMap (33)
        0x01,
        0x21,
        0xff,
        0x02,
        0x01,
        ...u16be(4096),
        0x02,
        0x01,
        // inputs for op1: op0
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testNormalMapTextureGolden(): void {
    const bytes = buildProceduralTextureBytesNormalMapSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 32, 32, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1800683461, `NormalMap: hash changed (got=${hash})`);
}

function buildProceduralTextureBytesBrightnessSimple(): Uint8Array {
    // ConstantColour -> Brightness(maxValue=500, factors, rgb delta).
    const out: number[] = [
        0x02,
        // op0: ConstantColour
        0x00,
        0x01,
        0xff,
        0x01,
        0x00,
        ...u24be(0x224466),
        // op1: Brightness (25)
        0x01,
        0x19,
        0xff,
        0x05,
        0x00,
        ...u16be(500),
        0x01,
        ...u16be(4500),
        0x02,
        ...u16be(4096),
        0x03,
        ...u16be(3000),
        0x04,
        ...u24be(0x112233),
        // inputs
        0x00,
        // outputs
        0x01,
        0x01,
    ];
    return new Uint8Array(out);
}

function testBrightnessTextureGolden(): void {
    const bytes = buildProceduralTextureBytesBrightnessSimple();
    const texture = new ProceduralTexture(new ByteBuffer(bytes), false);

    const dummyBytes: BytesProvider = { getBytes: () => undefined };
    const dummyLoader: any = {
        tryGetPixelsArgb: () => undefined,
        tryGetPixelsRgb: () => undefined,
    };
    const gen = new TextureGenerator(dummyBytes, dummyLoader);

    const pixels = texture.getPixelsArgb(gen, 8, 8, false, false, 1.0);
    const hash = fnv1a32Ints(pixels);
    assert(hash === 1896326853, `Brightness: hash changed (got=${hash})`);
}

function main(): void {
    testSpriteTextureGolden();
    testSpriteTextureColumnMajorGolden();
    testProceduralTextureGolden();
    testPerlinTextureGolden();
    testPerlinExplicitAmplitudesTextureGolden();
    testPerlinSignedMultiOctaveTextureGolden();
    testEmbossTextureGolden();
    testEmbossLruCacheTextureGolden();
    testVoronoiTextureGolden();
    testTrigWarpTextureGolden();
    testHslTextureGolden();
    testTilingTextureGolden();
    testSquareWaveformTextureGolden();
    testLineNoiseTextureGolden();
    testShapeRasterizerTextureGolden();
    testBricksTextureGolden();
    testRangeThresholdTextureGolden();
    testEdgeDetectorTextureGolden();
    testPseudoRandomNoiseTextureGolden();
    testKaleidoscopeTextureGolden();
    testIrregularBricksTextureGolden();
    testColourStripTextureGolden();
    testDiagonalGradientTextureGolden();
    testWeaveTextureGolden();
    testWavyCrossTextureGolden();
    testGrayScaleTextureGolden();
    testHerringboneTextureGolden();
    testNormalMapTextureGolden();
    testBrightnessTextureGolden();
    console.log("texture-golden: ok");
}

main();
