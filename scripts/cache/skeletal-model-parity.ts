import { spawnSync } from "child_process";
import { mat4, vec3 } from "gl-matrix";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/loaders/CacheSession";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { ModelData } from "../../src/rs/model/ModelData";
import { SeqTransformType } from "../../src/rs/model/seq/SeqTransformType";
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
    frameStart: number;
    maxFrames: number;
    pairs?: Array<[number, number]>;
};

type TsEntry =
    | {
          seqId: number;
          modelId: number;
          ok: true;
          baseId: number;
          poseId: number;
          curveCount: number;
          vertexCount: number;
          hash: number;
          hasFaceAlphas: boolean;
          alphaHash: number;
      }
    | { seqId: number; modelId: number; ok: false; kind: StatusKind };

type CppEntry =
    | {
          seqId: number;
          modelId: number;
          ok: true;
          baseId: number;
          poseId: number;
          curveCount: number;
          vertexCount: number;
          hash: number;
          hasFaceAlphas: boolean;
          alphaHash: number;
      }
    | {
          seqId: number;
          modelId: number;
          ok: false;
          status: string;
          statusCode: number;
          errorClass?: StatusKind;
      };

function parsePairs(raw: string): Array<[number, number]> {
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const sep = s.indexOf(":");
            if (sep <= 0 || sep >= s.length - 1) {
                throw new Error(`Invalid --pairs entry "${s}" (expected seqId:modelId)`);
            }
            const a = Number(s.slice(0, sep));
            const b = Number(s.slice(sep + 1));
            if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
                throw new Error(`Invalid --pairs entry "${s}"`);
            }
            return [a | 0, b | 0] as [number, number];
        });
}

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 20, frameStart: 0, maxFrames: 1 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--limit") args.limit = Number(argv[++i]);
        else if (a === "--frame") args.frameStart = Number(argv[++i]);
        else if (a === "--maxFrames") args.maxFrames = Number(argv[++i]);
        else if (a === "--pairs") args.pairs = parsePairs(argv[++i]);
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("Invalid --limit");
    if (!Number.isFinite(args.frameStart) || args.frameStart < 0)
        throw new Error("Invalid --frame");
    if (!Number.isFinite(args.maxFrames) || args.maxFrames <= 0)
        throw new Error("Invalid --maxFrames");
    return args;
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function hashModelVertices(model: ModelData): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x534b4d44); // 'SKMD'
    h = fnv1a32UpdateInt(h, model.verticesCount | 0);
    for (let i = 0; i < model.verticesX.length; i++)
        h = fnv1a32UpdateInt(h, model.verticesX[i] | 0);
    for (let i = 0; i < model.verticesY.length; i++)
        h = fnv1a32UpdateInt(h, model.verticesY[i] | 0);
    for (let i = 0; i < model.verticesZ.length; i++)
        h = fnv1a32UpdateInt(h, model.verticesZ[i] | 0);
    return h | 0;
}

function hashModelFaceAlphas(model: ModelData): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x534b4d41); // 'SKMA'
    const alphas = model.faceAlphas;
    const has = !!alphas && alphas.length > 0;
    h = fnv1a32UpdateInt(h, has ? 1 : 0);
    const len = alphas ? alphas.length : 0;
    h = fnv1a32UpdateInt(h, len | 0);
    if (alphas) {
        for (let i = 0; i < alphas.length; i++) {
            h = fnv1a32UpdateInt(h, alphas[i] & 0xff);
        }
    }
    return h | 0;
}

function hasMayaGroups(model: ModelData): boolean {
    if (!model.animMayaGroups || !model.animMayaScales) return false;
    for (let i = 0; i < model.animMayaGroups.length; i++) {
        if (model.animMayaGroups[i] && model.animMayaGroups[i].length > 0) return true;
    }
    return false;
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
        if (baseOnly.size + curveIds.size >= limit && anyIds.size >= limit) break;
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
    if (preferred.length > 0) return preferred.slice(0, limit);
    return Array.from(anyIds.values()).slice(0, limit);
}

function collectModelIdsWithMaya(
    modelLoader: { tryLoad(id: number): { ok: true; value: ModelData } | { ok: false } },
    limit: number,
): number[] {
    const preferred: number[] = [];
    const fallback: number[] = [];
    const maxProbe = Math.max(120000, limit * 10000);
    for (let id = 0; id < maxProbe; id++) {
        const loaded = modelLoader.tryLoad(id);
        if (!loaded.ok) continue;
        if (hasMayaGroups(loaded.value)) {
            preferred.push(id);
        } else {
            fallback.push(id);
        }
        if (preferred.length >= limit && fallback.length >= limit) break;
    }
    return preferred.length >= limit
        ? preferred.slice(0, limit)
        : preferred.concat(fallback).slice(0, limit);
}

