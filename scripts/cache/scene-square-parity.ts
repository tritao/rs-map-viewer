import { spawnSync } from "child_process";

import {
    CacheInfo,
    GameType,
    getGameTypeName,
    getLatestCache,
} from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId } from "../../src/rs/cache/IndexId";
import { asXteaKey } from "../../src/rs/crypto/Xtea";
import { LocModelType } from "../../src/rs/config/loctype/LocModelType";
import { FloorTypeLoader } from "../../src/rs/config/floortype/FloorTypeLoader";
import { LocTypeLoader } from "../../src/rs/config/loctype/LocTypeLoader";
import { VarManager } from "../../src/rs/config/vartype/VarManager";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { getQuestTypeLoader } from "../../src/rs/loaders/Loaders";
import { tryCreateLoaders } from "../../src/rs/loaders/createLoaders";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { MapBytesProvider, MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { packHsl } from "../../src/rs/util/ColorUtil";
import {
    TerrainSquareDecodeScratch,
    decodeTerrainSquareFromBytesInto,
} from "../../src/rs/scene/decodeTerrainSquare";
import { decodeLocPlacementsFromBytes } from "../../src/rs/scene/decodeLocPlacements";
import { SkeletalPools } from "../../src/rs/model/skeletal/SkeletalPools";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = { cacheName?: string; limit: number; locLoadType: "models" | "no_models" };

type TsSceneLocPlacement = {
    originalId: number;
    resolvedId: number;
    level: number;
    tileX: number;
    tileY: number;
    type: number;
    rotation: number;
    renderKind: number;
    modelAvailable: number;
    modelSignature: number;
    modelVerticesCount: number;
    modelFaceCount: number;
    modelTextureFaceCount: number;
    modelHasMayaGroups: number;
    sequenceId: number;
    animMayaId: number;
    skeletalBaseId: number;
    skeletalPoseId: number;
    skeletalCurveCount: number;
    skeletalAvailable: number;
    skeletalHasAlpha: number;
    skeletalFrame: number;
    skeletalFrameHash: number;
};

type TsSceneState = {
    levels: number;
    sizeX: number;
    sizeY: number;
    tileHeights: Int32Array;
    tileRenderFlags: Uint8Array;
    tileUnderlays: Uint16Array;
    tileOverlays: Int16Array;
    tileShapes: Uint8Array;
    tileRotations: Uint8Array;
    blockedByFloor: Uint8Array;
    tileMinLevels: Uint8Array;
    tileModelPresent: Uint8Array;
    tileLightValues: Int16Array;
    blendedUnderlayHsl: Int32Array;
    locPlacements: TsSceneLocPlacement[];
};

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 30, locLoadType: "no_models" };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--limit") args.limit = Number(argv[++i]);
        else if (a === "--locLoadType") {
            const v = argv[++i];
            if (v === "models" || v === "no_models") args.locLoadType = v;
            else throw new Error("Invalid --locLoadType (expected models|no_models)");
        }
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("Invalid --limit");
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

const FLOAT_BYTES = new ArrayBuffer(4);
const FLOAT_VIEW = new DataView(FLOAT_BYTES);

function fnv1a32UpdateFloat(h: number, v: number): number {
    FLOAT_VIEW.setFloat32(0, v, true);
    const bits = FLOAT_VIEW.getUint32(0, true);
    return fnv1a32UpdateInt(h, bits);
}

function isNewTerrainFormat(cacheInfo: CacheInfo): boolean {
    return cacheInfo.game === GameType.Oldschool && cacheInfo.revision >= 209;
}

function shouldFillEmptyTerrain(cacheInfo: CacheInfo): boolean {
    return cacheInfo.game === GameType.Runescape && cacheInfo.revision <= 225;
}

function createSceneState(sizeX: number, sizeY: number): TsSceneState {
    const levels = 4;
    return {
        levels,
        sizeX,
        sizeY,
        tileHeights: new Int32Array(levels * (sizeX + 1) * (sizeY + 1)),
        tileRenderFlags: new Uint8Array(levels * sizeX * sizeY),
        tileUnderlays: new Uint16Array(levels * sizeX * sizeY),
        tileOverlays: new Int16Array(levels * sizeX * sizeY),
        tileShapes: new Uint8Array(levels * sizeX * sizeY),
        tileRotations: new Uint8Array(levels * sizeX * sizeY),
        blockedByFloor: new Uint8Array(levels * sizeX * sizeY),
        tileMinLevels: new Uint8Array(levels * sizeX * sizeY),
        tileModelPresent: new Uint8Array(levels * sizeX * sizeY),
        tileLightValues: new Int16Array(levels * sizeX * sizeY),
        blendedUnderlayHsl: new Int32Array(levels * sizeX * sizeY).fill(-1),
        locPlacements: [],
    };
}

function tileIndex(state: TsSceneState, level: number, x: number, y: number): number {
    return (level * state.sizeX + x) * state.sizeY + y;
}

function heightIndex(state: TsSceneState, level: number, x: number, y: number): number {
    return (level * (state.sizeX + 1) + x) * (state.sizeY + 1) + y;
}

function isWithinBounds(state: TsSceneState, level: number, x: number, y: number): boolean {
    return level >= 0 && level < state.levels && x >= 0 && x < state.sizeX && y >= 0 && y < state.sizeY;
}

function applyTerrainSquareToState(
    state: TsSceneState,
    scratch: TerrainSquareDecodeScratch,
    offsetX: number,
    offsetY: number,
): void {
    for (let level = 0; level < state.levels; level++) {
        for (let x = 0; x < 64; x++) {
            for (let y = 0; y < 64; y++) {
                const sceneX = x + offsetX;
                const sceneY = y + offsetY;
                if (!isWithinBounds(state, level, sceneX, sceneY)) continue;
                const ti = tileIndex(state, level, sceneX, sceneY);
                state.tileHeights[heightIndex(state, level, sceneX, sceneY)] =
                    scratch.tileHeights[level][x][y];
                state.tileRenderFlags[ti] = scratch.tileRenderFlags[level][x][y];
                state.tileUnderlays[ti] = scratch.tileUnderlays[level][x][y];
                state.tileOverlays[ti] = scratch.tileOverlays[level][x][y];
                state.tileShapes[ti] = scratch.tileShapes[level][x][y];
                state.tileRotations[ti] = scratch.tileRotations[level][x][y];
            }
        }
    }

    for (let level = 0; level < state.levels; level++) {
        for (let x = 0; x < 64; x++) {
            for (let y = 0; y < 64; y++) {
                if ((scratch.tileRenderFlags[level][x][y] & 0x1) === 0) continue;
                const sceneX = x + offsetX;
                const sceneY = y + offsetY;
                let realLevel = level;
                if (state.levels > 1 && (scratch.tileRenderFlags[1][x][y] & 0x2) !== 0) {
                    realLevel = level - 1;
                }
                if (realLevel >= 0 && isWithinBounds(state, realLevel, sceneX, sceneY)) {
                    state.blockedByFloor[tileIndex(state, realLevel, sceneX, sceneY)] = 1;
                }
            }
        }
    }
}

