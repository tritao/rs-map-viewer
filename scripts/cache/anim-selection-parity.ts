import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/loaders/CacheSession";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type StatusKind = "not_found" | "decode_failed" | "other";

type Args = {
    cacheName?: string;
    npcLimit: number;
    locLimit: number;
    maxFrames: number;
    npcIds?: number[];
    locIds?: number[];
};

type SeqResolutionNorm =
    | { seqId: number; ok: false; kind: StatusKind }
    | {
          seqId: number;
          ok: true;
          mode: "none";
          frameCount: number;
          samples: Array<{ frame: number }>;
      }
    | {
          seqId: number;
          ok: true;
          mode: "skeletal";
          frameCount: number;
          animMayaId: number;
          animMayaStart: number;
          animMayaEnd: number;
          skeletalOk: boolean;
          skeletalKind?: StatusKind;
          skeletalHasAlphaTransform?: boolean;
          samples: Array<{ frame: number }>;
      }
    | {
          seqId: number;
          ok: true;
          mode: "frame";
          rotateNormals: boolean;
          frameCount: number;
          samples: Array<{
              frame: number;
              frameId: number;
              frameLength: number;
              frameOk: boolean;
              frameKind?: StatusKind;
              hasAlphaTransform?: boolean;
              hasColorTransform?: boolean;
          }>;
      };

type NpcSnapshotNorm =
    | { id: number; ok: false; kind: StatusKind; status?: string }
    | {
          id: number;
          ok: true;
          basTypeId: number;
          npcIdleSeqId: number;
          npcWalkSeqId: number;
          idleSeqId: number;
          walkSeqId: number;
          basKind?: StatusKind;
          idle: SeqResolutionNorm;
          walk: SeqResolutionNorm;
      };

type LocSnapshotNorm =
    | { id: number; ok: false; kind: StatusKind; status?: string }
    | {
          id: number;
          ok: true;
          seqId: number;
          randomSeqCount: number;
          selectedSeqId: number;
          selectionSource: "seqId" | "randomSeqIds_0" | "none";
          seq: SeqResolutionNorm;
      };

type TryLoadNpcFn = (
    id: number,
) => { ok: true; value: any } | { ok: false; error: { kind: string } };
type TryLoadLocFn = (
    id: number,
) => { ok: true; value: any } | { ok: false; error: { kind: string } };

function parseArgs(argv: string[]): Args {
    const args: Args = {
        npcLimit: 30,
        locLimit: 30,
        maxFrames: 8,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--npcLimit") args.npcLimit = Number(argv[++i]);
        else if (a === "--locLimit") args.locLimit = Number(argv[++i]);
        else if (a === "--maxFrames") args.maxFrames = Number(argv[++i]);
        else if (a === "--npcIds") {
            args.npcIds = argv[++i]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => Number(s));
        } else if (a === "--locIds") {
            args.locIds = argv[++i]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => Number(s));
        }
    }
    if (!Number.isFinite(args.npcLimit) || args.npcLimit < 0) {
        throw new Error("Invalid --npcLimit");
    }
    if (!Number.isFinite(args.locLimit) || args.locLimit < 0) {
        throw new Error("Invalid --locLimit");
    }
    if (!Number.isFinite(args.maxFrames) || args.maxFrames <= 0) {
        throw new Error("Invalid --maxFrames");
    }
    if (args.npcIds && args.npcIds.some((id) => !Number.isFinite(id) || id < 0)) {
        throw new Error("Invalid --npcIds");
    }
    if (args.locIds && args.locIds.some((id) => !Number.isFinite(id) || id < 0)) {
        throw new Error("Invalid --locIds");
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
    if (kind === "not_found" || kind === "decode_failed") {
        return kind;
    }
    return "other";
}

function collectNpcIds(tryLoadNpcType: TryLoadNpcFn, limit: number): number[] {
    if (limit <= 0) return [];
    const out: number[] = [];
    const maxProbe = Math.max(50000, limit * 3000);
    for (let id = 0; id < maxProbe && out.length < limit; id++) {
        const res = tryLoadNpcType(id);
        if (!res.ok) continue;
        const n = res.value;
        if (n.basTypeId !== -1 || n.idleSeqId !== -1 || n.walkSeqId !== -1) {
            out.push(id);
        }
    }
    return out;
}

