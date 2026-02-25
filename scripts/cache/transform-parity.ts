import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import type { VarProvider } from "../../src/rs/config/vartype/VarProvider";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/runtime/createCacheSession";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type StatusKind = "not_found" | "decode_failed" | "other";
type StepTag =
    | "ok"
    | "cycle"
    | "transform_minus_one"
    | "error_not_found"
    | "error_decode_failed"
    | "error_other";
type TerminalTag = "no_transforms" | "transform_minus_one" | "loader_error" | "cycle" | "max_steps";

type Args = {
    cacheName?: string;
    npcLimit: number;
    locLimit: number;
    maxSteps: number;
    npcIds?: number[];
    locIds?: number[];
};

type ChainStepNorm = {
    sourceId: number;
    transformVarbit: number;
    transformVarp: number;
    transformIndex: number;
    selectedId: number;
    tag: StepTag;
};

type TransformEntryNorm =
    | { id: number; ok: false; kind: StatusKind }
    | {
          id: number;
          ok: true;
          chain: ChainStepNorm[];
          visitedIds: number[];
          finalId: number;
          terminal: TerminalTag;
          terminalKind?: StatusKind;
      };

function parseArgs(argv: string[]): Args {
    const args: Args = {
        npcLimit: 30,
        locLimit: 30,
        maxSteps: 8,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--npcLimit") args.npcLimit = Number(argv[++i]);
        else if (a === "--locLimit") args.locLimit = Number(argv[++i]);
        else if (a === "--maxSteps") args.maxSteps = Number(argv[++i]);
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
    if (!Number.isFinite(args.npcLimit) || args.npcLimit < 0) throw new Error("Invalid --npcLimit");
    if (!Number.isFinite(args.locLimit) || args.locLimit < 0) throw new Error("Invalid --locLimit");
    if (!Number.isFinite(args.maxSteps) || args.maxSteps <= 0)
        throw new Error("Invalid --maxSteps");
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
    if (kind === "not_found" || kind === "decode_failed") return kind;
    return "other";
}

function kindFromCppStatus(status: string | undefined): StatusKind {
    if (!status) return "other";
    if (status === "NotFound" || status === "OutOfRange") return "not_found";
    if (status === "DecodeError" || status === "BadFormat" || status === "Truncated")
        return "decode_failed";
    return "other";
}

function collectNpcIds(
    tryLoadNpcType: (id: number) => { ok: true; value: any } | { ok: false },
    limit: number,
): number[] {
    if (limit <= 0) return [];
    const out: number[] = [];
    const maxProbe = Math.max(50000, limit * 4000);
    for (let id = 0; id < maxProbe && out.length < limit; id++) {
        const res = tryLoadNpcType(id);
        if (!res.ok) continue;
        const n = res.value;
        if (n.transforms && n.transforms.length > 0) {
            out.push(id);
        }
    }
    return out;
}

function collectLocIds(
    tryLoadLocType: (id: number) => { ok: true; value: any } | { ok: false },
    limit: number,
): number[] {
    if (limit <= 0) return [];
    const out: number[] = [];
    const maxProbe = Math.max(50000, limit * 4000);
    for (let id = 0; id < maxProbe && out.length < limit; id++) {
        const res = tryLoadLocType(id);
        if (!res.ok) continue;
        const l = res.value;
        if (l.transforms && l.transforms.length > 0) {
            out.push(id);
        }
    }
    return out;
}

function makeAssignments(ids: number[]): Map<number, number> {
    const sorted = Array.from(new Set(ids)).sort((a, b) => a - b);
    const out = new Map<number, number>();
    for (let i = 0; i < sorted.length; i++) {
        out.set(sorted[i], (i * 3) % 7);
    }
    return out;
}

function toAssignmentCsv(values: Map<number, number>): string {
    return Array.from(values.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([id, value]) => `${id}=${value}`)
        .join(",");
}

class SnapshotVarProvider implements VarProvider {
    constructor(
        private readonly getVarbitType: (id: number) => { ok: true; value: any } | { ok: false },
        private readonly varps: Map<number, number>,
        private readonly directVarbits: Map<number, number>,
    ) {}

    getVarp(id: number): number {
        return this.varps.get(id) ?? 0;
    }

    getVarbit(id: number): number {
        const forced = this.directVarbits.get(id);
        if (forced !== undefined) {
            return forced;
        }
        const vb = this.getVarbitType(id);
        if (!vb.ok) {
            return 0;
        }
        const t = vb.value;
        const startBit = Math.max(0, Math.min(31, t.startBit | 0));
        const endBit = Math.max(0, Math.min(31, t.endBit | 0));
        const width = endBit - startBit;
        if (width <= 0) return 0;
        const baseValue = this.getVarp(t.baseVar | 0) | 0;
        const mask = width >= 31 ? 0x7fffffff : (1 << width) - 1;
        return (baseValue >> startBit) & mask;
    }
}

function resolveTransformIndex(
    t: { transformVarbit: number; transformVarp: number },
    varProvider: VarProvider,
): number {
    if (t.transformVarbit !== -1) return varProvider.getVarbit(t.transformVarbit);
    if (t.transformVarp !== -1) return varProvider.getVarp(t.transformVarp);
    return -1;
}

function resolveTransformId(transforms: number[] | undefined, transformIndex: number): number {
    if (!transforms || transforms.length === 0) return -1;
    let id = transforms[transforms.length - 1];
    if (transformIndex >= 0 && transformIndex < transforms.length - 1) {
        id = transforms[transformIndex];
    }
    return id;
}

function tagFromCppStep(cpp: any): StepTag {
    const status = String(cpp.selectedStatus ?? "");
    if (status === "Ok") return "ok";
    if (status === "Cycle") return "cycle";
    if (status === "TransformMinusOne") return "transform_minus_one";
    const kind = toKind(cpp.selectedErrorClass) ?? kindFromCppStatus(status);
    if (kind === "not_found") return "error_not_found";
    if (kind === "decode_failed") return "error_decode_failed";
    return "error_other";
}

function normalizeCppEntry(cpp: any): TransformEntryNorm {
    if (!cpp.ok) {
        return { id: Number(cpp.id), ok: false, kind: toKind(cpp.errorClass) };
    }
    const chain: ChainStepNorm[] = Array.isArray(cpp.chain)
        ? cpp.chain.map((s: any) => ({
              sourceId: Number(s.sourceId),
              transformVarbit: Number(s.transformVarbit),
              transformVarp: Number(s.transformVarp),
              transformIndex: Number(s.transformIndex),
              selectedId: Number(s.selectedId),
              tag: tagFromCppStep(s),
          }))
        : [];
    return {
        id: Number(cpp.id),
        ok: true,
        chain,
        visitedIds: Array.isArray(cpp.visitedIds) ? cpp.visitedIds.map((v: any) => Number(v)) : [],
        finalId: Number(cpp.finalId),
        terminal: String(cpp.terminal) as TerminalTag,
        terminalKind: cpp.terminal === "loader_error" ? toKind(cpp.terminalErrorClass) : undefined,
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

    const npcIds =
        args.npcIds && args.npcIds.length > 0
            ? args.npcIds
            : collectNpcIds((id) => session.tryLoadNpcType(id), args.npcLimit);
    const locIds =
        args.locIds && args.locIds.length > 0
            ? args.locIds
            : collectLocIds((id) => session.tryLoadLocType(id), args.locLimit);

    if (npcIds.length === 0 && locIds.length === 0) {
        console.log(
            `transform-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} npcs=0 locs=0 mismatches=0 (skipped: no transform-capable ids)`,
        );
        return;
    }

    const varpIds: number[] = [];
    const varbitIds: number[] = [];
    for (const id of npcIds) {
        const res = session.tryLoadNpcType(id);
        if (!res.ok) continue;
        const t = res.value;
        if (t.transformVarp !== -1) varpIds.push(t.transformVarp);
        if (t.transformVarbit !== -1) varbitIds.push(t.transformVarbit);
    }
    for (const id of locIds) {
        const res = session.tryLoadLocType(id);
        if (!res.ok) continue;
        const t = res.value;
        if (t.transformVarp !== -1) varpIds.push(t.transformVarp);
        if (t.transformVarbit !== -1) varbitIds.push(t.transformVarbit);
    }

    const varps = makeAssignments(varpIds);
    const varbits = makeAssignments(varbitIds);
    const varProvider = new SnapshotVarProvider(
        (id) => session.tryLoadVarBitType(id),
        varps,
        varbits,
    );

    const tsNpcById = new Map<number, TransformEntryNorm>();
    for (const id of npcIds) {
        const rootRes = session.tryLoadNpcType(id);
        if (!rootRes.ok) {
            tsNpcById.set(id, { id, ok: false, kind: toKind(rootRes.error.kind) });
            continue;
        }

        const chain: ChainStepNorm[] = [];
        const visitedIds = [id];
        const seen = new Set<number>(visitedIds);
        let current = rootRes.value;
        let terminal: TerminalTag = "no_transforms";
        let terminalKind: StatusKind | undefined = undefined;
        let done = false;

        for (let step = 0; step < args.maxSteps; step++) {
            if (!current.transforms || current.transforms.length === 0) {
                terminal = "no_transforms";
                done = true;
                break;
            }

            const transformIndex = resolveTransformIndex(current, varProvider);
            const selectedId = resolveTransformId(current.transforms, transformIndex);
            const stepOut: ChainStepNorm = {
                sourceId: current.id,
                transformVarbit: current.transformVarbit,
                transformVarp: current.transformVarp,
                transformIndex,
                selectedId,
                tag: "ok",
            };

            if (selectedId === -1) {
                stepOut.tag = "transform_minus_one";
                chain.push(stepOut);
                terminal = "transform_minus_one";
                done = true;
                break;
            }
            if (seen.has(selectedId)) {
                stepOut.tag = "cycle";
                chain.push(stepOut);
                visitedIds.push(selectedId);
                terminal = "cycle";
                done = true;
                break;
            }

            const nextRes = session.tryLoadNpcType(selectedId);
            if (!nextRes.ok) {
                const kind = toKind(nextRes.error.kind);
                stepOut.tag =
                    kind === "not_found"
                        ? "error_not_found"
                        : kind === "decode_failed"
                        ? "error_decode_failed"
                        : "error_other";
                chain.push(stepOut);
                terminal = "loader_error";
                terminalKind = kind;
                done = true;
                break;
            }

            chain.push(stepOut);
            seen.add(selectedId);
            visitedIds.push(selectedId);
            current = nextRes.value;
        }
        if (!done) terminal = "max_steps";

        tsNpcById.set(id, {
            id,
            ok: true,
            chain,
            visitedIds,
            finalId: visitedIds[visitedIds.length - 1],
            terminal,
            terminalKind,
        });
    }

    const tsLocById = new Map<number, TransformEntryNorm>();
    for (const id of locIds) {
        const rootRes = session.tryLoadLocType(id);
        if (!rootRes.ok) {
            tsLocById.set(id, { id, ok: false, kind: toKind(rootRes.error.kind) });
            continue;
        }

        const chain: ChainStepNorm[] = [];
        const visitedIds = [id];
        const seen = new Set<number>(visitedIds);
        let current = rootRes.value;
        let terminal: TerminalTag = "no_transforms";
        let terminalKind: StatusKind | undefined = undefined;
        let done = false;

        for (let step = 0; step < args.maxSteps; step++) {
            if (!current.transforms || current.transforms.length === 0) {
                terminal = "no_transforms";
                done = true;
                break;
            }

            const transformIndex = resolveTransformIndex(current, varProvider);
            const selectedId = resolveTransformId(current.transforms, transformIndex);
            const stepOut: ChainStepNorm = {
                sourceId: current.id,
                transformVarbit: current.transformVarbit,
                transformVarp: current.transformVarp,
                transformIndex,
                selectedId,
                tag: "ok",
            };

            if (selectedId === -1) {
                stepOut.tag = "transform_minus_one";
                chain.push(stepOut);
                terminal = "transform_minus_one";
                done = true;
                break;
            }
            if (seen.has(selectedId)) {
                stepOut.tag = "cycle";
                chain.push(stepOut);
                visitedIds.push(selectedId);
                terminal = "cycle";
                done = true;
                break;
            }

            const nextRes = session.tryLoadLocType(selectedId);
            if (!nextRes.ok) {
                const kind = toKind(nextRes.error.kind);
                stepOut.tag =
                    kind === "not_found"
                        ? "error_not_found"
                        : kind === "decode_failed"
                        ? "error_decode_failed"
                        : "error_other";
                chain.push(stepOut);
                terminal = "loader_error";
                terminalKind = kind;
                done = true;
                break;
            }

            chain.push(stepOut);
            seen.add(selectedId);
            visitedIds.push(selectedId);
            current = nextRes.value;
        }
        if (!done) terminal = "max_steps";

        tsLocById.set(id, {
            id,
            ok: true,
            chain,
            visitedIds,
            finalId: visitedIds[visitedIds.length - 1],
            terminal,
            terminalKind,
        });
    }

    const cliArgs = [
        "transform_snapshot",
        "--cache",
        cacheInfo.name,
        "--game",
        String(getGameTypeName(cacheInfo.game)),
        "--revision",
        String(cacheInfo.revision),
        "--maxSteps",
        String(args.maxSteps),
        "--npcIds",
        npcIds.join(","),
        "--locIds",
        locIds.join(","),
    ];
    const varpsCsv = toAssignmentCsv(varps);
    const varbitsCsv = toAssignmentCsv(varbits);
    if (varpsCsv) {
        cliArgs.push("--varps", varpsCsv);
    }
    if (varbitsCsv) {
        cliArgs.push("--varbits", varbitsCsv);
    }

    const cpp = spawnSync("./cpp/build/rs_cli", cliArgs, { encoding: "utf8" });
    if (cpp.status !== 0) {
        throw new Error(`rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
    }

    const parsed = JSON.parse(cpp.stdout) as { npcs: any[]; locs: any[] };
    const cppNpcById = new Map<number, TransformEntryNorm>();
    const cppLocById = new Map<number, TransformEntryNorm>();
    for (const e of parsed.npcs ?? []) cppNpcById.set(Number(e.id), normalizeCppEntry(e));
    for (const e of parsed.locs ?? []) cppLocById.set(Number(e.id), normalizeCppEntry(e));

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
        `transform-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} npcs=${npcIds.length} locs=${locIds.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

void main();