function loadEmptyTerrain(
    state: TsSceneState,
    fillEmptyTerrain: boolean,
    level: number,
    tileX: number,
    tileY: number,
    sizeX: number,
    sizeY: number,
): void {
    for (let ty = tileY; ty < tileY + sizeY; ty++) {
        for (let tx = tileX; tx < tileX + sizeX; tx++) {
            if (tx >= 0 && tx < state.sizeX && ty >= 0 && ty < state.sizeY) {
                if (level === 0) {
                    state.tileHeights[heightIndex(state, level, tx, ty)] = 0;
                    if (fillEmptyTerrain) {
                        state.tileOverlays[tileIndex(state, level, tx, ty)] = 6;
                    }
                } else {
                    state.tileHeights[heightIndex(state, level, tx, ty)] =
                        state.tileHeights[heightIndex(state, level - 1, tx, ty)] - 240;
                }
            }
        }
    }

    if (tileX > 0 && state.sizeX > tileX) {
        for (let ty = tileY + 1; ty < tileY + sizeY; ty++) {
            if (ty >= 0 && ty < state.sizeY) {
                state.tileHeights[heightIndex(state, level, tileX, ty)] =
                    state.tileHeights[heightIndex(state, level, tileX - 1, ty)];
            }
        }
    }
    if (tileY > 0 && state.sizeY > tileY) {
        for (let tx = tileX + 1; tx < tileX + sizeX; tx++) {
            if (tx >= 0 && tx < state.sizeX) {
                state.tileHeights[heightIndex(state, level, tx, tileY)] =
                    state.tileHeights[heightIndex(state, level, tx, tileY - 1)];
            }
        }
    }
    if (tileX >= 0 && tileY >= 0 && tileX < state.sizeX && tileY < state.sizeY) {
        if (level !== 0) {
            if (
                tileX > 0 &&
                state.tileHeights[heightIndex(state, level, tileX - 1, tileY)] !==
                    state.tileHeights[heightIndex(state, level - 1, tileX - 1, tileY)]
            ) {
                state.tileHeights[heightIndex(state, level, tileX, tileY)] =
                    state.tileHeights[heightIndex(state, level, tileX - 1, tileY)];
            } else if (
                tileY <= 0 ||
                state.tileHeights[heightIndex(state, level, tileX, tileY - 1)] ===
                    state.tileHeights[heightIndex(state, level - 1, tileX, tileY - 1)]
            ) {
                if (
                    tileX > 0 &&
                    tileY > 0 &&
                    state.tileHeights[heightIndex(state, level, tileX - 1, tileY - 1)] !==
                        state.tileHeights[heightIndex(state, level - 1, tileX - 1, tileY - 1)]
                ) {
                    state.tileHeights[heightIndex(state, level, tileX, tileY)] =
                        state.tileHeights[heightIndex(state, level, tileX - 1, tileY - 1)];
                }
            } else {
                state.tileHeights[heightIndex(state, level, tileX, tileY)] =
                    state.tileHeights[heightIndex(state, level, tileX, tileY - 1)];
            }
        } else if (
            tileX > 0 &&
            state.tileHeights[heightIndex(state, level, tileX - 1, tileY)] !== 0
        ) {
            state.tileHeights[heightIndex(state, level, tileX, tileY)] =
                state.tileHeights[heightIndex(state, level, tileX - 1, tileY)];
        } else if (
            tileY > 0 &&
            state.tileHeights[heightIndex(state, level, tileX, tileY - 1)] !== 0
        ) {
            state.tileHeights[heightIndex(state, level, tileX, tileY)] =
                state.tileHeights[heightIndex(state, level, tileX, tileY - 1)];
        } else if (
            tileX > 0 &&
            tileY > 0 &&
            state.tileHeights[heightIndex(state, level, tileX - 1, tileY - 1)] !== 0
        ) {
            state.tileHeights[heightIndex(state, level, tileX, tileY)] =
                state.tileHeights[heightIndex(state, level, tileX - 1, tileY - 1)];
        }
    }
}

function finalizeTileMinLevels(state: TsSceneState): void {
    for (let level = 0; level < state.levels; level++) {
        for (let x = 0; x < state.sizeX; x++) {
            for (let y = 0; y < state.sizeY; y++) {
                const idx = tileIndex(state, level, x, y);
                const flags = state.tileRenderFlags[idx];
                let minLevel = level;
                if ((flags & 0x8) !== 0) {
                    minLevel = 0;
                } else if (level > 0 && (flags & 0x2) !== 0) {
                    minLevel = level - 1;
                }
                state.tileMinLevels[idx] = minLevel;
            }
        }
    }
}

function normalizeModelType(placementType: number): number {
    switch (placementType) {
        case LocModelType.NORMAL_DIAGIONAL:
            return LocModelType.NORMAL;
        case LocModelType.WALL_DECORATION_OUTSIDE:
        case LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE:
        case LocModelType.WALL_DECORATION_DIAGONAL_INSIDE:
        case LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE:
            return LocModelType.WALL_DECORATION_INSIDE;
        default:
            return placementType;
    }
}