function collectLocIds(tryLoadLocType: TryLoadLocFn, limit: number): number[] {
    if (limit <= 0) return [];
    const out: number[] = [];
    const maxProbe = Math.max(50000, limit * 3000);
    for (let id = 0; id < maxProbe && out.length < limit; id++) {
        const res = tryLoadLocType(id);
        if (!res.ok) continue;
        const l = res.value;
        if (l.seqId !== -1 || (l.randomSeqIds && l.randomSeqIds.length > 0)) {
            out.push(id);
        }
    }
    return out;
}

function normalizeCppSeqResolution(cpp: any): SeqResolutionNorm {
    if (!cpp.ok) {
        return {
            seqId: Number(cpp.seqId),
            ok: false,
            kind: toKind(cpp.errorClass),
        };
    }
    if (cpp.mode === "none") {
        return {
            seqId: Number(cpp.seqId),
            ok: true,
            mode: "none",
            frameCount: Number(cpp.frameCount) || 0,
            samples: Array.isArray(cpp.samples)
                ? cpp.samples.map((s: any) => ({ frame: Number(s.frame) }))
                : [],
        };
    }
    if (cpp.mode === "skeletal") {
        return {
            seqId: Number(cpp.seqId),
            ok: true,
            mode: "skeletal",
            frameCount: Number(cpp.frameCount) || 0,
            animMayaId: Number(cpp.animMayaId),
            animMayaStart: Number(cpp.animMayaStart),
            animMayaEnd: Number(cpp.animMayaEnd),
            skeletalOk: Boolean(cpp.skeletalOk),
            skeletalKind: cpp.skeletalOk ? undefined : toKind(cpp.skeletalErrorClass),
            skeletalHasAlphaTransform: cpp.skeletalOk
                ? Boolean(cpp.skeletalHasAlphaTransform)
                : undefined,
            samples: Array.isArray(cpp.samples)
                ? cpp.samples.map((s: any) => ({ frame: Number(s.frame) }))
                : [],
        };
    }
    return {
        seqId: Number(cpp.seqId),
        ok: true,
        mode: "frame",
        rotateNormals: Boolean(cpp.rotateNormals),
        frameCount: Number(cpp.frameCount) || 0,
        samples: Array.isArray(cpp.samples)
            ? cpp.samples.map((s: any) => ({
                  frame: Number(s.frame),
                  frameId: Number(s.frameId),
                  frameLength: Number(s.frameLength),
                  frameOk: Boolean(s.frameOk),
                  frameKind: s.frameOk ? undefined : toKind(s.frameErrorClass),
                  hasAlphaTransform: s.frameOk ? Boolean(s.hasAlphaTransform) : undefined,
                  hasColorTransform: s.frameOk ? Boolean(s.hasColorTransform) : undefined,
              }))
            : [],
    };
}

function normalizeCppNpc(cpp: any): NpcSnapshotNorm {
    if (!cpp.ok) {
        return {
            id: Number(cpp.id),
            ok: false,
            kind: toKind(cpp.errorClass),
            status: typeof cpp.status === "string" ? cpp.status : undefined,
        };
    }
    return {
        id: Number(cpp.id),
        ok: true,
        basTypeId: Number(cpp.basTypeId),
        npcIdleSeqId: Number(cpp.npcIdleSeqId),
        npcWalkSeqId: Number(cpp.npcWalkSeqId),
        idleSeqId: Number(cpp.idleSeqId),
        walkSeqId: Number(cpp.walkSeqId),
        basKind: cpp.basTypeId !== -1 ? toKind(cpp.basErrorClass) : undefined,
        idle: normalizeCppSeqResolution(cpp.idle),
        walk: normalizeCppSeqResolution(cpp.walk),
    };
}

