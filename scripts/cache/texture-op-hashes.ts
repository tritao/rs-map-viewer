import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
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
import { SpriteTextureLoader } from "../../src/rs/texture/SpriteTextureLoader";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Args = {
    cacheName?: string;
    id: number;
    size: number;
    brightness: number;
    flipH: boolean;
};

function parseArgs(argv: string[]): Args {
    const args: Args = { id: -1, size: 128, brightness: 1.0, flipH: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") {
            args.cacheName = argv[++i];
        } else if (a === "--id") {
            args.id = Number(argv[++i]);
        } else if (a === "--size") {
            args.size = Number(argv[++i]);
        } else if (a === "--brightness") {
            args.brightness = Number(argv[++i]);
        } else if (a === "--flipH") {
            args.flipH = true;
        }
    }
    if (!Number.isFinite(args.id) || args.id < 0) throw new Error("Missing/invalid --id <n>");
    if (!Number.isFinite(args.size) || args.size <= 0) throw new Error("Invalid --size");
    if (!Number.isFinite(args.brightness)) throw new Error("Invalid --brightness");
    return args;
}

function fnv1a32UpdateInt(h: number, v: number): number {
    const x = v >>> 0;
    h ^= x & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const caches = loadCacheInfos();
    const cacheInfo = pickCache(caches, args.cacheName);
    const cacheType = detectCacheType(cacheInfo);
    if (cacheType !== CacheType.Dat2) {
        throw new Error(`Only dat2 caches are supported (got ${cacheType})`);
    }

    const cacheBundle = loadCacheFiles(cacheInfo);
    const cacheSystem = createCacheSystemFromFiles(
        cacheType,
        cacheBundle,
        new JSCompressionHandler(),
    );
    const rules = computeCacheRules(cacheInfo, cacheSystem as any);

    const spriteIndex = cacheSystem.getIndex(Dat2IndexId.sprites);
    const textureIndex = cacheSystem.getIndex(Dat2IndexId.textures);
    const spriteSource = new IndexFileBytesProvider(spriteIndex, 0);

    const mode = rules.texture.mode;
    let loader: any;

    if (mode === "sprite") {
        const archive = textureIndex.tryGetArchive(0);
        const defSource = archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
        loader = SpriteTextureLoader.create(defSource, spriteSource);
    } else if (mode === "materials") {
        const materialsIndex = cacheSystem.getIndex(Rs2IndexId.materials);
        const materialsFile = materialsIndex.tryGetFile(0, 0);
        if (!materialsFile) throw new Error("missing materials file (0,0)");
        const texRules: any = rules.texture;
        loader = ProceduralTextureLoader.create(
            Boolean(texRules.hasAlphaMaterialField),
            Boolean(texRules.hasAlphaOperation),
            materialsFile.data,
            new IndexSmartFileBytesProvider(textureIndex, null),
            spriteSource,
        );
    } else {
        const archive = textureIndex.tryGetArchive(0);
        const source = archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
        loader = OldProceduralTextureLoader.create(source, spriteSource);
    }

    const def = loader.getTexture?.(args.id) ?? loader.definitions?.get?.(args.id);
    if (!def) {
        throw new Error(`Missing texture definition id=${args.id}`);
    }
    const ops: any[] = def.proceduralTexture.operations;
    if (!Array.isArray(ops) || ops.length === 0) {
        throw new Error("No operations decoded");
    }

    for (const op of ops) {
        op.initCaches(loader.textureGenerator, args.size, args.size);
    }
    loader.textureGenerator.initBrightness(args.brightness);
    loader.textureGenerator.init(args.size, args.size);

    const opHashes = [];
    const indexOfOp = new Map<any, number>();
    for (let i = 0; i < ops.length; i++) {
        indexOfOp.set(ops[i], i);
    }
    for (let opIndex = 0; opIndex < ops.length; opIndex++) {
        const op = ops[opIndex];
        let h = 2166136261 >>> 0;
        if (op.isMonochrome) {
            for (let line = 0; line < args.size; line++) {
                const out: Int32Array = op.getMonochromeOutput(loader.textureGenerator, line);
                for (let i = 0; i < out.length; i++) {
                    h = fnv1a32UpdateInt(h, out[i] | 0);
                }
            }
        } else {
            for (let line = 0; line < args.size; line++) {
                const out: Int32Array[] = op.getColourOutput(loader.textureGenerator, line);
                for (let i = 0; i < out[0].length; i++) h = fnv1a32UpdateInt(h, out[0][i] | 0);
                for (let i = 0; i < out[1].length; i++) h = fnv1a32UpdateInt(h, out[1][i] | 0);
                for (let i = 0; i < out[2].length; i++) h = fnv1a32UpdateInt(h, out[2][i] | 0);
            }
        }
        opHashes.push({
            opIndex,
            operationId: op.operationId,
            cacheSlotCount: op.cacheSlotCount,
            isMonochrome: Boolean(op.isMonochrome),
            inputs: Array.from(op.inputs ?? []).map((x: any) => indexOfOp.get(x) ?? -1),
            hash: h | 0,
        });
    }

    for (const op of ops) {
        op.clearCaches();
    }

    console.log(
        JSON.stringify(
            {
                schema: 1,
                cache: {
                    name: cacheInfo.name,
                    game: String(getGameTypeName(cacheInfo.game)),
                    revision: cacheInfo.revision,
                },
                textureMode: mode,
                id: args.id,
                size: args.size,
                brightness: args.brightness,
                flipH: args.flipH,
                opHashes,
            },
            null,
            2,
        ),
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