type TsModelDataLike = {
    version?: number;
    verticesCount: number;
    usedVertexCount?: number;
    faceCount: number;
    textureFaceCount: number;
    priority?: number;
    verticesX: Int32Array;
    verticesY: Int32Array;
    verticesZ: Int32Array;
    indices1: Int32Array;
    indices2: Int32Array;
    indices3: Int32Array;
    faceColors: Uint16Array;
    faceRenderTypes?: Int8Array;
    faceRenderPriorities?: Int8Array;
    faceAlphas?: Int8Array;
    textureCoords?: Int8Array;
    faceTextures?: Int16Array;
    textureRenderTypes?: Int8Array;
    textureMappingP?: Int16Array;
    textureMappingM?: Int16Array;
    textureMappingN?: Int16Array;
    textureScaleX?: Int32Array;
    textureScaleY?: Int32Array;
    textureScaleZ?: Int32Array;
    textureRotation?: Int8Array;
    textureDirection?: Int8Array;
    textureSpeed?: Int32Array;
    textureTransU?: Int32Array;
    textureTransV?: Int32Array;
    vertexSkins?: Int32Array;
    faceSkins?: Int32Array;
    animMayaGroups?: Int32Array[];
    animMayaScales?: Int32Array[];
};

type TsStaticModelInfo = {
    signature: number;
    verticesCount: number;
    faceCount: number;
    textureFaceCount: number;
    hasMayaGroups: boolean;
};

type TsSkeletalInfo = {
    seqId: number;
    animMayaId: number;
    baseId: number;
    poseId: number;
    curveCount: number;
    hasAlphaTransform: boolean;
    frame: number;
    frameHash: number;
};

function fnv1a32UpdateArray(
    h: number,
    values: ArrayLike<number> | undefined,
): number {
    const size = values ? values.length : 0;
    h = fnv1a32UpdateInt(h, size | 0);
    if (!values) return h;
    for (let i = 0; i < values.length; i++) {
        h = fnv1a32UpdateInt(h, values[i] | 0);
    }
    return h;
}

function fnv1a32UpdateOptionalArray(
    h: number,
    values: ArrayLike<number> | undefined,
): number {
    const present = values !== undefined;
    h = fnv1a32UpdateInt(h, present ? 1 : 0);
    if (!present) return h;
    return fnv1a32UpdateArray(h, values);
}

function fnv1a32UpdateNestedInt32Arrays(
    h: number,
    values: Int32Array[] | undefined,
): number {
    const present = values !== undefined;
    h = fnv1a32UpdateInt(h, present ? 1 : 0);
    if (!present) return h;
    h = fnv1a32UpdateInt(h, values.length | 0);
    for (let i = 0; i < values.length; i++) {
        h = fnv1a32UpdateArray(h, values[i]);
    }
    return h;
}

function hasMayaGroups(model: TsModelDataLike): boolean {
    if (!model.animMayaGroups || !model.animMayaScales) return false;
    for (let i = 0; i < model.animMayaGroups.length; i++) {
        if (model.animMayaGroups[i] && model.animMayaGroups[i].length > 0) return true;
    }
    return false;
}

function hashModelDataDetailed(model: TsModelDataLike): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4c4d4448); // 'LMDH'
    h = fnv1a32UpdateInt(h, (model.version ?? -1) | 0);
    h = fnv1a32UpdateInt(h, model.verticesCount | 0);
    h = fnv1a32UpdateInt(h, model.faceCount | 0);
    h = fnv1a32UpdateInt(h, model.textureFaceCount | 0);
    h = fnv1a32UpdateArray(h, model.verticesX);
    h = fnv1a32UpdateArray(h, model.verticesY);
    h = fnv1a32UpdateArray(h, model.verticesZ);
    h = fnv1a32UpdateArray(h, model.indices1);
    h = fnv1a32UpdateArray(h, model.indices2);
    h = fnv1a32UpdateArray(h, model.indices3);
    h = fnv1a32UpdateArray(h, model.faceColors);
    h = fnv1a32UpdateArray(h, model.textureRenderTypes);
    h = fnv1a32UpdateArray(h, model.textureMappingP);
    h = fnv1a32UpdateArray(h, model.textureMappingM);
    h = fnv1a32UpdateArray(h, model.textureMappingN);
    h = fnv1a32UpdateArray(h, model.textureScaleX);
    h = fnv1a32UpdateArray(h, model.textureScaleY);
    h = fnv1a32UpdateArray(h, model.textureScaleZ);
    h = fnv1a32UpdateArray(h, model.textureRotation);
    h = fnv1a32UpdateArray(h, model.textureDirection);
    h = fnv1a32UpdateArray(h, model.textureSpeed);
    h = fnv1a32UpdateArray(h, model.textureTransU);
    h = fnv1a32UpdateArray(h, model.textureTransV);
    h = fnv1a32UpdateArray(h, model.vertexSkins);
    h = fnv1a32UpdateArray(h, model.faceSkins);
    h = fnv1a32UpdateInt(h, model.animMayaGroups !== undefined ? 1 : 0);
    h = fnv1a32UpdateNestedInt32Arrays(h, model.animMayaGroups);
    h = fnv1a32UpdateNestedInt32Arrays(h, model.animMayaScales);
    return h | 0;
}

function tryResolveLocModelInfo(
    locTypeLoader: LocTypeLoader,
    modelLoader: { tryGet(id: number): TsModelDataLike | undefined },
    resolvedId: number,
    placementType: number,
    rotation: number,
): TsStaticModelInfo | undefined {
    const locResult = locTypeLoader.tryLoad(resolvedId);
    if (!locResult.ok) return undefined;
    const locType = locResult.value;
    const normalizedType = normalizeModelType(placementType);

    let modelIds: readonly number[] | undefined;
    if (!locType.types) {
        if (normalizedType !== LocModelType.NORMAL) return undefined;
        modelIds = locType.models?.[0];
    } else {
        const idx = locType.types.findIndex((t) => t === normalizedType);
        if (idx < 0) return undefined;
        modelIds = locType.models?.[idx];
    }
    if (!modelIds || modelIds.length === 0) return undefined;

    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4c4d534d); // 'LMSM'
    h = fnv1a32UpdateInt(h, normalizedType | 0);
    h = fnv1a32UpdateInt(h, rotation | 0);
    h = fnv1a32UpdateInt(h, locType.isRotated ? 1 : 0);
    h = fnv1a32UpdateInt(h, locType.modelSizeX | 0);
    h = fnv1a32UpdateInt(h, locType.modelSizeHeight | 0);
    h = fnv1a32UpdateInt(h, locType.modelSizeY | 0);
    h = fnv1a32UpdateInt(h, locType.offsetX | 0);
    h = fnv1a32UpdateInt(h, locType.offsetHeight | 0);
    h = fnv1a32UpdateInt(h, locType.offsetY | 0);
    h = fnv1a32UpdateArray(h, locType.recolorFrom);
    h = fnv1a32UpdateArray(h, locType.recolorTo);
    h = fnv1a32UpdateArray(h, locType.retextureFrom);
    h = fnv1a32UpdateArray(h, locType.retextureTo);

    let totalVertices = 0;
    let totalFaces = 0;
    let totalTextureFaces = 0;
    let maya = false;
    for (const modelId of modelIds) {
        const model = modelLoader.tryGet(modelId);
        if (!model) return undefined;
        h = fnv1a32UpdateInt(h, modelId);
        h = fnv1a32UpdateInt(h, hashModelDataDetailed(model));
        totalVertices += model.verticesCount | 0;
        totalFaces += model.faceCount | 0;
        totalTextureFaces += model.textureFaceCount | 0;
        maya ||= hasMayaGroups(model);
    }
    return {
        signature: h | 0,
        verticesCount: totalVertices | 0,
        faceCount: totalFaces | 0,
        textureFaceCount: totalTextureFaces | 0,
        hasMayaGroups: maya,
    };
}