function normalizeCppLoc(cpp: any): LocSnapshotNorm {
    if (!cpp.ok) {
        return {
            id: Number(cpp.id),
            ok: false,
            kind: toKind(cpp.errorClass),
            status: typeof cpp.status === "string" ? cpp.status : undefined,
        };
    }
    return {
        id: Number(cpp.id),
        ok: true,
        seqId: Number(cpp.seqId),
        randomSeqCount: Number(cpp.randomSeqCount),
        selectedSeqId: Number(cpp.selectedSeqId),
        selectionSource: (cpp.selectionSource as "seqId" | "randomSeqIds_0" | "none") ?? "none",
        seq: normalizeCppSeqResolution(cpp.seq),
    };
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
    const skeletalSeqLoader = session.getSkeletalSeqLoader();
    const basTypeLoader = session.getBasTypeLoader();
    if (!seqFrameLoader) {
        throw new Error("TS session has no seq-frame service");
    }

    const npcIds =
        args.npcIds && args.npcIds.length > 0
            ? args.npcIds
            : collectNpcIds(session.tryLoadNpcType, args.npcLimit);
    const locIds =
        args.locIds && args.locIds.length > 0
            ? args.locIds
            : collectLocIds(session.tryLoadLocType, args.locLimit);
    if (npcIds.length === 0 && locIds.length === 0) {
        throw new Error("No npc/loc ids selected");
    }

    const resolveSeq = (seqId: number): SeqResolutionNorm => {
        if (seqId < 0) {
            return { seqId, ok: true, mode: "none", frameCount: 0, samples: [] };
        }

        const seqRes = seqTypeLoader.tryLoad(seqId);
        if (!seqRes.ok) {
            return { seqId, ok: false, kind: toKind(seqRes.error.kind) };
        }
        const seq = seqRes.value;

        if (seq.hasAnimMayaSeq()) {
            const frameCount = seq.getAnimMayaDuration();
            const sampleCount = Math.min(Math.max(frameCount, 0), args.maxFrames);
            const skeletal = skeletalSeqLoader?.tryGet(seq.animMayaId);
            return {
                seqId,
                ok: true,
                mode: "skeletal",
                frameCount,
                animMayaId: seq.animMayaId,
                animMayaStart: seq.animMayaStart,
                animMayaEnd: seq.animMayaEnd,
                skeletalOk: Boolean(skeletal),
                skeletalKind: skeletal ? undefined : "not_found",
                skeletalHasAlphaTransform: skeletal ? skeletal.hasAlphaTransform : undefined,
                samples: Array.from({ length: sampleCount }, (_, i) => ({ frame: i })),
            };
        }

        const frameCount = seq.frameIds.length;
        const sampleCount = Math.min(frameCount, args.maxFrames);
        const samples = Array.from({ length: sampleCount }, (_, i) => {
            const frameId = seq.frameIds[i];
            const frameLength = seq.getFrameLength(seqFrameLoader, i);
            if (frameId < 0) {
                return {
                    frame: i,
                    frameId,
                    frameLength,
                    frameOk: false,
                    frameKind: "not_found" as const,
                };
            }
            const frameRes = seqFrameLoader.tryLoad(frameId);
            if (!frameRes.ok) {
                return {
                    frame: i,
                    frameId,
                    frameLength,
                    frameOk: false,
                    frameKind: toKind(frameRes.error.kind),
                };
            }
            const frame = frameRes.value;
            return {
                frame: i,
                frameId,
                frameLength,
                frameOk: true,
                hasAlphaTransform: frame.hasAlphaTransform,
                hasColorTransform: frame.hasColorTransform,
            };
        });
        return {
            seqId,
            ok: true,
            mode: "frame",
            rotateNormals: seq.rotateNormals,
            frameCount,
            samples,
        };
    };

    const tsNpcById = new Map<number, NpcSnapshotNorm>();
    for (const id of npcIds) {
        const npcRes = session.tryLoadNpcType(id);
        if (!npcRes.ok) {
            tsNpcById.set(id, { id, ok: false, kind: toKind(npcRes.error.kind) });
            continue;
        }
        const npc = npcRes.value;
        let idleSeqId = npc.idleSeqId;
        let walkSeqId = npc.walkSeqId;
        let basKind: StatusKind | undefined;
        if (npc.basTypeId !== -1) {
            const basRes = basTypeLoader.tryLoad(npc.basTypeId);
            if (!basRes.ok) {
                idleSeqId = -1;
                walkSeqId = -1;
                basKind = toKind(basRes.error.kind);
            } else {
                idleSeqId = basRes.value.idleSeqId;
                walkSeqId = basRes.value.walkSeqId;
                basKind = "other";
            }
        }
        tsNpcById.set(id, {
            id,
            ok: true,
            basTypeId: npc.basTypeId,
            npcIdleSeqId: npc.idleSeqId,
            npcWalkSeqId: npc.walkSeqId,
            idleSeqId,
            walkSeqId,
            basKind,
            idle: resolveSeq(idleSeqId),
            walk: resolveSeq(walkSeqId),
        });
    }

    const tsLocById = new Map<number, LocSnapshotNorm>();
    for (const id of locIds) {
        const locRes = session.tryLoadLocType(id);
        if (!locRes.ok) {
            tsLocById.set(id, { id, ok: false, kind: toKind(locRes.error.kind) });
            continue;
        }
        const loc = locRes.value;
        let selectedSeqId = loc.seqId;
        let selectionSource: "seqId" | "randomSeqIds_0" | "none" = "seqId";
        if (selectedSeqId === -1) {
            if (loc.randomSeqIds && loc.randomSeqIds.length > 0) {
                selectedSeqId = loc.randomSeqIds[0];
                selectionSource = "randomSeqIds_0";
            } else {
                selectionSource = "none";
            }
        }
        tsLocById.set(id, {
            id,
            ok: true,
            seqId: loc.seqId,
            randomSeqCount: loc.randomSeqIds?.length ?? 0,
            selectedSeqId,
            selectionSource,
            seq: resolveSeq(selectedSeqId),
        });
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "anim_selection_snapshot",
            "--cache",
            cacheInfo.name,
            "--game",
            String(getGameTypeName(cacheInfo.game)),
            "--revision",
            String(cacheInfo.revision),
            "--maxFrames",
            String(args.maxFrames),
            "--npcIds",
            npcIds.join(","),
            "--locIds",
            locIds.join(","),
        ],
        { encoding: "utf8" },
    );
    if (cpp.status !== 0) {
        throw new Error(`rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
    }
    const parsed = JSON.parse(cpp.stdout) as { npcs: any[]; locs: any[] };
    const cppNpcById = new Map<number, NpcSnapshotNorm>();
    const cppLocById = new Map<number, LocSnapshotNorm>();
    for (const e of parsed.npcs ?? []) cppNpcById.set(Number(e.id), normalizeCppNpc(e));
    for (const e of parsed.locs ?? []) cppLocById.set(Number(e.id), normalizeCppLoc(e));

    let mismatches = 0;
    for (const id of npcIds) {
        const ts = tsNpcById.get(id);
        const cppNorm = cppNpcById.get(id);
        if (!ts || !cppNorm) {
            mismatches++;
            console.error(`npc missing entry id=${id}`);
            continue;
        }
        if (JSON.stringify(ts) !== JSON.stringify(cppNorm)) {
            mismatches++;
            console.error(
                `npc mismatch id=${id}\nts=${JSON.stringify(ts)}\ncpp=${JSON.stringify(cppNorm)}`,
            );
        }
    }
    for (const id of locIds) {
        const ts = tsLocById.get(id);
        const cppNorm = cppLocById.get(id);
        if (!ts || !cppNorm) {
            mismatches++;
            console.error(`loc missing entry id=${id}`);
            continue;
        }
        if (JSON.stringify(ts) !== JSON.stringify(cppNorm)) {
            mismatches++;
            console.error(
                `loc mismatch id=${id}\nts=${JSON.stringify(ts)}\ncpp=${JSON.stringify(cppNorm)}`,
            );
        }
    }

    console.log(
        `anim-selection-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} npcs=${npcIds.length} locs=${locIds.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

void main();
