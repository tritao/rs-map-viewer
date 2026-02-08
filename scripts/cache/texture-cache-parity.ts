import { spawnSync } from "child_process";

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
    size: number;
    brightness: number;
    flipH: boolean;
    limit: number;
    ids?: number[];
};

function parseArgs(argv: string[]): Args {
    const args: Args = { size: 128, brightness: 1.0, flipH: false, limit: 50 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") {
            args.cacheName = argv[++i];
        } else if (a === "--size") {
            args.size = Number(argv[++i]);
        } else if (a === "--brightness") {
            args.brightness = Number(argv[++i]);
        } else if (a === "--flipH") {
            args.flipH = true;
        } else if (a === "--limit") {
            args.limit = Number(argv[++i]);
        } else if (a === "--ids") {
            args.ids = argv[++i]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => Number(s));
        }
    }
    if (!Number.isFinite(args.size) || args.size <= 0) throw new Error("Invalid --size");
    if (!Number.isFinite(args.brightness)) throw new Error("Invalid --brightness");
    if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("Invalid --limit");
    if (args.ids && args.ids.some((x) => !Number.isFinite(x))) throw new Error("Invalid --ids");
    return args;
}

function fnv1a32Ints(ints: Int32Array): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < ints.length; i++) {
        const x = ints[i] >>> 0;
        h ^= x & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (x >>> 8) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (x >>> 16) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (x >>> 24) & 0xff;
        h = Math.imul(h, 16777619);
    }
    return h | 0;
}

const UNSUPPORTED_OP_CLASSES = new Set<string>([
    // C++ operation not implemented yet.
    "MandelbrotOperation",
]);

function usesUnsupportedOps(def: any): boolean {
    const ops: any[] = def?.proceduralTexture?.operations ?? [];
    for (const op of ops) {
        const name: string | undefined = op?.constructor?.name;
        if (name && UNSUPPORTED_OP_CLASSES.has(name)) {
            return true;
        }
    }
    return false;
}