function hashSkeletalFinalMatrices(seq: any, frame: number): number {
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
    return h | 0;
}

function tryResolveSkeletalInfo(
    seqTypeLoader: { tryLoad(id: number): { ok: true; value: any } | { ok: false } },
    skeletalSeqLoader: { tryLoad(id: number): { ok: true; value: any } | { ok: false } } | undefined,
    seqId: number,
): TsSkeletalInfo | undefined {
    if (seqId < 0 || !skeletalSeqLoader) return undefined;
    const seqTypeResult = seqTypeLoader.tryLoad(seqId);
    if (!seqTypeResult.ok) return undefined;
    const seqType = seqTypeResult.value;
    if ((seqType.animMayaId | 0) < 0) return undefined;
    const sk = skeletalSeqLoader.tryLoad(seqType.animMayaId | 0);
    if (!sk.ok) return undefined;
    const skeletalSeq = sk.value;
    const frame = seqType.animMayaStart | 0;
    return {
        seqId: seqId | 0,
        animMayaId: seqType.animMayaId | 0,
        baseId: skeletalSeq.base.id | 0,
        poseId: skeletalSeq.poseId | 0,
        curveCount: skeletalSeq.curveCount | 0,
        hasAlphaTransform: Boolean(skeletalSeq.hasAlphaTransform),
        frame,
        frameHash: hashSkeletalFinalMatrices(skeletalSeq, frame),
    };
}

function blendUnderlaysForLevel(
    state: TsSceneState,
    level: number,
    underlayTypeLoader: Pick<FloorTypeLoader, "tryLoad">,
): Int32Array {
    const colors = new Int32Array(state.sizeX * state.sizeY).fill(-1);
    const maxSize = Math.max(state.sizeX, state.sizeY);
    const hues = new Int32Array(maxSize);
    const sats = new Int32Array(maxSize);
    const lights = new Int32Array(maxSize);
    const muls = new Int32Array(maxSize);
    const nums = new Int32Array(maxSize);
    const radius = 5;

    const blendStartX = -radius;
    const blendStartY = -radius;
    const blendEndX = state.sizeX + radius;
    const blendEndY = state.sizeY + radius;

    for (let xi = blendStartX; xi < blendEndX; xi++) {
        for (let yi = 0; yi < state.sizeY; yi++) {
            const xEast = xi + radius;
            if (xEast >= 0 && xEast < state.sizeX) {
                const underlayId = state.tileUnderlays[tileIndex(state, level, xEast, yi)];
                if (underlayId > 0) {
                    const r = underlayTypeLoader.tryLoad((underlayId - 1) | 0);
                    if (r.ok) {
                        hues[yi] += r.value.getHueBlend();
                        sats[yi] += r.value.saturation;
                        lights[yi] += r.value.lightness;
                        muls[yi] += r.value.getHueMultiplier();
                        nums[yi]++;
                    }
                }
            }

            const xWest = xi - radius;
            if (xWest >= 0 && xWest < state.sizeX) {
                const underlayId = state.tileUnderlays[tileIndex(state, level, xWest, yi)];
                if (underlayId > 0) {
                    const r = underlayTypeLoader.tryLoad((underlayId - 1) | 0);
                    if (r.ok) {
                        hues[yi] -= r.value.getHueBlend();
                        sats[yi] -= r.value.saturation;
                        lights[yi] -= r.value.lightness;
                        muls[yi] -= r.value.getHueMultiplier();
                        nums[yi]--;
                    }
                }
            }
        }

        if (xi < 0 || xi >= state.sizeX) continue;

        let runningHues = 0;
        let runningSat = 0;
        let runningLight = 0;
        let runningMul = 0;
        let runningNum = 0;

        for (let yi = blendStartY; yi < blendEndY; yi++) {
            const yNorth = yi + radius;
            if (yNorth >= 0 && yNorth < state.sizeY) {
                runningHues += hues[yNorth];
                runningSat += sats[yNorth];
                runningLight += lights[yNorth];
                runningMul += muls[yNorth];
                runningNum += nums[yNorth];
            }

            const ySouth = yi - radius;
            if (ySouth >= 0 && ySouth < state.sizeY) {
                runningHues -= hues[ySouth];
                runningSat -= sats[ySouth];
                runningLight -= lights[ySouth];
                runningMul -= muls[ySouth];
                runningNum -= nums[ySouth];
            }

            if (yi < 0 || yi >= state.sizeY) continue;
            const underlayId = state.tileUnderlays[tileIndex(state, level, xi, yi)];
            if (underlayId <= 0 || runningMul === 0 || runningNum === 0) continue;

            const avgHue = Math.trunc((runningHues * 256) / runningMul);
            const avgSat = Math.trunc(runningSat / runningNum);
            const avgLight = Math.trunc(runningLight / runningNum);
            colors[xi * state.sizeY + yi] = packHsl(avgHue, avgSat, avgLight);
        }
    }

    return colors;
}

