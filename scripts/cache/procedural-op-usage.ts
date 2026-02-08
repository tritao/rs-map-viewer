import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId, Rs2IndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import {
    EnumeratingArchiveBytesProvider,
    IndexFileBytesProvider,
    IndexSmartFileBytesProvider,
} from "../../src/rs/io/BytesProvider";
import { computeCacheRules } from "../../src/rs/loaders/CacheRules";
import { OldProceduralTextureLoader } from "../../src/rs/texture/OldProceduralTextureLoader";
import { ProceduralTextureLoader } from "../../src/rs/texture/ProceduralTextureLoader";
import { TextureOperationTypeId } from "../../src/rs/texture/procedural/operation/TextureOperationFactory";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Args = { cacheName?: string };

function parseArgs(argv: string[]): Args {
    const args: Args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") {
            args.cacheName = argv[++i];
        }
    }
    return args;
}

const OP_CLASS_TO_ID: Record<string, TextureOperationTypeId> = {
    ConstantMonochromeOperation: TextureOperationTypeId.ConstantMonochrome,
    ConstantColourOperation: TextureOperationTypeId.ConstantColour,
    HorizontalGradientOperation: TextureOperationTypeId.HorizontalGradient,
    VerticalGradientOperation: TextureOperationTypeId.VerticalGradient,
    BricksOperation: TextureOperationTypeId.Bricks,
    BlurOperation: TextureOperationTypeId.Blur,
    ClampOperation: TextureOperationTypeId.Clamp,
    ArithmeticOperation: TextureOperationTypeId.Arithmetic,
    CurveOperation: TextureOperationTypeId.Curve,
    MirrorOperation: TextureOperationTypeId.Mirror,
    GradientOperation: TextureOperationTypeId.Gradient,
    ColourStripOperation: TextureOperationTypeId.ColourStrip,
    DiagonalGradientOperation: TextureOperationTypeId.DiagonalGradient,
    PseudoRandomNoiseOperation: TextureOperationTypeId.PseudoRandomNoise,
    WeaveOperation: TextureOperationTypeId.Weave,
    VoronoiNoiseOperation: TextureOperationTypeId.VoronoiNoise,
    HerringboneOperation: TextureOperationTypeId.Herringbone,
    HslOperation: TextureOperationTypeId.Hsl,
    TilingSpriteOperation: TextureOperationTypeId.TilingSprite,
    TrigWarpOperation: TextureOperationTypeId.TrigWarp,
    TilingOperation: TextureOperationTypeId.Tiling,
    LerpOperation: TextureOperationTypeId.Lerp,
    InvertOperation: TextureOperationTypeId.Invert,
    KaleidoscopeOperation: TextureOperationTypeId.Kaleidoscope,
    GrayScaleOperation: TextureOperationTypeId.GrayScale,
    BrightnessOperation: TextureOperationTypeId.Brightness,
    RangeThresholdOperation: TextureOperationTypeId.RangeThreshold,
    SquareWaveformOperation: TextureOperationTypeId.SquareWaveform,
    IrregularBricksOperation: TextureOperationTypeId.IrregularBricks,
    ShapeRasterizerOperation: TextureOperationTypeId.ShapeRasterizer,
    RangeOperation: TextureOperationTypeId.Range,
    MandelbrotOperation: TextureOperationTypeId.Mandelbrot,
    EmbossOperation: TextureOperationTypeId.Emboss,
    NormalMapOperation: TextureOperationTypeId.NormalMap,
    PerlinNoiseOperation: TextureOperationTypeId.PerlinNoise,
    MonochromeEdgeDetectorOperation: TextureOperationTypeId.MonochromeEdgeDetector,
    TextureSourceOperation: TextureOperationTypeId.TextureSource,
    WavyCrossOperation: TextureOperationTypeId.WavyCross,
    LineNoiseOperation: TextureOperationTypeId.LineNoise,
    SpriteSourceOperation: TextureOperationTypeId.SpriteSource,
};

