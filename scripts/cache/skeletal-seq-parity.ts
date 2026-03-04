import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/loaders/CacheSession";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { SkeletalSeq } from "../../src/rs/model/skeletal/SkeletalSeq";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type StatusKind = "not_found" | "decode_failed" | "other";

type Args = {
    cacheName?: string;
    limit: number;
    ids?: number[];
};

type TsEntry =
    | {
          id: number;
          ok: true;
          hash: number;
          version: number;
          baseId: number;
          poseId: number;
          curveCount: number;
          hasAlphaTransform: boolean;
      }
    | { id: number; ok: false; kind: StatusKind };
type CppEntry =
    | {
          id: number;
          ok: true;
          hash: number;
          version: number;
          baseId: number;
          poseId: number;
          curveCount: number;
          hasAlphaTransform: boolean;
      }
    | {
          id: number;
          ok: false;
          status: string;
          statusCode: number;
          errorClass?: "not_found" | "decode_failed" | "other";
      };

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 40 };
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
    if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("Invalid --limit");
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

function toKind(kind: string | undefined): StatusKind {
    if (kind === "not_found" || kind === "decode_failed") return kind;
    return "other";
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

function hashSkeletalSeq(seq: SkeletalSeq): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x534b454c); // 'SKEL'
    h = fnv1a32UpdateInt(h, seq.id | 0);
    h = fnv1a32UpdateInt(h, seq.version | 0);
    h = fnv1a32UpdateInt(h, seq.base.id | 0);
    h = fnv1a32UpdateInt(h, seq.poseId | 0);
    h = fnv1a32UpdateInt(h, seq.curveCount | 0);
    h = fnv1a32UpdateInt(h, seq.hasAlphaTransform ? 1 : 0);
    return h | 0;
}

function collectSkeletalIds(
    tryLoadSeqType: (id: number) => { ok: true; value: any } | { ok: false },
    limit: number,
): number[] {
    const out = new Set<number>();
    const maxProbe = Math.max(50000, limit * 3000);
    for (let id = 0; id < maxProbe && out.size < limit; id++) {
        const seq = tryLoadSeqType(id);
        if (!seq.ok) continue;
        const mayaId = seq.value.animMayaId | 0;
        if (mayaId >= 0) {
            out.add(mayaId);
        }
    }
    return Array.from(out.values());
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
            : collectSkeletalIds((id) => session.tryLoadSeqType(id), args.limit);
    if (ids.length === 0) {
        throw new Error("No skeletal seq ids selected");
    }

    const tsById = new Map<number, TsEntry>();
    for (const id of ids) {
        const result = skeletalSeqLoader.tryLoad(id);
        if (!result.ok) {
            tsById.set(id, { id, ok: false, kind: toKind(result.error.kind) });
        } else {
            const seq = result.value;
            tsById.set(id, {
                id,
                ok: true,
                hash: hashSkeletalSeq(seq),
                version: seq.version,
                baseId: seq.base.id,
                poseId: seq.poseId,
                curveCount: seq.curveCount,
                hasAlphaTransform: seq.hasAlphaTransform,
            });
        }
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "skeletal_seq_hashes",
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
    const parsed = JSON.parse(cpp.stdout) as { entries: CppEntry[]; hasSkeletalSeqLoader: boolean };
    if (!parsed.hasSkeletalSeqLoader) {
        throw new Error("C++ session has no skeletal-seq service for this cache");
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
                ts.hash !== cppEntry.hash ||
                ts.version !== cppEntry.version ||
                ts.baseId !== cppEntry.baseId ||
                ts.poseId !== cppEntry.poseId ||
                ts.curveCount !== cppEntry.curveCount ||
                ts.hasAlphaTransform !== cppEntry.hasAlphaTransform
            ) {
                mismatches++;
                console.error(
                    `value mismatch id=${id}\nts=${JSON.stringify(ts)}\ncpp=${JSON.stringify(
                        cppEntry,
                    )}`,
                );
            }
            continue;
        }
        if (cppEntry.ok) {
            mismatches++;
            console.error(`status mismatch id=${id}: ts=${ts.kind} cpp=ok`);
            continue;
        }
        const cppClass = cppEntry.errorClass;
        if (ts.kind === "not_found") {
            if (
                cppClass !== "not_found" &&
                cppEntry.status !== "NotFound" &&
                cppEntry.status !== "OutOfRange"
            ) {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=not_found cpp=${cppEntry.status}`);
            }
        } else if (ts.kind === "decode_failed") {
            if (
                cppClass === "not_found" ||
                cppEntry.status === "NotFound" ||
                cppEntry.status === "OutOfRange"
            ) {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=decode_failed cpp=${cppEntry.status}`);
            }
        }
    }

    console.log(
        `skeletal-seq-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} ids=${ids.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

void main();