function calculateTileLightsForLevel(state: TsSceneState, level: number): void {
    const LIGHT_DIR_X = -50;
    const LIGHT_DIR_Y = -10;
    const LIGHT_DIR_Z = -50;
    const LIGHT_INTENSITY_BASE = 96;
    const LIGHT_INTENSITY_FACTOR = 768;
    const HEIGHT_SCALE = 65536;
    const lightMagnitude = Math.trunc(
        Math.sqrt(LIGHT_DIR_X * LIGHT_DIR_X + LIGHT_DIR_Y * LIGHT_DIR_Y + LIGHT_DIR_Z * LIGHT_DIR_Z),
    );
    const lightIntensity = (lightMagnitude * LIGHT_INTENSITY_FACTOR) >> 8;
    if (lightIntensity === 0) return;

    for (let x = 1; x < state.sizeX - 1; x++) {
        for (let y = 1; y < state.sizeY - 1; y++) {
            const heightDeltaX =
                state.tileHeights[heightIndex(state, level, x + 1, y)] -
                state.tileHeights[heightIndex(state, level, x - 1, y)];
            const heightDeltaY =
                state.tileHeights[heightIndex(state, level, x, y + 1)] -
                state.tileHeights[heightIndex(state, level, x, y - 1)];
            const tileNormalLength = Math.trunc(
                Math.sqrt(heightDeltaY * heightDeltaY + heightDeltaX * heightDeltaX + HEIGHT_SCALE),
            );
            if (tileNormalLength <= 0) continue;

            const normalX = Math.trunc((heightDeltaX << 8) / tileNormalLength);
            const normalY = Math.trunc(HEIGHT_SCALE / tileNormalLength);
            const normalZ = Math.trunc((heightDeltaY << 8) / tileNormalLength);

            const dot = normalX * LIGHT_DIR_X + normalY * LIGHT_DIR_Y + normalZ * LIGHT_DIR_Z;
            state.tileLightValues[tileIndex(state, level, x, y)] = Math.trunc(
                dot / lightIntensity + LIGHT_INTENSITY_BASE,
            );
        }
    }
}

function finalizeSummaries(
    state: TsSceneState,
    underlayTypeLoader: Pick<FloorTypeLoader, "tryLoad">,
): void {
    for (let level = 0; level < state.levels; level++) {
        const blended = blendUnderlaysForLevel(state, level, underlayTypeLoader);
        for (let x = 0; x < state.sizeX; x++) {
            for (let y = 0; y < state.sizeY; y++) {
                const idx = tileIndex(state, level, x, y);
                state.blendedUnderlayHsl[idx] = blended[x * state.sizeY + y];
                state.tileModelPresent[idx] = 0;
                if (x <= 0 || y <= 0 || x >= state.sizeX - 1 || y >= state.sizeY - 1) continue;
                const underlayId = state.tileUnderlays[idx] - 1;
                const overlayId = state.tileOverlays[idx] - 1;
                if (underlayId !== -1 || overlayId !== -1) {
                    state.tileModelPresent[idx] = 1;
                }
            }
        }
        calculateTileLightsForLevel(state, level);
    }
}

function hashSceneState(state: TsSceneState): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x53434e48); // 'SCNH'

    h = fnv1a32UpdateInt(h, 0x48454954); // 'HEIT'
    for (let i = 0; i < state.tileHeights.length; i++) h = fnv1a32UpdateInt(h, state.tileHeights[i]);

    h = fnv1a32UpdateInt(h, 0x464c4147); // 'FLAG'
    for (let i = 0; i < state.tileRenderFlags.length; i++)
        h = fnv1a32UpdateInt(h, state.tileRenderFlags[i]);

    h = fnv1a32UpdateInt(h, 0x554e444c); // 'UNDL'
    for (let i = 0; i < state.tileUnderlays.length; i++)
        h = fnv1a32UpdateInt(h, state.tileUnderlays[i]);

    h = fnv1a32UpdateInt(h, 0x4f564552); // 'OVER'
    for (let i = 0; i < state.tileOverlays.length; i++)
        h = fnv1a32UpdateInt(h, state.tileOverlays[i]);

    h = fnv1a32UpdateInt(h, 0x53484150); // 'SHAP'
    for (let i = 0; i < state.tileShapes.length; i++) h = fnv1a32UpdateInt(h, state.tileShapes[i]);

    h = fnv1a32UpdateInt(h, 0x524f5441); // 'ROTA'
    for (let i = 0; i < state.tileRotations.length; i++)
        h = fnv1a32UpdateInt(h, state.tileRotations[i]);

    h = fnv1a32UpdateInt(h, 0x424c4b44); // 'BLKD'
    for (let i = 0; i < state.blockedByFloor.length; i++)
        h = fnv1a32UpdateInt(h, state.blockedByFloor[i]);

    h = fnv1a32UpdateInt(h, 0x4d494e4c); // 'MINL'
    for (let i = 0; i < state.tileMinLevels.length; i++)
        h = fnv1a32UpdateInt(h, state.tileMinLevels[i]);

    h = fnv1a32UpdateInt(h, 0x544d4f44); // 'TMOD'
    for (let i = 0; i < state.tileModelPresent.length; i++)
        h = fnv1a32UpdateInt(h, state.tileModelPresent[i]);

    h = fnv1a32UpdateInt(h, 0x544c4954); // 'TLIT'
    for (let i = 0; i < state.tileLightValues.length; i++)
        h = fnv1a32UpdateInt(h, state.tileLightValues[i]);

    h = fnv1a32UpdateInt(h, 0x424c4e44); // 'BLND'
    for (let i = 0; i < state.blendedUnderlayHsl.length; i++)
        h = fnv1a32UpdateInt(h, state.blendedUnderlayHsl[i]);

    h = fnv1a32UpdateInt(h, 0x4c4f4353); // 'LOCS'
    for (const p of state.locPlacements) {
        h = fnv1a32UpdateInt(h, p.originalId);
        h = fnv1a32UpdateInt(h, p.resolvedId);
        h = fnv1a32UpdateInt(h, p.level);
        h = fnv1a32UpdateInt(h, p.tileX);
        h = fnv1a32UpdateInt(h, p.tileY);
        h = fnv1a32UpdateInt(h, p.type);
        h = fnv1a32UpdateInt(h, p.rotation);
        h = fnv1a32UpdateInt(h, p.renderKind);
        h = fnv1a32UpdateInt(h, p.modelAvailable);
        h = fnv1a32UpdateInt(h, p.modelSignature);
        h = fnv1a32UpdateInt(h, p.modelVerticesCount);
        h = fnv1a32UpdateInt(h, p.modelFaceCount);
        h = fnv1a32UpdateInt(h, p.modelTextureFaceCount);
        h = fnv1a32UpdateInt(h, p.modelHasMayaGroups);
        h = fnv1a32UpdateInt(h, p.sequenceId);
        h = fnv1a32UpdateInt(h, p.animMayaId);
        h = fnv1a32UpdateInt(h, p.skeletalBaseId);
        h = fnv1a32UpdateInt(h, p.skeletalPoseId);
        h = fnv1a32UpdateInt(h, p.skeletalCurveCount);
        h = fnv1a32UpdateInt(h, p.skeletalAvailable);
        h = fnv1a32UpdateInt(h, p.skeletalHasAlpha);
        h = fnv1a32UpdateInt(h, p.skeletalFrame);
        h = fnv1a32UpdateInt(h, p.skeletalFrameHash);
    }

    return h | 0;
}