function printCounts(countsById: Map<number, number>): void {
    const entries = Array.from(countsById.entries()).sort((a, b) => b[1] - a[1]);
    for (const [id, count] of entries) {
        const name = TextureOperationTypeId[id as TextureOperationTypeId] ?? String(id);
        console.log(`${String(id).padStart(2, " ")} ${name.padEnd(24, " ")} ${count}`);
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const caches = loadCacheInfos();
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");

    const cacheInfo: CacheInfo = args.cacheName
        ? caches.find((c) => c.name === args.cacheName) ?? latest
        : latest;
    const cacheType = detectCacheType(cacheInfo);
    if (cacheType !== CacheType.Dat2) {
        throw new Error(`Only dat2 caches are supported (got ${cacheType})`);
    }

    const cacheBundle = loadCacheFiles(cacheInfo);
    const compressionHandler = new JSCompressionHandler();
    const cacheSystem = createCacheSystemFromFiles(cacheType, cacheBundle, compressionHandler);

    const rules = computeCacheRules(cacheInfo, cacheSystem as any);
    console.log(
        `cache=${cacheInfo.name} rev=${cacheInfo.revision} textureMode=${rules.texture.mode}`,
    );

    if (rules.texture.mode === "sprite") {
        console.log("sprite textures mode; no procedural ops to report");
        return;
    }

    const spriteIndex = cacheSystem.getIndex(Dat2IndexId.sprites);
    const textureIndex = cacheSystem.getIndex(Dat2IndexId.textures);

    const countsById = new Map<number, number>();
    const unknownClasses = new Map<string, number>();

    if (rules.texture.mode === "materials") {
        const materialsIndex = cacheSystem.getIndex(Rs2IndexId.materials);
        const materialsFile = materialsIndex.tryGetFile(0, 0);
        if (!materialsFile) throw new Error("missing materials file (0,0)");

        const loader = ProceduralTextureLoader.create(
            rules.texture.hasAlphaMaterialField,
            rules.texture.hasAlphaOperation,
            materialsFile.data,
            new IndexSmartFileBytesProvider(textureIndex, null),
            new IndexFileBytesProvider(spriteIndex, 0),
        );

        for (const id of loader.getTextureIds()) {
            const def = loader.getTexture(id);
            if (!def) continue;
            for (const op of def.proceduralTexture.operations) {
                const name = (op as any)?.constructor?.name ?? "unknown";
                const typeId = OP_CLASS_TO_ID[name];
                if (typeId === undefined) {
                    unknownClasses.set(name, (unknownClasses.get(name) ?? 0) + 1);
                    continue;
                }
                countsById.set(typeId, (countsById.get(typeId) ?? 0) + 1);
            }
        }
    } else if (rules.texture.mode === "old_procedural") {
        const archive = textureIndex.tryGetArchive(0);
        const source = archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
        const loader = OldProceduralTextureLoader.create(
            source,
            new IndexFileBytesProvider(spriteIndex, 0),
        );

        for (const id of loader.getTextureIds()) {
            const def = loader.definitions.get(id);
            if (!def) continue;
            for (const op of def.proceduralTexture.operations) {
                const name = (op as any)?.constructor?.name ?? "unknown";
                const typeId = OP_CLASS_TO_ID[name];
                if (typeId === undefined) {
                    unknownClasses.set(name, (unknownClasses.get(name) ?? 0) + 1);
                    continue;
                }
                countsById.set(typeId, (countsById.get(typeId) ?? 0) + 1);
            }
        }
    }

    printCounts(countsById);

    const unknown = Array.from(unknownClasses.entries()).sort((a, b) => b[1] - a[1]);
    if (unknown.length > 0) {
        console.log("\nunknown op classes:");
        for (const [name, count] of unknown) {
            console.log(`${name}: ${count}`);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
