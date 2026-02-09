import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { SeqFrame } from "../../src/rs/model/seq/SeqFrame";
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
    | {
          id: number;
          ok: false;
          status: string;
          statusCode: number;
          errorClass?: "not_found" | "decode_failed" | "other";
      };

type SeqFrameLoaderLike = {
    tryLoad(id: number): { ok: boolean };
};

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

function hashSeqFrame(frame: SeqFrame): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x53514652); // 'SQFR'
    h = fnv1a32UpdateInt(h, frame.frameLength | 0);
    h = fnv1a32UpdateInt(h, frame.base.id | 0);
    h = fnv1a32UpdateInt(h, frame.transformCount | 0);
    h = fnv1a32UpdateInt(h, frame.hasAlphaTransform ? 1 : 0);
    h = fnv1a32UpdateInt(h, frame.hasColorTransform ? 1 : 0);
    h = fnv1a32UpdateIntArray(h, frame.transformGroups);
    h = fnv1a32UpdateIntArray(h, frame.transformX);
    h = fnv1a32UpdateIntArray(h, frame.transformY);
    h = fnv1a32UpdateIntArray(h, frame.transformZ);
    h = fnv1a32UpdateIntArray(h, frame.resetOriginGroups);
    return h | 0;
}

function collectDat2CandidateIds(
    cacheSystem: ReturnType<typeof createCacheSystemFromFiles>,
    limit: number,
): number[] {
    const animIndex = cacheSystem.tryGetIndex(Dat2IndexId.animations);
    if (!animIndex) {
        return [];
    }

    const out: number[] = [];
    const target = Math.max(limit * 8, limit);
    const archiveIds = animIndex.getArchiveIds();
    for (const archiveId of archiveIds) {
        const maybeFileIds = animIndex.getFileIds(archiveId);
        const fileIds: number[] = maybeFileIds
            ? Array.from(maybeFileIds)
            : Array.from({ length: animIndex.getFileCount(archiveId) }, (_, i) => i);
        for (const fileId of fileIds) {
            const packed = archiveId * 65536 + fileId;
            if (packed < 0 || packed > 0x7fffffff) {
                continue;
            }
            out.push(packed);
            if (out.length >= target) {
                return out;
            }
        }
    }
    return out;
}

function collectByScanning(loader: SeqFrameLoaderLike, limit: number): number[] {
    const out: number[] = [];
    const maxProbe = Math.max(50000, limit * 3000);
    for (let id = 0; id < maxProbe && out.length < limit; id++) {
        const result = loader.tryLoad(id);
        if (result.ok) {
            out.push(id);
        }
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
    const seqFrameLoader = session.getSeqFrameLoader();
    if (!seqFrameLoader) {
        throw new Error("TS session has no seq-frame service");
    }

    let ids: number[];
    if (args.ids && args.ids.length > 0) {
        ids = args.ids;
    } else if (cacheType === CacheType.Dat2) {
        const candidates = collectDat2CandidateIds(cacheSystem, args.limit);
        ids = [];
        for (const id of candidates) {
            if (ids.length >= args.limit) break;
            const result = seqFrameLoader.tryLoad(id);
            if (result.ok) {
                ids.push(id);
            }
        }
        if (ids.length < args.limit) {
            const scanned = collectByScanning(seqFrameLoader, args.limit);
            for (const id of scanned) {
                if (ids.length >= args.limit) break;
                if (!ids.includes(id)) ids.push(id);
            }
        }
    } else {
        ids = collectByScanning(seqFrameLoader, args.limit);
    }

    if (ids.length === 0) {
        throw new Error("No seq-frame ids selected");
    }

    const tsById = new Map<number, TsEntry>();
    for (const id of ids) {
        const result = seqFrameLoader.tryLoad(id);
        if (!result.ok) {
            tsById.set(id, { id, ok: false, kind: result.error.kind });
        } else {
            tsById.set(id, { id, ok: true, hash: hashSeqFrame(result.value) });
        }
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "seq_frame_hashes",
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
        const cppClass = cppEntry.errorClass;
        if (ts.kind === "not_found") {
            if (cppClass !== "not_found" && cppEntry.status !== "NotFound" && cppEntry.status !== "OutOfRange") {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=not_found cpp=${cppEntry.status}`);
            }
        } else {
            if (cppClass === "not_found" || cppEntry.status === "NotFound" || cppEntry.status === "OutOfRange") {
                mismatches++;
                console.error(`status mismatch id=${id}: ts=decode_failed cpp=${cppEntry.status}`);
            }
        }
    }

    console.log(
        `seqframe-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} ids=${ids.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