function hashSceneStateLegacy(state: TsSceneState): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x53434e48); // 'SCNH'

    h = fnv1a32UpdateInt(h, 0x48454954); // 'HEIT'
    for (let i = 0; i < state.tileHeights.length; i++) h = fnv1a32UpdateInt(h, state.tileHeights[i]);

    h = fnv1a32UpdateInt(h, 0x464c4147); // 'FLAG'
    for (let i = 0; i < state.tileRenderFlags.length; i++)
        h = fnv1a32UpdateInt(h, state.tileRenderFlags[i]);

    h = fnv1a32UpdateInt(h, 0x554e444c); // 'UNDL'
    for (let i = 0; i < state.tileUnderlays.length; i++)
        h = fnv1a32UpdateInt(h, state.tileUnderlays[i]);

    h = fnv1a32UpdateInt(h, 0x4f564552); // 'OVER'
    for (let i = 0; i < state.tileOverlays.length; i++)
        h = fnv1a32UpdateInt(h, state.tileOverlays[i]);

    h = fnv1a32UpdateInt(h, 0x53484150); // 'SHAP'
    for (let i = 0; i < state.tileShapes.length; i++) h = fnv1a32UpdateInt(h, state.tileShapes[i]);

    h = fnv1a32UpdateInt(h, 0x524f5441); // 'ROTA'
    for (let i = 0; i < state.tileRotations.length; i++)
        h = fnv1a32UpdateInt(h, state.tileRotations[i]);

    h = fnv1a32UpdateInt(h, 0x424c4b44); // 'BLKD'
    for (let i = 0; i < state.blockedByFloor.length; i++)
        h = fnv1a32UpdateInt(h, state.blockedByFloor[i]);

    h = fnv1a32UpdateInt(h, 0x4d494e4c); // 'MINL'
    for (let i = 0; i < state.tileMinLevels.length; i++)
        h = fnv1a32UpdateInt(h, state.tileMinLevels[i]);

    h = fnv1a32UpdateInt(h, 0x4c4f4353); // 'LOCS'
    for (const p of state.locPlacements) {
        h = fnv1a32UpdateInt(h, p.originalId);
        h = fnv1a32UpdateInt(h, p.resolvedId);
        h = fnv1a32UpdateInt(h, p.level);
        h = fnv1a32UpdateInt(h, p.tileX);
        h = fnv1a32UpdateInt(h, p.tileY);
        h = fnv1a32UpdateInt(h, p.type);
        h = fnv1a32UpdateInt(h, p.rotation);
    }
    return h | 0;
}

function hashTileModelSection(state: TsSceneState): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x544d4f44); // 'TMOD'
    for (let i = 0; i < state.tileModelPresent.length; i++) h = fnv1a32UpdateInt(h, state.tileModelPresent[i]);
    return h | 0;
}

function hashTileLightSection(state: TsSceneState): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x544c4954); // 'TLIT'
    for (let i = 0; i < state.tileLightValues.length; i++) h = fnv1a32UpdateInt(h, state.tileLightValues[i]);
    return h | 0;
}

function hashBlendedUnderlaySection(state: TsSceneState): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x424c4e44); // 'BLND'
    for (let i = 0; i < state.blendedUnderlayHsl.length; i++) h = fnv1a32UpdateInt(h, state.blendedUnderlayHsl[i]);
    return h | 0;
}

function hashLocRenderSection(state: TsSceneState): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4c4f4358); // 'LOCX'
    for (const p of state.locPlacements) {
        h = fnv1a32UpdateInt(h, p.renderKind);
        h = fnv1a32UpdateInt(h, p.modelAvailable);
        h = fnv1a32UpdateInt(h, p.modelSignature);
        h = fnv1a32UpdateInt(h, p.modelVerticesCount);
        h = fnv1a32UpdateInt(h, p.modelFaceCount);
        h = fnv1a32UpdateInt(h, p.modelTextureFaceCount);
        h = fnv1a32UpdateInt(h, p.modelHasMayaGroups);
        h = fnv1a32UpdateInt(h, p.sequenceId);
        h = fnv1a32UpdateInt(h, p.animMayaId);
        h = fnv1a32UpdateInt(h, p.skeletalBaseId);
        h = fnv1a32UpdateInt(h, p.skeletalPoseId);
        h = fnv1a32UpdateInt(h, p.skeletalCurveCount);
        h = fnv1a32UpdateInt(h, p.skeletalAvailable);
        h = fnv1a32UpdateInt(h, p.skeletalHasAlpha);
        h = fnv1a32UpdateInt(h, p.skeletalFrame);
        h = fnv1a32UpdateInt(h, p.skeletalFrameHash);
    }
    return h | 0;
}