function describeOp(op: any): string {
    const name = op?.constructor?.name ?? "unknown";
    const opId = op?.operationId;
    const cacheSlotCount = op?.cacheSlotCount;

    const base = `${name}${typeof opId === "number" ? `#${opId}` : ""}${
        typeof cacheSlotCount === "number" ? ` slot=${cacheSlotCount}` : ""
    }`;
    switch (name) {
        case "PerlinNoiseOperation":
            return `${base} unsigned=${op.unsignedOutput} octaves=${
                op.octaveCount
            } persistenceQ12=${op.persistenceQ12} seed=${op.seed} repeatX=${op.repeatX} repeatY=${
                op.repeatY
            } amplitudes=${
                op.amplitudeByOctaveQ12 ? Array.from(op.amplitudeByOctaveQ12).join(",") : "?"
            }`;
        case "EmbossOperation":
            return `${base} strengthQ12=${op.strengthQ12} azimuthQ12=${op.lightAzimuthQ12} elevationQ12=${op.lightElevationQ12}`;
        case "BlurOperation":
            return `${base} hExtent=${op.hExtent} vExtent=${op.vExtent} mono=${op.isMonochrome}`;
        case "CurveOperation":
            return `${base} mode=${op.interpolationMode} points=${op.controlPoints?.length ?? 0}`;
        case "ArithmeticOperation":
            return `${base} blendMode=${op.blendMode} mono=${op.isMonochrome}`;
        case "ClampOperation":
            return `${base} mono=${op.isMonochrome} min=${op.min} max=${op.max}`;
        case "TrigWarpOperation":
            return `${base} mono=${op.isMonochrome} radiusMultiplierQ16=${op.radiusMultiplierQ16}`;
        case "BricksOperation":
        case "IrregularBricksOperation":
            return `${base}`;
        case "TilingOperation":
            return `${base} hCount=${op.tileCountH} vCount=${op.tileCountV}`;
        default:
            return base;
    }
}

type TextureMode = "sprite" | "materials" | "old_procedural";

type TsHashEntry = { id: number; hash: number };
type CppHashEntry =
    | { id: number; ok: true; hash: number }
    | { id: number; ok: false; status: string; statusCode: number };

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const hasRequestedIds = args.ids !== undefined && args.ids.length > 0;

    const caches = loadCacheInfos();
    const cacheInfo = pickCache(caches, args.cacheName);

    const cacheType = detectCacheType(cacheInfo);
    if (cacheType !== CacheType.Dat2) {
        throw new Error(`Only dat2 caches are supported (got ${cacheType})`);
    }

    const cacheBundle = loadCacheFiles(cacheInfo);
    const compressionHandler = new JSCompressionHandler();
    const cacheSystem = createCacheSystemFromFiles(cacheType, cacheBundle, compressionHandler);
    const rules = computeCacheRules(cacheInfo, cacheSystem as any);

    const mode = rules.texture.mode as TextureMode;
    const spriteIndex = cacheSystem.getIndex(Dat2IndexId.sprites);
    const textureIndex = cacheSystem.getIndex(Dat2IndexId.textures);

    const spriteSource = new IndexFileBytesProvider(spriteIndex, 0);

    let loader: SpriteTextureLoader | ProceduralTextureLoader | OldProceduralTextureLoader;

    if (mode === "sprite") {
        const archive = textureIndex.tryGetArchive(0);
        const defSource = archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
        loader = SpriteTextureLoader.create(defSource, spriteSource);
    } else if (mode === "materials") {
        const texRules = rules.texture as any;
        const materialsIndex = cacheSystem.getIndex(Rs2IndexId.materials);
        const materialsFile = materialsIndex.tryGetFile(0, 0);
        if (!materialsFile) throw new Error("missing materials file (0,0)");
        loader = ProceduralTextureLoader.create(
            Boolean(texRules.hasAlphaMaterialField),
            Boolean(texRules.hasAlphaOperation),
            materialsFile.data,
            new IndexSmartFileBytesProvider(textureIndex, null),
            spriteSource,
        );
    } else if (mode === "old_procedural") {
        const archive = textureIndex.tryGetArchive(0);
        const source = archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
        loader = OldProceduralTextureLoader.create(source, spriteSource);
    } else {
        throw new Error(`Unknown texture mode: ${String(mode)}`);
    }

    const idsToCheck: number[] = [];
    const tsEntries: TsHashEntry[] = [];

    const candidateIds = hasRequestedIds ? args.ids! : loader.getTextureIds();

    for (let i = 0; i < candidateIds.length && idsToCheck.length < args.limit; i++) {
        const id = candidateIds[i];
        if (id === undefined || id === null) continue;

        if (!hasRequestedIds) {
            const def = (loader as any).getTexture?.(id) ?? (loader as any).definitions?.get?.(id);
            if (def && usesUnsupportedOps(def)) {
                continue;
            }
        }

        const pixels = loader.tryGetPixelsArgb(id, args.size, args.flipH, args.brightness);
        if (!pixels) {
            if (hasRequestedIds) {
                throw new Error(`TS failed to render requested texture id=${id}`);
            }
            continue;
        }

        idsToCheck.push(id);
        tsEntries.push({ id, hash: fnv1a32Ints(pixels) });
    }

    if (idsToCheck.length === 0) {
        throw new Error("No renderable texture ids selected");
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "texture_hashes",
            "--cache",
            cacheInfo.name,
            "--game",
            String(getGameTypeName(cacheInfo.game)),
            "--revision",
            String(cacheInfo.revision),
            "--ids",
            idsToCheck.join(","),
            "--size",
            String(args.size),
            "--brightness",
            String(args.brightness),
            ...(args.flipH ? ["--flipH"] : []),
        ],
        { encoding: "utf8" },
    );

    if (cpp.status !== 0) {
        const errMsg = `rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`;
        if (cpp.error) {
            (cpp.error as any).message = `${cpp.error.message}\n${errMsg}`;
            throw cpp.error;
        }
        throw new Error(errMsg);
    }

    const parsed = JSON.parse(cpp.stdout) as { textureMode: TextureMode; entries: CppHashEntry[] };
    if (parsed.textureMode !== mode) {
        throw new Error(`Mode mismatch TS=${mode} C++=${parsed.textureMode}`);
    }

    const cppById = new Map<number, CppHashEntry>();
    for (const e of parsed.entries) {
        cppById.set(e.id, e);
    }

    let mismatches = 0;
    let errors = 0;
    for (const ts of tsEntries) {
        const cppEntry = cppById.get(ts.id);
        if (!cppEntry) {
            mismatches++;
            console.error(`missing cpp entry id=${ts.id} tsHash=${ts.hash}`);
            continue;
        }
        if (!cppEntry.ok) {
            errors++;
            console.error(
                `cpp failed id=${ts.id} status=${cppEntry.status} (${cppEntry.statusCode})`,
            );
            continue;
        }
        if (cppEntry.hash !== ts.hash) {
            mismatches++;
            console.error(`hash mismatch id=${ts.id} ts=${ts.hash} cpp=${cppEntry.hash}`);

            if (mode !== "sprite") {
                const def =
                    (loader as any).getTexture?.(ts.id) ??
                    (loader as any).definitions?.get?.(ts.id);
                const ops: any[] = def?.proceduralTexture?.operations ?? [];
                const desc = ops.map(describeOp);
                if (desc.length > 0) {
                    console.error(`  ops: ${desc.join(" -> ")}`);
                }
            }
        }
    }

    console.log(
        `texture-cache-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} mode=${mode} size=${args.size} ids=${idsToCheck.length} mismatches=${mismatches} errors=${errors}`,
    );

    if (mismatches > 0 || errors > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
