import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/loaders/CacheSession";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { SkeletalPools } from "../../src/rs/model/skeletal/SkeletalPools";
import { SkeletalSeq } from "../../src/rs/model/skeletal/SkeletalSeq";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";
import {
    type StatusKind,
    fnv1a32UpdateInt,
    statusKindFromCppStatus,
    toStatusKind,
} from "./parity-util";

type Args = {
    cacheName?: string;
    limit: number;
    maxFrames: number;
    ids?: number[];
};

type TsSample = { frame: number; ok: true; boneCount: number; hash: number };

type TsEntry =
    | {
          id: number;
          ok: true;
          baseId: number;
          poseId: number;
          curveCount: number;
          frameCount: number;
          samples: TsSample[];
      }
    | { id: number; ok: false; kind: StatusKind };

type CppSample =
    | { frame: number; ok: true; boneCount: number; hash: number }
    | { frame: number; ok: false; status: string; statusCode?: number; errorClass?: StatusKind };
type CppEntry =
    | {
          id: number;
          ok: true;
          baseId: number;
          poseId: number;
          curveCount: number;
          frameCount: number;
          samples: CppSample[];
      }
    | { id: number; ok: false; status: string; statusCode: number; errorClass?: StatusKind };

const FLOAT_BYTES = new ArrayBuffer(4);
const FLOAT_VIEW = new DataView(FLOAT_BYTES);

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 20, maxFrames: 8 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--limit") args.limit = Number(argv[++i]);
        else if (a === "--maxFrames") args.maxFrames = Number(argv[++i]);
        else if (a === "--ids") {
            args.ids = argv[++i]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => Number(s));
        }
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("Invalid --limit");
    if (!Number.isFinite(args.maxFrames) || args.maxFrames <= 0)
        throw new Error("Invalid --maxFrames");
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

function fnv1a32UpdateFloat(h: number, v: number): number {
    FLOAT_VIEW.setFloat32(0, v, true);
    const bits = FLOAT_VIEW.getUint32(0, true);
    return fnv1a32UpdateInt(h, bits);
}

function hashSkeletalFinalMatrices(
    seq: SkeletalSeq,
    frame: number,
): { boneCount: number; hash: number } {
    const pools = new SkeletalPools();
    pools.reset();

    const base = seq.skeletalBase;
    base.updateAnimMatrices(seq, frame, pools);
    const boneCount = base.getBoneCount();

    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x534b464d); // 'SKFM'
    h = fnv1a32UpdateInt(h, boneCount | 0);

    for (let i = 0; i < boneCount; i++) {
        const bone = base.getBone(i);
        if (!bone) continue;
        const m = bone.getFinalMatrix(seq.poseId);
        for (let e = 0; e < 16; e++) {
            h = fnv1a32UpdateFloat(h, m[e]);
        }
    }

    return { boneCount, hash: h | 0 };
}

