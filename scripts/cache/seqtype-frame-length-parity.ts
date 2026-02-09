import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/runtime/createCacheSession";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Args = {
    cacheName?: string;
    limit: number;
    maxFrames: number;
    ids?: number[];
};

type TsEntry =
    | { id: number; ok: true; frameCount: number; lengths: number[] }
    | { id: number; ok: false; kind: "not_found" | "decode_failed" | "other" };
type CppEntry =
    | { id: number; ok: true; frameCount: number; lengths: number[] }
    | {
          id: number;
          ok: false;
          status: string;
          statusCode: number;
          errorClass?: "not_found" | "decode_failed" | "other";
      };

type SeqTypeLoaderLike = {
    tryLoad(id: number):
        | {
              ok: true;
              value: { frameIds: number[]; frameLengths: number[] };
          }
        | {
              ok: false;
              error: { kind: string };
          };
};

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 40, maxFrames: 20 };
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
    if (!Number.isFinite(args.limit) || args.limit <= 0) {
        throw new Error("Invalid --limit");
    }
    if (!Number.isFinite(args.maxFrames) || args.maxFrames <= 0) {
        throw new Error("Invalid --maxFrames");
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

function collectSeqIds(
    seqTypeLoader: SeqTypeLoaderLike,
    limit: number,
): number[] {
    const out: number[] = [];
    const maxProbe = Math.max(20000, limit * 2000);
    for (let id = 0; id < maxProbe && out.length < limit; id++) {
        const result = seqTypeLoader.tryLoad(id);
        if (!result.ok) {
            continue;
        }
        const seq = result.value;
        if (seq.frameIds.length === 0 || seq.frameLengths.length === 0) {
            continue;
        }
        out.push(id);
    }
    return out;
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
    const seqTypeLoader = session.getSeqTypeLoader();
    const seqFrameLoader = session.getSeqFrameLoader();
    if (!seqFrameLoader) {
        throw new Error("TS session has no seq-frame service");
    }

    const ids =
        args.ids && args.ids.length > 0 ? args.ids : collectSeqIds(seqTypeLoader, args.limit);
    if (ids.length === 0) {
        throw new Error("No sequence ids selected");
    }

    const tsById = new Map<number, TsEntry>();
    for (const id of ids) {
        const result = seqTypeLoader.tryLoad(id);
        if (!result.ok) {
            const kind =
                result.error.kind === "not_found"
                    ? "not_found"
                    : result.error.kind === "decode_failed"
                      ? "decode_failed"
                      : "other";
            tsById.set(id, { id, ok: false, kind });
            continue;
        }
        const seq = result.value;
        const frameCount = seq.frameLengths.length;
        const take = Math.min(frameCount, args.maxFrames);
        const lengths: number[] = [];
        for (let i = 0; i < take; i++) {
            lengths.push(seq.getFrameLength(seqFrameLoader, i));
        }
        tsById.set(id, { id, ok: true, frameCount, lengths });
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "seq_type_frame_lengths",
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
    const parsed = JSON.parse(cpp.stdout) as { entries: CppEntry[] };
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
                console.error(
                    `id=${id} TS ok(frameCount=${ts.frameCount}) but C++ error=${cppEntry.status}`,
                );
            } else if (
                cppEntry.frameCount !== ts.frameCount ||
                JSON.stringify(cppEntry.lengths) !== JSON.stringify(ts.lengths)
            ) {
                mismatches++;
                console.error(
                    `id=${id} lengths mismatch ts=${JSON.stringify(ts.lengths)} cpp=${JSON.stringify(cppEntry.lengths)}`,
                );
            }
        } else {
            if (cppEntry.ok) {
                mismatches++;
                console.error(`id=${id} TS error(kind=${ts.kind}) but C++ ok`);
            } else {
                const cppKind = cppEntry.errorClass ?? "other";
                if (cppKind !== ts.kind) {
                    mismatches++;
                    console.error(
                        `id=${id} status kind mismatch ts=${ts.kind} cpp=${cppKind} status=${cppEntry.status}`,
                    );
                }
            }
        }
    }

    if (mismatches > 0) {
        throw new Error(`seqtype-frame-length-parity failed with ${mismatches} mismatch(es)`);
    }
    console.log(
        `seqtype-frame-length-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} ids=${ids.length} mismatches=0`,
    );
}

void main();
