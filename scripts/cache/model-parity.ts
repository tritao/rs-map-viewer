import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { ModelData } from "../../src/rs/model/ModelData";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/loaders/CacheSession";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Args = {
    cacheName?: string;
    limit: number;
    ids?: number[];
    parts: boolean;
};

type TsEntry = { id: number; hash: number };
type CppEntry =
    | { id: number; ok: true; hash: number; parts?: Record<string, number> }
    | { id: number; ok: false; status: string; statusCode: number };

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 100, parts: false };
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
        } else if (a === "--parts") {
            args.parts = true;
        }
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) {
        throw new Error("Invalid --limit");
    }
    if (args.ids && args.ids.some((id) => !Number.isFinite(id))) {
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

function fnv1a32UpdateOptionalIntArray(h: number, values: ArrayLike<number> | undefined): number {
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

function hashModelDataParts(model: ModelData): Record<string, number> {
    const hashVec = (values: ArrayLike<number>): number => {
        let h = 2166136261 >>> 0;
        h = fnv1a32UpdateIntArray(h, values);
        return h | 0;
    };
    const hashOptVec = (values: ArrayLike<number> | undefined): number => {
        let h = 2166136261 >>> 0;
        h = fnv1a32UpdateOptionalIntArray(h, values);
        return h | 0;
    };
    const hashNestedOpt = (values: ArrayLike<ArrayLike<number>> | undefined): number => {
        let h = 2166136261 >>> 0;
        h = fnv1a32UpdateNestedIntArray(h, values);
        return h | 0;
    };

    let core = 2166136261 >>> 0;
    core = fnv1a32UpdateInt(core, 0x4d444154); // 'MDAT'
    core = fnv1a32UpdateInt(core, model.version | 0);
    core = fnv1a32UpdateInt(core, model.verticesCount | 0);
    core = fnv1a32UpdateInt(core, model.usedVertexCount | 0);
    core = fnv1a32UpdateInt(core, model.faceCount | 0);
    core = fnv1a32UpdateInt(core, model.textureFaceCount | 0);
    core = fnv1a32UpdateInt(core, model.priority | 0);

    return {
        core: core | 0,
        verticesX: hashVec(model.verticesX),
        verticesY: hashVec(model.verticesY),
        verticesZ: hashVec(model.verticesZ),
        indices1: hashVec(model.indices1),
        indices2: hashVec(model.indices2),
        indices3: hashVec(model.indices3),
        faceColors: hashVec(model.faceColors),
        faceRenderTypes: hashOptVec(model.faceRenderTypes),
        faceRenderPriorities: hashOptVec(model.faceRenderPriorities),
        faceAlphas: hashOptVec(model.faceAlphas),
        textureCoords: hashOptVec(model.textureCoords),
        faceTextures: hashOptVec(model.faceTextures),
        textureRenderTypes: hashVec(model.textureRenderTypes ?? new Int8Array(0)),
        textureMappingP: hashVec(model.textureMappingP ?? new Int16Array(0)),
        textureMappingM: hashVec(model.textureMappingM ?? new Int16Array(0)),
        textureMappingN: hashVec(model.textureMappingN ?? new Int16Array(0)),
        textureScaleX: hashVec(model.textureScaleX ?? new Int32Array(0)),
        textureScaleY: hashVec(model.textureScaleY ?? new Int32Array(0)),
        textureScaleZ: hashVec(model.textureScaleZ ?? new Int32Array(0)),
        textureRotation: hashVec(model.textureRotation ?? new Int8Array(0)),
        textureDirection: hashVec(model.textureDirection ?? new Int8Array(0)),
        textureSpeed: hashVec(model.textureSpeed ?? new Int32Array(0)),
        textureTransU: hashVec(model.textureTransU ?? new Int32Array(0)),
        textureTransV: hashVec(model.textureTransV ?? new Int32Array(0)),
        vertexSkins: hashOptVec(model.vertexSkins),
        faceSkins: hashOptVec(model.faceSkins),
        animMayaGroups: hashNestedOpt(model.animMayaGroups),
        animMayaScales: hashNestedOpt(model.animMayaScales),
    };
}

function hashModelData(model: ModelData): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4d444154); // 'MDAT'
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

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const hasRequestedIds = args.ids !== undefined && args.ids.length > 0;

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
    const session = sessionResult.value;
    const modelLoader = session.getModelLoader();
    if (!modelLoader) {
        throw new Error("TS session has no model service");
    }

    const candidateIds = hasRequestedIds
        ? args.ids!
        : Array.from({ length: modelLoader.getCount() }, (_, id) => id);
    const tsEntries: TsEntry[] = [];
    const idsToCheck: number[] = [];

    for (const id of candidateIds) {
        if (tsEntries.length >= args.limit) break;
        const loaded = modelLoader.tryLoad(id);
        if (!loaded.ok) {
            if (hasRequestedIds) {
                throw new Error(
                    `TS failed to decode requested model id=${id}: ${loaded.error.message}`,
                );
            }
            continue;
        }

        idsToCheck.push(id);
        tsEntries.push({ id, hash: hashModelData(loaded.value) });
    }

    if (tsEntries.length === 0) {
        throw new Error("No decodable models selected");
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
            idsToCheck.join(","),
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
    for (const ts of tsEntries) {
        const c = cppById.get(ts.id);
        if (!c) {
            mismatches++;
            console.error(`missing C++ entry id=${ts.id}`);
            continue;
        }
        if (!c.ok) {
            mismatches++;
            console.error(`C++ failed id=${ts.id}: status=${c.status} (${c.statusCode})`);
            continue;
        }
        if (c.hash !== ts.hash) {
            mismatches++;
            console.error(`hash mismatch id=${ts.id}: ts=${ts.hash} cpp=${c.hash}`);
            if (args.parts) {
                const loaded = modelLoader.tryLoad(ts.id);
                if (loaded.ok) {
                    const tsParts = hashModelDataParts(loaded.value);
                    const cppParts = c.parts ?? {};
                    const keys = Array.from(
                        new Set([...Object.keys(tsParts), ...Object.keys(cppParts)]),
                    ).sort();
                    for (const k of keys) {
                        const a = tsParts[k];
                        const b = cppParts[k];
                        if ((a | 0) !== (b | 0)) {
                            console.error(`  part mismatch ${k}: ts=${a | 0} cpp=${b | 0}`);
                        }
                    }
                } else {
                    console.error(`  (parts) TS re-load failed id=${ts.id}: ${loaded.error.message}`);
                }
            }
        }
    }

    console.log(
        `model-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} ids=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