function applySkeletalToModelBaseOnlyTs(model: ModelData, seq: SkeletalSeq, frame: number): void {
    if (!model.animMayaGroups || !model.animMayaScales) return;

    const pools = new SkeletalPools();
    pools.reset();
    const base = seq.skeletalBase;
    base.updateAnimMatrices(seq, frame, pools);

    const scaleVector = vec3.create();
    const scaleMatrix = mat4.create();
    const weightedBoneMatrix = mat4.create();
    const transformMatrix = mat4.create();

    for (let v = 0; v < model.verticesCount; v++) {
        const group = model.animMayaGroups[v];
        const scales = model.animMayaScales[v];
        if (!group || !scales || group.length === 0 || scales.length === 0) continue;

        transformMatrix.fill(0);
        const n = Math.min(group.length, scales.length);
        for (let i = 0; i < n; i++) {
            const boneId = group[i] | 0;
            const bone = base.getBone(boneId);
            if (!bone) continue;

            const s = (scales[i] | 0) / 255;
            vec3.set(scaleVector, s, s, s);
            mat4.fromScaling(scaleMatrix, scaleVector);
            mat4.mul(weightedBoneMatrix, scaleMatrix, bone.getFinalMatrix(seq.poseId));
            for (let e = 0; e < 16; e++) {
                transformMatrix[e] += weightedBoneMatrix[e];
            }
        }

        const vx = model.verticesX[v];
        const vy = -model.verticesY[v];
        const vz = -model.verticesZ[v];
        model.verticesX[v] = Math.round(
            transformMatrix[0] * vx +
                transformMatrix[4] * vy +
                transformMatrix[8] * vz +
                transformMatrix[12],
        );
        model.verticesY[v] = -Math.round(
            transformMatrix[1] * vx +
                transformMatrix[5] * vy +
                transformMatrix[9] * vz +
                transformMatrix[13],
        );
        model.verticesZ[v] = -Math.round(
            transformMatrix[2] * vx +
                transformMatrix[6] * vy +
                transformMatrix[10] * vz +
                transformMatrix[14],
        );
    }
}

function buildFaceLabelsFromFaceSkins(model: ModelData): Int32Array[] | undefined {
    const faceSkins = model.faceSkins;
    if (!faceSkins || faceSkins.length === 0 || model.faceCount <= 0) return undefined;

    const faceCount = Math.min(model.faceCount, faceSkins.length);
    let maxSkin = -1;
    for (let i = 0; i < faceCount; i++) {
        const skin = faceSkins[i] | 0;
        if (skin > maxSkin) maxSkin = skin;
    }
    if (maxSkin < 0) return undefined;

    const counts = new Int32Array(maxSkin + 1);
    for (let i = 0; i < faceCount; i++) {
        const skin = faceSkins[i] | 0;
        if (skin >= 0 && skin <= maxSkin) counts[skin]++;
    }

    const faceLabels = Array.from({ length: maxSkin + 1 }, (_, i) => new Int32Array(counts[i]));
    counts.fill(0);
    for (let fi = 0; fi < faceCount; fi++) {
        const skin = faceSkins[fi] | 0;
        if (skin >= 0 && skin <= maxSkin) {
            faceLabels[skin][counts[skin]++] = fi;
        }
    }
    return faceLabels;
}