function collectSkeletalIds(
    tryLoadSeqType: (id: number) => { ok: true; value: any } | { ok: false },
    skeletalSeqLoader: { tryLoad(id: number): { ok: true; value: SkeletalSeq } | { ok: false } },
    limit: number,
): number[] {
    const curveIds = new Set<number>();
    const baseOnly = new Set<number>();
    const anyIds = new Set<number>();
    const maxProbe = Math.max(120000, limit * 10000);

    for (let id = 0; id < maxProbe; id++) {
        const seqType = tryLoadSeqType(id);
        if (!seqType.ok) continue;
        const skeletalId = seqType.value.animMayaId | 0;
        if (skeletalId < 0) continue;
        anyIds.add(skeletalId);
        const seq = skeletalSeqLoader.tryLoad(skeletalId);
        if (!seq.ok) {
            if (baseOnly.size >= limit && anyIds.size >= limit) break;
            continue;
        }
        if ((seq.value.curveCount | 0) === 0) baseOnly.add(skeletalId);
        else curveIds.add(skeletalId);
        if (baseOnly.size + curveIds.size >= limit && anyIds.size >= limit) {
            break;
        }
    }

    if (anyIds.size === 0) {
        const directProbe = Math.max(120000, limit * 10000);
        for (let id = 0; id < directProbe; id++) {
            const seq = skeletalSeqLoader.tryLoad(id);
            if (!seq.ok) continue;
            anyIds.add(id);
            if ((seq.value.curveCount | 0) === 0) baseOnly.add(id);
            else curveIds.add(id);
            if (baseOnly.size + curveIds.size >= limit && anyIds.size >= limit) break;
        }
    }

    const preferred = Array.from(curveIds.values()).concat(Array.from(baseOnly.values()));
    if (preferred.length > 0) {
        return preferred.slice(0, limit);
    }
    return Array.from(anyIds.values()).slice(0, limit);
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
    const session = sessionResult.value;
    const skeletalSeqLoader = session.getSkeletalSeqLoader();
    if (!skeletalSeqLoader) {
        throw new Error("TS session has no skeletal-seq service for this cache");
    }

    const ids =
        args.ids && args.ids.length > 0
            ? args.ids
            : collectSkeletalIds((id) => session.tryLoadSeqType(id), skeletalSeqLoader, args.limit);
    if (ids.length === 0) {
        throw new Error("No skeletal seq ids selected");
    }

    const tsById = new Map<number, TsEntry>();
    for (const id of ids) {
        const loaded = skeletalSeqLoader.tryLoad(id);
        if (!loaded.ok) {
            tsById.set(id, { id, ok: false, kind: toStatusKind((loaded as any).error?.kind) });
            continue;
        }

        const seq = loaded.value;

        const samples: TsSample[] = [];
        for (let frame = 0; frame < args.maxFrames; frame++) {
            const { boneCount, hash } = hashSkeletalFinalMatrices(seq, frame);
            samples.push({ frame, ok: true, boneCount, hash });
        }

        tsById.set(id, {
            id,
            ok: true,
            baseId: seq.base.id | 0,
            poseId: seq.poseId | 0,
            curveCount: seq.curveCount | 0,
            frameCount: args.maxFrames,
            samples,
        });
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "skeletal_eval_hashes",
            "--cache",
            cacheInfo.name,
            "--game",
            String(getGameTypeName(cacheInfo.game)),
            "--revision",
            String(cacheInfo.revision),
            "--maxFrames",
            String(args.maxFrames),
            "--ids",
            ids.join(","),
        ],
        { encoding: "utf8" },
    );
    if (cpp.status !== 0) {
        throw new Error(`rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
    }

    const parsed = JSON.parse(cpp.stdout) as {
        entries: CppEntry[];
        hasSkeletalSeqLoader: boolean;
        hasSeqBaseService: boolean;
    };
    if (!parsed.hasSkeletalSeqLoader) {
        throw new Error("C++ session has no skeletal-seq service for this cache");
    }
    if (!parsed.hasSeqBaseService) {
        throw new Error("C++ session has no seq-base service for this cache");
    }
    const cppById = new Map<number, CppEntry>();
    for (const e of parsed.entries) cppById.set(e.id, e);

    let mismatches = 0;
    for (const id of ids) {
        const ts = tsById.get(id);
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
            if (
                ts.baseId !== cppEntry.baseId ||
                ts.poseId !== cppEntry.poseId ||
                ts.curveCount !== cppEntry.curveCount ||
                ts.frameCount !== cppEntry.frameCount ||
                ts.samples.length !== cppEntry.samples.length
            ) {
                mismatches++;
                console.error(
                    `value mismatch id=${id}\nts=${JSON.stringify(ts)}\ncpp=${JSON.stringify(
                        cppEntry,
                    )}`,
                );
                continue;
            }

            for (let i = 0; i < ts.samples.length; i++) {
                const t = ts.samples[i];
                const c = cppEntry.samples[i];
                if (!c) {
                    mismatches++;
                    console.error(`sample missing id=${id} frame=${t.frame}`);
                    continue;
                }
                if (!c.ok) {
                    mismatches++;
                    console.error(
                        `sample status mismatch id=${id} frame=${
                            t.frame
                        }: ts=ok cpp=${JSON.stringify(c)}`,
                    );
                    continue;
                }
                if (t.frame !== c.frame || t.boneCount !== c.boneCount || t.hash !== c.hash) {
                    mismatches++;
                    console.error(
                        `sample value mismatch id=${id} frame=${t.frame}: ts=${JSON.stringify(
                            t,
                        )} cpp=${JSON.stringify(c)}`,
                    );
                }
            }
            continue;
        }

        if (cppEntry.ok) {
            mismatches++;
            console.error(`status mismatch id=${id}: ts=${ts.kind} cpp=ok`);
            continue;
        }

        const statusKind = statusKindFromCppStatus(cppEntry.status);
        const cppKind = statusKind !== "other" ? statusKind : cppEntry.errorClass ?? "other";
        if (ts.kind !== cppKind) {
            mismatches++;
            console.error(
                `status mismatch id=${id}: ts=${ts.kind} cpp=${cppEntry.status}/${cppKind}`,
            );
        }
    }

    console.log(
        `skeletal-eval-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} ids=${ids.length} maxFrames=${args.maxFrames} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

void main();
