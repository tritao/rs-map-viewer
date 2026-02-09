import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { ModelData } from "../../src/rs/model/ModelData";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/runtime/createCacheSession";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Args = {
    cacheName?: string;
    limit: number;
    ids?: number[];
};

type TsEntry =
    | { id: number; ok: true; hash: number }
    | { id: number; ok: false; kind: "not_found" | "decode_failed" };
type CppEntry =
    | { id: number; ok: true; hash: number }
    | { id: number; ok: false; status: string; statusCode: number };

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 100 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--limit") args.limit = Number(argv[++i]);
        else if (a === "--ids") {
            args.ids = argv[++i]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => Number(s));
        }
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) {
        throw new Error("Invalid --limit");
    }
    if (args.ids && args.ids.some((id) => !Number.isFinite(id) || id < 0)) {
        throw new Error("Invalid --ids");
    }
    return args;
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
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

function fnv1a32UpdateIntArray(h: number, values: ArrayLike<number>): number {
    h = fnv1a32UpdateInt(h, values.length);
    for (let i = 0; i < values.length; i++) {
        h = fnv1a32UpdateInt(h, values[i] | 0);
    }
    return h >>> 0;
}

function fnv1a32UpdateOptionalIntArray(
    h: number,
    values: ArrayLike<number> | undefined,
): number {
    h = fnv1a32UpdateInt(h, values ? 1 : 0);
    if (values) {
        h = fnv1a32UpdateIntArray(h, values);
    }
    return h >>> 0;
}

function fnv1a32UpdateNestedIntArray(
    h: number,
    values: ArrayLike<ArrayLike<number>> | undefined,
): number {
    h = fnv1a32UpdateInt(h, values ? 1 : 0);
    if (!values) return h >>> 0;
    h = fnv1a32UpdateInt(h, values.length);
    for (let i = 0; i < values.length; i++) {
        h = fnv1a32UpdateIntArray(h, values[i]);
    }
    return h >>> 0;
}

function hashModelData(model: ModelData): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4d444154);
    h = fnv1a32UpdateInt(h, model.version | 0);
    h = fnv1a32UpdateInt(h, model.verticesCount | 0);
    h = fnv1a32UpdateInt(h, model.usedVertexCount | 0);
    h = fnv1a32UpdateInt(h, model.faceCount | 0);
    h = fnv1a32UpdateInt(h, model.textureFaceCount | 0);
    h = fnv1a32UpdateInt(h, model.priority | 0);
    h = fnv1a32UpdateIntArray(h, model.verticesX);
    h = fnv1a32UpdateIntArray(h, model.verticesY);
    h = fnv1a32UpdateIntArray(h, model.verticesZ);
    h = fnv1a32UpdateIntArray(h, model.indices1);
    h = fnv1a32UpdateIntArray(h, model.indices2);
    h = fnv1a32UpdateIntArray(h, model.indices3);
    h = fnv1a32UpdateIntArray(h, model.faceColors);
    h = fnv1a32UpdateOptionalIntArray(h, model.faceRenderTypes);
    h = fnv1a32UpdateOptionalIntArray(h, model.faceRenderPriorities);
    h = fnv1a32UpdateOptionalIntArray(h, model.faceAlphas);
    h = fnv1a32UpdateOptionalIntArray(h, model.textureCoords);
    h = fnv1a32UpdateOptionalIntArray(h, model.faceTextures);
    h = fnv1a32UpdateIntArray(h, model.textureRenderTypes ?? new Int8Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureMappingP ?? new Int16Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureMappingM ?? new Int16Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureMappingN ?? new Int16Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureScaleX ?? new Int32Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureScaleY ?? new Int32Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureScaleZ ?? new Int32Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureRotation ?? new Int8Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureDirection ?? new Int8Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureSpeed ?? new Int32Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureTransU ?? new Int32Array(0));
    h = fnv1a32UpdateIntArray(h, model.textureTransV ?? new Int32Array(0));
    h = fnv1a32UpdateOptionalIntArray(h, model.vertexSkins);
    h = fnv1a32UpdateOptionalIntArray(h, model.faceSkins);
    h = fnv1a32UpdateNestedIntArray(h, model.animMayaGroups);
    h = fnv1a32UpdateNestedIntArray(h, model.animMayaScales);
    return h | 0;
}

function buildIds(count: number, limit: number, requested?: number[]): number[] {
    if (requested && requested.length > 0) {
        return requested;
    }
    const ids = new Set<number>();
    const max = Math.min(limit, count);
    for (let id = 0; id < max; id++) ids.add(id);
    ids.add(count);
    ids.add(count + 1);
    return Array.from(ids.values());
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const caches = loadCacheInfos();
    const cacheInfo = pickCache(caches, args.cacheName);
    const cacheType = detectCacheType(cacheInfo);
    const bundle = loadCacheFiles(cacheInfo);
    const compression = new JSCompressionHandler();
    const cacheSystem = createCacheSystemFromFiles(cacheType, bundle, compression);
    const loadedCache: LoadedCache = {
        info: cacheInfo,
        type: cacheType,
        bundle,
        xteas: new Map<number, XteaKey>(),
    };
    const sessionResult = tryCreateCacheSessionFromSystem(loadedCache, cacheSystem);
    if (!sessionResult.ok) {
        throw new Error(initErrorToString(sessionResult.error));
    }
    const modelLoader = sessionResult.value.getModelLoader();
    if (!modelLoader) {
        throw new Error("TS session has no model service");
    }

    const ids = buildIds(modelLoader.getCount(), args.limit, args.ids);
    const tsEntries = new Map<number, TsEntry>();
    for (const id of ids) {
        const result = modelLoader.tryLoad(id);
        if (!result.ok) {
            tsEntries.set(id, { id, ok: false, kind: result.error.kind });
        } else {
            tsEntries.set(id, { id, ok: true, hash: hashModelData(result.value) });
        }
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "model_hashes",
            "--cache",
            cacheInfo.name,
            "--game",
            String(getGameTypeName(cacheInfo.game)),
            "--revision",
            String(cacheInfo.revision),
            "--ids",
            ids.join(","),
        ],
        { encoding: "utf8" },
    );
    if (cpp.status !== 0) {
        throw new Error(`rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
    }

    const parsed = JSON.parse(cpp.stdout) as { entries: CppEntry[] };
    const cppById = new Map<number, CppEntry>();
    for (const e of parsed.entries) cppById.set(e.id, e);

    let mismatches = 0;
    for (const id of ids) {
        const ts = tsEntries.get(id);
        const cppEntry = cppById.get(id);
        if (!ts || !cppEntry) {
            mismatches++;
            console.error(`missing entry id=${id}`);
            continue;
        }

        if (ts.ok) {
            if (!cppEntry.ok) {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=ok cpp=${cppEntry.status}`);
                continue;
            }
            if (ts.hash !== cppEntry.hash) {
                mismatches++;
                console.error(`hash mismatch id=${id}: ts=${ts.hash} cpp=${cppEntry.hash}`);
            }
            continue;
        }

        if (cppEntry.ok) {
            mismatches++;
            console.error(`status mismatch id=${id}: ts=${ts.kind} cpp=ok`);
            continue;
        }

        if (ts.kind === "not_found") {
            if (cppEntry.status !== "NotFound" && cppEntry.status !== "OutOfRange") {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=not_found cpp=${cppEntry.status}`);
            }
        } else {
            if (cppEntry.status === "NotFound" || cppEntry.status === "OutOfRange") {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=decode_failed cpp=${cppEntry.status}`);
            }
        }
    }

    console.log(
        `model-status-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} ids=${ids.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