function applySkeletalAlphaTs(model: ModelData, seq: SkeletalSeq, frame: number): void {
    if (!seq.hasAlphaTransform) return;
    const faceAlphas = model.faceAlphas;
    if (!faceAlphas || faceAlphas.length === 0) return;

    const base = seq.base;
    const faceLabels =
        model.faceLabels && model.faceLabels.length > 0
            ? model.faceLabels
            : buildFaceLabelsFromFaceSkins(model);
    if (!faceLabels || faceLabels.length === 0) return;

    for (let i = 0; i < base.count; i++) {
        if (base.types[i] !== SeqTransformType.ALPHA) continue;
        const curve = seq.curves?.[i]?.[0];
        if (!curve) continue;
        const labels = base.labels[i];

        for (let li = 0; li < labels.length; li++) {
            const label = labels[li] | 0;
            if (label < 0 || label >= faceLabels.length) continue;
            const faces = faceLabels[label];
            for (let fi = 0; fi < faces.length; fi++) {
                const faceIndex = faces[fi] | 0;
                if (faceIndex < 0 || faceIndex >= faceAlphas.length) continue;
                let nextAlpha = (faceAlphas[faceIndex] & 0xff) + curve.getValue(frame) * 255;
                if (nextAlpha < 0) nextAlpha = 0;
                else if (nextAlpha > 255) nextAlpha = 255;
                faceAlphas[faceIndex] = nextAlpha;
            }
        }
    }
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
    const modelLoader = session.getModelLoader();
    if (!modelLoader) {
        throw new Error("TS session has no model service for this cache");
    }

    const pairs =
        args.pairs && args.pairs.length > 0
            ? args.pairs
            : (() => {
                  const seqIds = collectSkeletalIds(
                      (id) => session.tryLoadSeqType(id),
                      skeletalSeqLoader,
                      args.limit,
                  );
                  const modelIds = collectModelIdsWithMaya(modelLoader, args.limit);
                  const n = Math.min(args.limit, seqIds.length, modelIds.length);
                  const out: Array<[number, number]> = [];
                  for (let i = 0; i < n; i++) out.push([seqIds[i], modelIds[i]]);
                  return out;
              })();
    if (pairs.length === 0) {
        throw new Error("No skeletal:model pairs selected");
    }

    let mismatches = 0;
    const frames = Array.from({ length: args.maxFrames }, (_, i) => args.frameStart + i);
    for (const frame of frames) {
        const tsEntries: TsEntry[] = [];
        for (const [seqId, modelId] of pairs) {
            const seqLoaded = skeletalSeqLoader.tryLoad(seqId);
            if (!seqLoaded.ok) {
                tsEntries.push({
                    seqId,
                    modelId,
                    ok: false,
                    kind: toStatusKind((seqLoaded as any).error?.kind),
                });
                continue;
            }
            const seq = seqLoaded.value;

            const modelLoaded = modelLoader.tryLoad(modelId);
            if (!modelLoaded.ok) {
                tsEntries.push({
                    seqId,
                    modelId,
                    ok: false,
                    kind: toStatusKind((modelLoaded as any).error?.kind),
                });
                continue;
            }

            const model = ModelData.copyFrom(
                modelLoaded.value,
                /*shallowIndices=*/ false,
                /*shallowVertices=*/ false,
                /*shallowColors=*/ true,
                /*shallowTextures=*/ true,
            );
            applySkeletalToModelBaseOnlyTs(model, seq, frame);
            applySkeletalAlphaTs(model, seq, frame);
            tsEntries.push({
                seqId,
                modelId,
                ok: true,
                baseId: seq.base.id | 0,
                poseId: seq.poseId | 0,
                curveCount: seq.curveCount | 0,
                vertexCount: model.verticesCount | 0,
                hash: hashModelVertices(model),
                hasFaceAlphas: !!model.faceAlphas,
                alphaHash: hashModelFaceAlphas(model),
            });
        }

        const cpp = spawnSync(
            "./cpp/build/rs_cli",
            [
                "skeletal_model_hashes",
                "--cache",
                cacheInfo.name,
                "--game",
                String(getGameTypeName(cacheInfo.game)),
                "--revision",
                String(cacheInfo.revision),
                "--frame",
                String(frame),
                "--pairs",
                pairs.map(([a, b]) => `${a}:${b}`).join(","),
            ],
            { encoding: "utf8" },
        );
        if (cpp.status !== 0) {
            throw new Error(`rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
        }

        const parsed = JSON.parse(cpp.stdout) as { entries: CppEntry[] };
        const cppByKey = new Map<string, CppEntry>();
        for (const e of parsed.entries) cppByKey.set(`${e.seqId}:${e.modelId}`, e);

        for (const ts of tsEntries) {
            const key = `${ts.seqId}:${ts.modelId}`;
            const cppEntry = cppByKey.get(key);
            if (!cppEntry) {
                mismatches++;
                console.error(`missing C++ entry frame=${frame} pair=${key}`);
                continue;
            }

            if (ts.ok) {
                if (!cppEntry.ok) {
                    mismatches++;
                    console.error(
                        `status mismatch frame=${frame} pair=${key}: ts=ok cpp=${cppEntry.status}`,
                    );
                    continue;
                }
                if (
                    ts.baseId !== cppEntry.baseId ||
                    ts.poseId !== cppEntry.poseId ||
                    ts.curveCount !== cppEntry.curveCount ||
                    ts.vertexCount !== cppEntry.vertexCount ||
                    ts.hash !== cppEntry.hash ||
                    ts.hasFaceAlphas !== cppEntry.hasFaceAlphas ||
                    ts.alphaHash !== cppEntry.alphaHash
                ) {
                    mismatches++;
                    console.error(
                        `value mismatch frame=${frame} pair=${key}\nts=${JSON.stringify(
                            ts,
                        )}\ncpp=${JSON.stringify(cppEntry)}`,
                    );
                }
                continue;
            }

            if (cppEntry.ok) {
                mismatches++;
                console.error(`status mismatch frame=${frame} pair=${key}: ts=${ts.kind} cpp=ok`);
                continue;
            }
            const statusKind = statusKindFromCppStatus(cppEntry.status);
            const cppKind = statusKind !== "other" ? statusKind : cppEntry.errorClass ?? "other";
            if (ts.kind !== cppKind) {
                mismatches++;
                console.error(
                    `status mismatch frame=${frame} pair=${key}: ts=${ts.kind} cpp=${cppEntry.status}/${cppKind}`,
                );
            }
        }
    }

    console.log(
        `skeletal-model-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} pairs=${
            pairs.length
        } frames=${args.frameStart}..${
            args.frameStart + args.maxFrames - 1
        } mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

void main();