function buildTsSceneHashForSquare(
    cacheInfo: CacheInfo,
    mapBytesProvider: MapBytesProvider,
    varProvider: VarManagerProvider,
    locTypeLoader: LocTypeLoader,
    seqTypeLoader: { tryLoad(id: number): { ok: true; value: any } | { ok: false } },
    underlayTypeLoader: Pick<FloorTypeLoader, "tryLoad">,
    modelLoader: { tryGet(id: number): TsModelDataLike | undefined },
    skeletalSeqLoader: { tryLoad(id: number): { ok: true; value: any } | { ok: false } } | undefined,
    locLoadType: "models" | "no_models",
    mapX: number,
    mapY: number,
): {
    hash: number;
    legacyHash: number;
    tileModelHash: number;
    tileLightHash: number;
    blendedUnderlayHash: number;
    locRenderHash: number;
    tileLightNonZero: number;
    tileLightSample: number[];
    tileLightProbe: number[];
    locCount: number;
} {
    const baseX = mapX * 64;
    const baseY = mapY * 64;
    const sizeX = 64;
    const sizeY = 64;

    const state = createSceneState(sizeX, sizeY);
    const scratch = new TerrainSquareDecodeScratch();
    const newFormat = isNewTerrainFormat(cacheInfo);
    const fillEmpty = shouldFillEmptyTerrain(cacheInfo);

    const mapStartX = Math.floor(baseX / 64);
    const mapStartY = Math.floor(baseY / 64);
    const mapEndX = Math.ceil((baseX + sizeX) / 64);
    const mapEndY = Math.ceil((baseY + sizeY) / 64);

    const emptyTerrain = new Set<number>();
    for (let mx = mapStartX; mx < mapEndX; mx++) {
        for (let my = mapStartY; my < mapEndY; my++) {
            const terrainBytes = mapBytesProvider.getTerrainBytes(mx, my);
            if (!terrainBytes) {
                emptyTerrain.add((mx << 16) | (my & 0xffff));
                continue;
            }
            const offsetX = mx * 64 - baseX;
            const offsetY = my * 64 - baseY;
            decodeTerrainSquareFromBytesInto(scratch, terrainBytes, newFormat, baseX + offsetX, baseY + offsetY);
            applyTerrainSquareToState(state, scratch, offsetX, offsetY);
        }
    }

    for (let mx = mapStartX; mx < mapEndX; mx++) {
        for (let my = mapStartY; my < mapEndY; my++) {
            if (!emptyTerrain.has((mx << 16) | (my & 0xffff))) continue;
            const endX = (mx + 1) * 64;
            const endY = (my + 1) * 64;
            const offsetX = mx * 64 - baseX;
            const offsetY = my * 64 - baseY;
            const tileX = Math.max(offsetX, 0);
            const tileY = Math.max(offsetY, 0);
            const emptySizeX = endX - baseX - tileX;
            const emptySizeY = endY - baseY - tileY;
            for (let level = 0; level < state.levels; level++) {
                loadEmptyTerrain(state, fillEmpty, level, tileX, tileY, emptySizeX, emptySizeY);
            }
        }
    }

    for (let mx = mapStartX; mx < mapEndX; mx++) {
        for (let my = mapStartY; my < mapEndY; my++) {
            const locBytes = mapBytesProvider.getLocBytes(mx, my);
            if (!locBytes) continue;
            const offsetX = mx * 64 - baseX;
            const offsetY = my * 64 - baseY;
            const placements = decodeLocPlacementsFromBytes(locBytes);
            for (const p of placements) {
                const sceneX = p.localX + offsetX;
                const sceneY = p.localY + offsetY;
                if (!(sceneX > 0 && sceneY > 0 && sceneX < state.sizeX - 1 && sceneY < state.sizeY - 1)) {
                    continue;
                }
                if ((state.tileRenderFlags[tileIndex(state, 0, sceneX, sceneY)] & 0x8) !== 0) {
                    continue;
                }

                const locResult = locTypeLoader.tryLoad(p.id);
                if (!locResult.ok) continue;
                let locType = locResult.value;
                if (locType.transforms) {
                    const transformed = locType.transform(varProvider, locTypeLoader);
                    if (transformed) locType = transformed;
                }
                let seqId = locType.seqId;
                if (seqId === -1 && locType.randomSeqIds && locType.randomSeqIds.length > 0) {
                    seqId = locType.randomSeqIds[0];
                }
                const isEntity =
                    seqId !== -1 ||
                    locType.transforms !== undefined ||
                    locLoadType === "no_models";

                let modelAvailable = 0;
                let modelSignature = 0;
                let modelVerticesCount = 0;
                let modelFaceCount = 0;
                let modelTextureFaceCount = 0;
                let modelHasMayaGroups = 0;
                if (!isEntity && locLoadType === "models") {
                    const info = tryResolveLocModelInfo(
                        locTypeLoader,
                        modelLoader,
                        locType.id,
                        p.type,
                        p.rotation,
                    );
                    if (info === undefined) {
                        continue;
                    }
                    modelAvailable = 1;
                    modelSignature = info.signature;
                    modelVerticesCount = info.verticesCount;
                    modelFaceCount = info.faceCount;
                    modelTextureFaceCount = info.textureFaceCount;
                    modelHasMayaGroups = info.hasMayaGroups ? 1 : 0;
                }

                const skeletal = tryResolveSkeletalInfo(seqTypeLoader, skeletalSeqLoader, seqId);
                state.locPlacements.push({
                    originalId: p.id,
                    resolvedId: locType.id,
                    level: p.level,
                    tileX: sceneX,
                    tileY: sceneY,
                    type: p.type,
                    rotation: p.rotation,
                    renderKind: isEntity ? 0 : 1,
                    modelAvailable,
                    modelSignature,
                    modelVerticesCount,
                    modelFaceCount,
                    modelTextureFaceCount,
                    modelHasMayaGroups,
                    sequenceId: seqId,
                    animMayaId: skeletal ? skeletal.animMayaId : -1,
                    skeletalBaseId: skeletal ? skeletal.baseId : -1,
                    skeletalPoseId: skeletal ? skeletal.poseId : 0,
                    skeletalCurveCount: skeletal ? skeletal.curveCount : 0,
                    skeletalAvailable: skeletal ? 1 : 0,
                    skeletalHasAlpha: skeletal?.hasAlphaTransform ? 1 : 0,
                    skeletalFrame: skeletal ? skeletal.frame : 0,
                    skeletalFrameHash: skeletal ? skeletal.frameHash : 0,
                });
            }
        }
    }

    finalizeTileMinLevels(state);
    finalizeSummaries(state, underlayTypeLoader);

    let tileLightNonZero = 0;
    for (let i = 0; i < state.tileLightValues.length; i++) {
        if (state.tileLightValues[i] !== 0) tileLightNonZero++;
    }
    return {
        hash: hashSceneState(state),
        legacyHash: hashSceneStateLegacy(state),
        tileModelHash: hashTileModelSection(state),
        tileLightHash: hashTileLightSection(state),
        blendedUnderlayHash: hashBlendedUnderlaySection(state),
        locRenderHash: hashLocRenderSection(state),
        tileLightNonZero,
        tileLightSample: Array.from(state.tileLightValues.slice(0, 16)),
        tileLightProbe: [65, 66, 67, 68, 129, 130, 131, 132].map((i) =>
            i < state.tileLightValues.length ? state.tileLightValues[i] : 0,
        ),
        locCount: state.locPlacements.length,
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const caches = loadCacheInfos();
    const cacheInfo = pickCache(caches, args.cacheName);
    const loaded = loadCache(cacheInfo);
    if (detectCacheType(cacheInfo) !== CacheType.Dat2) {
        throw new Error("scene-square-parity currently supports dat2 caches only");
    }

    const cache = {
        info: loaded.info,
        type: loaded.type,
        bundle: loaded.bundle,
        xteas: new Map(Array.from(loaded.xteas.entries(), ([id, key]) => [id, asXteaKey(key)])),
    };

    const cacheSystem = createCacheSystemFromFiles(cache.type, cache.bundle, new JSCompressionHandler());
    const loadersResult = tryCreateLoaders(cache.info, cacheSystem);
    if (!loadersResult.ok) {
        throw new Error(`Failed to create loaders: ${initErrorToString(loadersResult.error)}`);
    }
    const loaders = loadersResult.value;
    const varManager = new VarManager(loaders.varBitTypeLoader);
    const questTypeLoader = getQuestTypeLoader(loaders);
    if (questTypeLoader) {
        varManager.setQuestsCompleted(questTypeLoader);
    }
    const varProvider = new VarManagerProvider(varManager);
    const mapBytesProvider = new MapFileBytesProvider(loaders.mapFileLoader, cache.xteas);
    const mapsIndex = cacheSystem.getIndex(Dat2IndexId.maps);

    const tsEntries: Array<{
        mapX: number;
        mapY: number;
        hash: number;
        legacyHash: number;
        tileModelHash: number;
        tileLightHash: number;
        blendedUnderlayHash: number;
        locRenderHash: number;
        tileLightNonZero: number;
        tileLightSample: number[];
        tileLightProbe: number[];
        locCount: number;
    }> = [];
    const squares: string[] = [];

    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (tsEntries.length >= args.limit) break outer;
            const archiveId = mapsIndex.tryGetArchiveId(`m${mapX}_${mapY}`);
            if (archiveId === undefined) continue;
            const built = buildTsSceneHashForSquare(
                cacheInfo,
                mapBytesProvider,
                varProvider,
                loaders.locTypeLoader,
                loaders.seqTypeLoader,
                loaders.underlayTypeLoader,
                loaders.modelLoader,
                loaders.skeletalSeqLoader,
                args.locLoadType,
                mapX,
                mapY,
            );
            tsEntries.push({
                mapX,
                mapY,
                hash: built.hash,
                legacyHash: built.legacyHash,
                tileModelHash: built.tileModelHash,
                tileLightHash: built.tileLightHash,
                blendedUnderlayHash: built.blendedUnderlayHash,
                locRenderHash: built.locRenderHash,
                tileLightNonZero: built.tileLightNonZero,
                tileLightSample: built.tileLightSample,
                tileLightProbe: built.tileLightProbe,
                locCount: built.locCount,
            });
            squares.push(`${mapX}_${mapY}`);
        }
    }

    if (tsEntries.length === 0) throw new Error("No scene squares selected");

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "scene_square_hashes",
            "--cache",
            cacheInfo.name,
            "--game",
            String(getGameTypeName(cacheInfo.game)),
            "--revision",
            String(cacheInfo.revision),
            "--locLoadType",
            args.locLoadType,
            "--squares",
            squares.join(","),
        ],
        { encoding: "utf8" },
    );
    if (cpp.status !== 0) {
        throw new Error(`rs_cli failed (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
    }

    const parsed = JSON.parse(cpp.stdout) as {
        entries: Array<{
            mapX: number;
            mapY: number;
            ok: boolean;
            hash?: number;
            legacyHash?: number;
            tileModelHash?: number;
            tileLightHash?: number;
            blendedUnderlayHash?: number;
            locRenderHash?: number;
            tileLightNonZero?: number;
            tileLightSample?: number[];
            tileLightProbe?: number[];
            locCount?: number;
            status?: string;
        }>;
    };
    const cppByKey = new Map<
        string,
        {
            ok: boolean;
            hash?: number;
            legacyHash?: number;
            tileModelHash?: number;
            tileLightHash?: number;
            blendedUnderlayHash?: number;
            locRenderHash?: number;
            tileLightNonZero?: number;
            tileLightSample?: number[];
            tileLightProbe?: number[];
            locCount?: number;
            status?: string;
        }
    >();
    for (const e of parsed.entries) cppByKey.set(`${e.mapX}_${e.mapY}`, e);

    let mismatches = 0;
    for (const ts of tsEntries) {
        const key = `${ts.mapX}_${ts.mapY}`;
        const c = cppByKey.get(key);
        if (!c) throw new Error(`Missing C++ entry for ${key}`);
        if (!c.ok) throw new Error(`C++ failed for ${key}: ${c.status ?? "?"}`);
        if (c.hash !== ts.hash) {
            mismatches++;
            console.error(
                `hash mismatch ${key}: ts=${ts.hash} cpp=${c.hash} ` +
                    `(legacy ts=${ts.legacyHash} cpp=${c.legacyHash}) ` +
                    `(tileModel ts=${ts.tileModelHash} cpp=${c.tileModelHash}) ` +
                    `(tileLight ts=${ts.tileLightHash} cpp=${c.tileLightHash}) ` +
                    `(blend ts=${ts.blendedUnderlayHash} cpp=${c.blendedUnderlayHash}) ` +
                    `(locRender ts=${ts.locRenderHash} cpp=${c.locRenderHash}) ` +
                    `(tileLightNonZero ts=${ts.tileLightNonZero} cpp=${c.tileLightNonZero})`,
            );
            console.error(
                `tileLightSample ${key}: ts=${JSON.stringify(ts.tileLightSample)} cpp=${JSON.stringify(c.tileLightSample ?? [])}`,
            );
            console.error(
                `tileLightProbe ${key}: ts=${JSON.stringify(ts.tileLightProbe)} cpp=${JSON.stringify(c.tileLightProbe ?? [])}`,
            );
        } else if ((c.locCount ?? -1) !== ts.locCount) {
            mismatches++;
            console.error(`locCount mismatch ${key}: ts=${ts.locCount} cpp=${c.locCount}`);
        }
    }

    console.log(
        `scene-square-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} locLoadType=${args.locLoadType} squares=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
