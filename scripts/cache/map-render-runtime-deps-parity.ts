import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ObjSpawn } from "../../src/data/obj/ObjSpawn";
import { SdMapLoaderInput } from "../../src/renderer/loader/SdMapLoaderInput";
import { CacheInfo, GameType, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { decodeLocPlacementsFromBytes } from "../../src/rs/scene/decodeLocPlacements";
import {
    TerrainSquareDecodeScratch,
    decodeTerrainSquareFromBytesInto,
} from "../../src/rs/scene/decodeTerrainSquare";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { tryCreateCacheSession } from "../../src/rs/runtime/createCacheSession";
import type {
    MapRenderRuntimeDebugBridgeV2,
    MapRenderRuntimeRequiredTypeIds,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import { createByteDrivenSceneBuildInput } from "../../src/worker/MapRenderDataBackend";
import { loadCache, loadCacheInfos } from "./load-util";

type Square = Readonly<{ mapX: number; mapY: number }>;

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    squares?: ReadonlyArray<Square>;
    detail: boolean;
}>;

type TypeIdsByKind = Readonly<{
    locTypeIds: number[];
    objTypeIds: number[];
    npcTypeIds: number[];
    varbitTypeIds: number[];
    modelIds: number[];
    seqTypeIds: number[];
    basTypeIds: number[];
    underlayTypeIds: number[];
    overlayTypeIds: number[];
}>;

type TsRequiredTypeIds = Readonly<{
    primary: TypeIdsByKind;
    expanded: TypeIdsByKind;
}>;

type RuntimeDebugBridge = MapRenderRuntimeDebugBridgeV2 &
    Readonly<{
        createRuntime?: () => Promise<number | undefined>;
    }>;

type RuntimeHandleBridge = Readonly<{
    bridge: RuntimeDebugBridge;
    runtimeHandle: number;
}>;

const MAP_SQUARE_SIZE = 64;
const MAX_LEVELS = 4;
const MAX_OBJ_TRANSFORM_CHAIN = 16;
const MAX_NPC_TRANSFORM_CHAIN = 16;
const MAX_LOC_TRANSFORM_CHAIN = 4096;

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let limit = 4;
    let squares: Square[] | undefined;
    let detail = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
        } else if (arg === "--detail") {
            detail = true;
        } else if (arg === "--squares") {
            const raw = argv[++i] ?? "";
            const parsed: Square[] = [];
            const tokens = raw
                .split(/[;,]/)
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
            for (let t = 0; t < tokens.length; t++) {
                const parts = tokens[t].split(":");
                if (parts.length !== 2) {
                    throw new Error("Invalid --squares format; expected mapX:mapY[,mapX:mapY]");
                }
                const mapX = Number(parts[0]);
                const mapY = Number(parts[1]);
                if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
                    throw new Error("Invalid --squares value");
                }
                parsed.push({ mapX: mapX | 0, mapY: mapY | 0 });
            }
            squares = parsed;
        }
    }
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Invalid --limit");
    }
    return {
        cacheName,
        limit: limit | 0,
        squares,
        detail,
    };
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("No caches found");
    }
    if (!cacheName) {
        return latest;
    }
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function pickSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    limit: number,
): Square[] {
    const out: Square[] = [];
    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            out.push({ mapX, mapY });
            if (out.length >= limit) {
                break outer;
            }
        }
    }
    return out;
}

function sortedUnique(values: Iterable<number>): number[] {
    const out = Array.from(new Set(Array.from(values, (v) => v | 0)));
    out.sort((a, b) => a - b);
    return out;
}

function floorDiv(num: number, den: number): number {
    return Math.floor(num / den);
}

function ceilDiv(num: number, den: number): number {
    return Math.ceil(num / den);
}

function computeMapBounds(baseX: number, baseY: number, sizeX: number, sizeY: number) {
    return {
        mapStartX: floorDiv(baseX, MAP_SQUARE_SIZE),
        mapStartY: floorDiv(baseY, MAP_SQUARE_SIZE),
        mapEndX: ceilDiv(baseX + sizeX, MAP_SQUARE_SIZE),
        mapEndY: ceilDiv(baseY + sizeY, MAP_SQUARE_SIZE),
    };
}

function tryLoadType<T>(loader: unknown, id: number): T | undefined {
    const typedLoader = loader as { tryLoad?: (id: number) => { ok: boolean; value?: T } } | undefined;
    if (!typedLoader || typeof typedLoader.tryLoad !== "function" || id < 0) {
        return undefined;
    }
    try {
        const result = typedLoader.tryLoad(id | 0);
        if (result?.ok) {
            return result.value;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function tryGetVarbitLoader(varProvider: unknown): unknown {
    const provider = varProvider as
        | {
              varManager?: { varbitLoader?: unknown };
              varbitLoader?: unknown;
          }
        | undefined;
    const fromManager = provider?.varManager?.varbitLoader as
        | { tryLoad?: (id: number) => unknown }
        | undefined;
    if (fromManager && typeof fromManager.tryLoad === "function") {
        return fromManager;
    }
    const direct = provider?.varbitLoader as { tryLoad?: (id: number) => unknown } | undefined;
    if (direct && typeof direct.tryLoad === "function") {
        return direct;
    }
    return undefined;
}

function snapshotVarps(sceneBuildInput: Record<string, unknown>): Int32Array {
    if (sceneBuildInput.varpValues instanceof Int32Array) {
        return sceneBuildInput.varpValues;
    }
    const managerValues = (sceneBuildInput.varProvider as { varManager?: { values?: Int32Array } })?.varManager
        ?.values;
    if (managerValues instanceof Int32Array) {
        return managerValues;
    }
    return new Int32Array(0);
}

function getVarpValue(varps: Int32Array, varpId: number): number {
    if (varpId < 0 || varpId >= varps.length) {
        return 0;
    }
    return varps[varpId] | 0;
}

function getVarbitValue(varbitLoader: unknown, varps: Int32Array, varbitId: number): number {
    const varbit = tryLoadType<{ baseVar: number; startBit: number; endBit: number }>(
        varbitLoader,
        varbitId,
    );
    if (!varbit) {
        return 0;
    }
    const bitCount = (varbit.endBit | 0) - (varbit.startBit | 0) + 1;
    if (bitCount <= 0 || bitCount > 31) {
        return 0;
    }
    const mask = bitCount === 31 ? 0x7fffffff : (1 << bitCount) - 1;
    return ((getVarpValue(varps, varbit.baseVar | 0) >>> (varbit.startBit | 0)) & mask) | 0;
}

function appendNpcSeqIds(npcType: Record<string, unknown>, outSeqTypeIds: Set<number>): void {
    const seqIds = [
        npcType.idleSeqId,
        npcType.turnLeftSeqId,
        npcType.turnRightSeqId,
        npcType.walkSeqId,
        npcType.walkBackSeqId,
        npcType.walkLeftSeqId,
        npcType.walkRightSeqId,
        npcType.runSeqId,
        npcType.runBackSeqId,
        npcType.runLeftSeqId,
        npcType.runRightSeqId,
        npcType.crawlSeqId,
        npcType.crawlBackSeqId,
        npcType.crawlLeftSeqId,
        npcType.crawlRightSeqId,
    ];
    for (let i = 0; i < seqIds.length; i++) {
        const seqId = (seqIds[i] as number) | 0;
        if (seqId >= 0) {
            outSeqTypeIds.add(seqId);
        }
    }
}

function computeTsRequiredTypeIds(sceneBuildInput: Record<string, unknown>): TsRequiredTypeIds {
    const baseX = (sceneBuildInput.baseX as number) | 0;
    const baseY = (sceneBuildInput.baseY as number) | 0;
    const sizeX = (sceneBuildInput.sizeX as number) | 0;
    const sizeY = (sceneBuildInput.sizeY as number) | 0;
    if (sizeX <= 0 || sizeY <= 0) {
        throw new Error("invalid scene build input bounds");
    }
    const mapBytesProvider = sceneBuildInput.mapBytesProvider as
        | {
              getTerrainBytes(mapX: number, mapY: number): Uint8Array | undefined;
              getLocBytes(mapX: number, mapY: number): Uint8Array | undefined;
              getNpcSpawnBytes?(mapX: number, mapY: number): Uint8Array | undefined;
          }
        | undefined;
    if (!mapBytesProvider) {
        throw new Error("scene build input missing mapBytesProvider");
    }
    const loadLocs = sceneBuildInput.loadLocs !== false;
    const loadObjs = sceneBuildInput.loadObjs === true;
    const loadNpcs = sceneBuildInput.loadNpcs === true;
    const maxLevel = (sceneBuildInput.maxLevel as number) | 0;
    const mapXCenter = (sceneBuildInput.mapX as number) | 0;
    const mapYCenter = (sceneBuildInput.mapY as number) | 0;
    const cacheGame = (sceneBuildInput.cacheGame as number) | 0;
    const cacheRevision = (sceneBuildInput.cacheRevision as number) | 0;

    const locTypeLoader = sceneBuildInput.locTypeLoader;
    const objTypeLoader = sceneBuildInput.objTypeLoader;
    const npcTypeLoader = sceneBuildInput.npcTypeLoader;
    const varbitLoader = tryGetVarbitLoader(sceneBuildInput.varProvider);
    const varps = snapshotVarps(sceneBuildInput);

    const bounds = computeMapBounds(baseX, baseY, sizeX, sizeY);
    const locTypeIds = new Set<number>();
    const objTypeIds = new Set<number>();
    const npcTypeIds = new Set<number>();
    const varbitTypeIds = new Set<number>();
    const modelIds = new Set<number>();
    const seqTypeIds = new Set<number>();
    const basTypeIds = new Set<number>();
    const underlayTypeIds = new Set<number>();
    const overlayTypeIds = new Set<number>();

    const newTerrainFormat = cacheGame === GameType.Oldschool && cacheRevision >= 209;
    const terrainScratch = new TerrainSquareDecodeScratch(MAX_LEVELS, MAP_SQUARE_SIZE);

    for (let mapX = bounds.mapStartX; mapX < bounds.mapEndX; mapX++) {
        for (let mapY = bounds.mapStartY; mapY < bounds.mapEndY; mapY++) {
            const terrainBytes = mapBytesProvider.getTerrainBytes(mapX, mapY);
            if (terrainBytes && terrainBytes.length > 0) {
                decodeTerrainSquareFromBytesInto(
                    terrainScratch,
                    terrainBytes,
                    newTerrainFormat,
                    mapX * MAP_SQUARE_SIZE,
                    mapY * MAP_SQUARE_SIZE,
                );
                const worldTileX0 = mapX * MAP_SQUARE_SIZE;
                const worldTileY0 = mapY * MAP_SQUARE_SIZE;
                for (let level = 0; level < MAX_LEVELS; level++) {
                    for (let tileX = 0; tileX < MAP_SQUARE_SIZE; tileX++) {
                        const worldX = worldTileX0 + tileX;
                        if (worldX < baseX || worldX >= baseX + sizeX) {
                            continue;
                        }
                        for (let tileY = 0; tileY < MAP_SQUARE_SIZE; tileY++) {
                            const worldY = worldTileY0 + tileY;
                            if (worldY < baseY || worldY >= baseY + sizeY) {
                                continue;
                            }
                            const underlayRaw = terrainScratch.tileUnderlays[level][tileX][tileY] | 0;
                            if (underlayRaw > 0) {
                                underlayTypeIds.add((underlayRaw - 1) | 0);
                            }
                            const overlayRaw = terrainScratch.tileOverlays[level][tileX][tileY] | 0;
                            if (overlayRaw > 0) {
                                overlayTypeIds.add((overlayRaw - 1) | 0);
                            }
                        }
                    }
                }
            }

            if (loadLocs) {
                const locBytes = mapBytesProvider.getLocBytes(mapX, mapY);
                if (locBytes && locBytes.length > 0) {
                    const placements = decodeLocPlacementsFromBytes(locBytes);
                    for (let i = 0; i < placements.length; i++) {
                        const id = placements[i].id | 0;
                        if (id >= 0) {
                            locTypeIds.add(id);
                        }
                    }
                }
            }

            if (loadNpcs && typeof mapBytesProvider.getNpcSpawnBytes === "function") {
                const npcBytes = mapBytesProvider.getNpcSpawnBytes(mapX, mapY);
                if (npcBytes && npcBytes.length >= 4) {
                    const count = Math.floor(npcBytes.length / 4) | 0;
                    for (let i = 0; i < count; i++) {
                        const off = i * 4;
                        const npcId = (((npcBytes[off + 2] | 0) << 8) | (npcBytes[off + 3] | 0)) & 0xffff;
                        if (npcId >= 0) {
                            npcTypeIds.add(npcId);
                        }
                    }
                }
            }
        }
    }

    const selectedObjSpawns: ObjSpawn[] = [];
    if (loadObjs) {
        const objSpawns = (Array.isArray(sceneBuildInput.objSpawns)
            ? sceneBuildInput.objSpawns
            : []) as ObjSpawn[];
        for (let i = 0; i < objSpawns.length; i++) {
            const spawn = objSpawns[i];
            if (!spawn || (spawn.plane | 0) > maxLevel) {
                continue;
            }
            const spawnMapX = floorDiv(spawn.x | 0, MAP_SQUARE_SIZE);
            const spawnMapY = floorDiv(spawn.y | 0, MAP_SQUARE_SIZE);
            if (spawnMapX !== mapXCenter || spawnMapY !== mapYCenter) {
                continue;
            }
            const baseObjType = tryLoadType<Record<string, unknown>>(objTypeLoader, spawn.id | 0);
            if (!baseObjType) {
                continue;
            }
            if (String(baseObjType.name ?? "null").toLowerCase() === "null") {
                continue;
            }
            selectedObjSpawns.push(spawn);
            objTypeIds.add(spawn.id | 0);
        }
    }

    const primary: TypeIdsByKind = {
        locTypeIds: sortedUnique(locTypeIds),
        objTypeIds: sortedUnique(objTypeIds),
        npcTypeIds: sortedUnique(npcTypeIds),
        varbitTypeIds: [],
        modelIds: [],
        seqTypeIds: [],
        basTypeIds: [],
        underlayTypeIds: [],
        overlayTypeIds: [],
    };

    if (loadObjs) {
        for (let i = 0; i < selectedObjSpawns.length; i++) {
            const spawn = selectedObjSpawns[i];
            let currentObjId = spawn.id | 0;
            let currentObjCount = spawn.count | 0;
            for (let depth = 0; depth < MAX_OBJ_TRANSFORM_CHAIN; depth++) {
                if (currentObjId < 0) {
                    break;
                }
                objTypeIds.add(currentObjId);
                const objType = tryLoadType<Record<string, unknown>>(objTypeLoader, currentObjId);
                if (!objType) {
                    break;
                }
                if (depth === 0 && String(objType.name ?? "null").toLowerCase() === "null") {
                    break;
                }
                const modelId = (objType.model as number) | 0;
                if (modelId >= 0) {
                    modelIds.add(modelId);
                }
                let nextObjId = -1;
                const countObj = Array.isArray(objType.countObj) ? objType.countObj : [];
                const countCo = Array.isArray(objType.countCo) ? objType.countCo : [];
                if (currentObjCount > 1 && countObj.length > 0 && countCo.length > 0) {
                    const n = Math.min(10, countObj.length, countCo.length);
                    for (let j = 0; j < n; j++) {
                        const threshold = (countCo[j] as number) | 0;
                        if (threshold !== 0 && currentObjCount >= threshold) {
                            nextObjId = (countObj[j] as number) | 0;
                        }
                    }
                }
                if (nextObjId < 0 || nextObjId === currentObjId) {
                    break;
                }
                currentObjId = nextObjId;
                currentObjCount = 1;
            }
        }
    }

    if (loadLocs) {
        const locQueue = Array.from(locTypeIds);
        let locQueueIndex = 0;
        let guard = 0;
        while (locQueueIndex < locQueue.length) {
            if (++guard > MAX_LOC_TRANSFORM_CHAIN) {
                break;
            }
            const locTypeId = locQueue[locQueueIndex++] | 0;
            if (locTypeId < 0) {
                continue;
            }
            const locType = tryLoadType<Record<string, unknown>>(locTypeLoader, locTypeId);
            if (!locType) {
                continue;
            }
            const transformVarbit = (locType.transformVarbit as number) | 0;
            const transformVarp = (locType.transformVarp as number) | 0;
            if (transformVarbit >= 0) {
                varbitTypeIds.add(transformVarbit);
            }
            const transformIndex =
                transformVarbit >= 0
                    ? getVarbitValue(varbitLoader, varps, transformVarbit)
                    : transformVarp >= 0
                      ? getVarpValue(varps, transformVarp)
                      : -1;
            const transforms = Array.isArray(locType.transforms) ? locType.transforms : [];
            let resolvedTransformId = -1;
            if (transforms.length > 0) {
                const last = (transforms[transforms.length - 1] as number) | 0;
                if (
                    transformIndex >= 0 &&
                    transformIndex < transforms.length - 1 &&
                    ((transforms[transformIndex] as number) | 0) !== -1
                ) {
                    resolvedTransformId = (transforms[transformIndex] as number) | 0;
                } else {
                    resolvedTransformId = last;
                }
            }
            if (resolvedTransformId >= 0 && !locTypeIds.has(resolvedTransformId)) {
                locTypeIds.add(resolvedTransformId);
                locQueue.push(resolvedTransformId);
            }
            for (let i = 0; i < transforms.length; i++) {
                const transformId = (transforms[i] as number) | 0;
                if (transformId >= 0 && !locTypeIds.has(transformId)) {
                    locTypeIds.add(transformId);
                    locQueue.push(transformId);
                }
            }
            const models = Array.isArray(locType.models) ? locType.models : [];
            for (let g = 0; g < models.length; g++) {
                const group = Array.isArray(models[g]) ? (models[g] as number[]) : [];
                for (let j = 0; j < group.length; j++) {
                    const modelId = group[j] | 0;
                    if (modelId >= 0) {
                        modelIds.add(modelId);
                    }
                }
            }
            const seqId = (locType.seqId as number) | 0;
            if (seqId >= 0) {
                seqTypeIds.add(seqId);
            }
            const randomSeqIds = Array.isArray(locType.randomSeqIds) ? locType.randomSeqIds : [];
            for (let i = 0; i < randomSeqIds.length; i++) {
                const randomSeqId = (randomSeqIds[i] as number) | 0;
                if (randomSeqId >= 0) {
                    seqTypeIds.add(randomSeqId);
                }
            }
        }
    }

    if (loadNpcs) {
        const npcQueue = Array.from(npcTypeIds);
        let npcQueueIndex = 0;
        let guard = 0;
        while (npcQueueIndex < npcQueue.length) {
            if (++guard > MAX_NPC_TRANSFORM_CHAIN * 4096) {
                break;
            }
            const npcTypeId = npcQueue[npcQueueIndex++] | 0;
            if (npcTypeId < 0) {
                continue;
            }
            const npcType = tryLoadType<Record<string, unknown>>(npcTypeLoader, npcTypeId);
            if (!npcType) {
                continue;
            }
            const transformVarbit = (npcType.transformVarbit as number) | 0;
            const transformVarp = (npcType.transformVarp as number) | 0;
            if (transformVarbit >= 0) {
                varbitTypeIds.add(transformVarbit);
            }
            const basTypeId = (npcType.basTypeId as number) | 0;
            if (basTypeId >= 0) {
                basTypeIds.add(basTypeId);
            }
            const npcModelIds = Array.isArray(npcType.modelIds) ? npcType.modelIds : [];
            for (let i = 0; i < npcModelIds.length; i++) {
                const modelId = (npcModelIds[i] as number) | 0;
                if (modelId >= 0) {
                    modelIds.add(modelId);
                }
            }
            appendNpcSeqIds(npcType, seqTypeIds);

            const transformIndex =
                transformVarbit >= 0
                    ? getVarbitValue(varbitLoader, varps, transformVarbit)
                    : transformVarp >= 0
                      ? getVarpValue(varps, transformVarp)
                      : -1;
            const transforms = Array.isArray(npcType.transforms) ? npcType.transforms : [];
            let resolvedTransformId = -1;
            if (transforms.length > 0) {
                resolvedTransformId = (transforms[transforms.length - 1] as number) | 0;
                if (transformIndex >= 0 && transformIndex < transforms.length - 1) {
                    const candidate = (transforms[transformIndex] as number) | 0;
                    if (candidate !== -1) {
                        resolvedTransformId = candidate;
                    }
                }
            }
            if (resolvedTransformId >= 0 && !npcTypeIds.has(resolvedTransformId)) {
                npcTypeIds.add(resolvedTransformId);
                npcQueue.push(resolvedTransformId);
            }
            for (let i = 0; i < transforms.length; i++) {
                const transformId = (transforms[i] as number) | 0;
                if (transformId >= 0 && !npcTypeIds.has(transformId)) {
                    npcTypeIds.add(transformId);
                    npcQueue.push(transformId);
                }
            }
        }
    }

    const expanded: TypeIdsByKind = {
        locTypeIds: sortedUnique(locTypeIds),
        objTypeIds: sortedUnique(objTypeIds),
        npcTypeIds: sortedUnique(npcTypeIds),
        varbitTypeIds: sortedUnique(varbitTypeIds),
        modelIds: sortedUnique(modelIds),
        seqTypeIds: sortedUnique(seqTypeIds),
        basTypeIds: sortedUnique(basTypeIds),
        underlayTypeIds: sortedUnique(underlayTypeIds),
        overlayTypeIds: sortedUnique(overlayTypeIds),
    };
    return { primary, expanded };
}

function diffSortedIds(expected: number[], actual: number[]) {
    const missingInCpp: number[] = [];
    const extraInCpp: number[] = [];
    let i = 0;
    let j = 0;
    while (i < expected.length && j < actual.length) {
        const a = expected[i] | 0;
        const b = actual[j] | 0;
        if (a === b) {
            i++;
            j++;
        } else if (a < b) {
            missingInCpp.push(a);
            i++;
        } else {
            extraInCpp.push(b);
            j++;
        }
    }
    while (i < expected.length) {
        missingInCpp.push(expected[i++] | 0);
    }
    while (j < actual.length) {
        extraInCpp.push(actual[j++] | 0);
    }
    return { missingInCpp, extraInCpp };
}

function asKinds(ids: MapRenderRuntimeRequiredTypeIds | undefined): TypeIdsByKind | undefined {
    if (!ids) {
        return undefined;
    }
    return {
        locTypeIds: sortedUnique(ids.locTypeIds ?? []),
        objTypeIds: sortedUnique(ids.objTypeIds ?? []),
        npcTypeIds: sortedUnique(ids.npcTypeIds ?? []),
        varbitTypeIds: sortedUnique(ids.varbitTypeIds ?? []),
        modelIds: sortedUnique(ids.modelIds ?? []),
        seqTypeIds: sortedUnique(ids.seqTypeIds ?? []),
        basTypeIds: sortedUnique(ids.basTypeIds ?? []),
        underlayTypeIds: sortedUnique(ids.underlayTypeIds ?? []),
        overlayTypeIds: sortedUnique(ids.overlayTypeIds ?? []),
    };
}

function compareKinds(
    label: string,
    expected: TypeIdsByKind,
    actual: TypeIdsByKind,
    detail: boolean,
): { ok: boolean; lines: string[] } {
    const kinds: Array<keyof TypeIdsByKind> = [
        "locTypeIds",
        "objTypeIds",
        "npcTypeIds",
        "varbitTypeIds",
        "modelIds",
        "seqTypeIds",
        "basTypeIds",
        "underlayTypeIds",
        "overlayTypeIds",
    ];
    const lines: string[] = [];
    let ok = true;
    for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const diff = diffSortedIds(expected[kind], actual[kind]);
        if (diff.missingInCpp.length > 0 || diff.extraInCpp.length > 0) {
            ok = false;
            lines.push(
                `${label}.${kind}: ts=${expected[kind].length} cpp=${actual[kind].length} missing=${diff.missingInCpp.length} extra=${diff.extraInCpp.length}`,
            );
            if (detail) {
                if (diff.missingInCpp.length > 0) {
                    lines.push(
                        `  missing sample: ${diff.missingInCpp.slice(0, 20).join(",")}`,
                    );
                }
                if (diff.extraInCpp.length > 0) {
                    lines.push(`  extra sample: ${diff.extraInCpp.slice(0, 20).join(",")}`);
                }
            }
        }
    }
    return { ok, lines };
}

async function loadRuntimeDebugBridge(
    cacheGame: number,
    cacheRevision: number,
): Promise<RuntimeHandleBridge> {
    const bridgeUrl = pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_runtime.mjs"),
    ).href;
    const mod = (await import(bridgeUrl)) as Record<string, unknown>;
    const runtimeCandidate = mod.mapRenderRuntimeDebugBridge as RuntimeDebugBridge | undefined;
    if (
        !runtimeCandidate ||
        typeof runtimeCandidate.initRuntime !== "function" ||
        (typeof runtimeCandidate.createRuntimeWithConfig !== "function" &&
            typeof runtimeCandidate.createRuntime !== "function") ||
        typeof runtimeCandidate.debugCollectRequiredPrimaryTypeIds !== "function" ||
        typeof runtimeCandidate.debugCollectRequiredExpandedTypeIds !== "function"
    ) {
        throw new Error("Failed to load runtime debug bridge with dependency collection methods");
    }
    const ready = await runtimeCandidate.initRuntime();
    if (!ready) {
        throw new Error("Failed to init runtime debug bridge");
    }
    const runtimeHandle =
        typeof runtimeCandidate.createRuntimeWithConfig === "function"
            ? await runtimeCandidate.createRuntimeWithConfig({
                  cacheGame: cacheGame | 0,
                  cacheRevision: cacheRevision | 0,
                  sceneLevels: 4,
                  unitsTileHeightBasis: 8,
              })
            : await runtimeCandidate.createRuntime!();
    if (runtimeHandle === undefined) {
        throw new Error("Failed to create runtime");
    }
    return { bridge: runtimeCandidate, runtimeHandle };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const cacheInfos = loadCacheInfos();
    const cacheInfo = pickCache(cacheInfos, args.cacheName);
    const loadedCache = loadCache(cacheInfo);
    const sessionResult = tryCreateCacheSession(loadedCache as any, new JSCompressionHandler());
    if (!sessionResult.ok) {
        throw new Error(`Failed to create session for ${cacheInfo.name}`);
    }
    const session = sessionResult.value;
    const loaders = session.loaders;
    const varProvider = new VarManagerProvider(session.varManager);
    const mapBytesProvider = new MapFileBytesProvider(
        loaders.mapFileLoader,
        loadedCache.xteas as any,
    );
    const objSpawns: ObjSpawn[] = [];

    const bridgeState = await loadRuntimeDebugBridge(cacheInfo.game, cacheInfo.revision);
    const { bridge, runtimeHandle } = bridgeState;

    const squares =
        args.squares && args.squares.length > 0
            ? [...args.squares]
            : pickSquares(loaders.mapFileLoader.mapFileIndex, args.limit);
    if (squares.length === 0) {
        throw new Error("No map squares found for dependency parity");
    }

    let mismatches = 0;
    for (let i = 0; i < squares.length; i++) {
        const square = squares[i];
        const input: SdMapLoaderInput = {
            mapX: square.mapX,
            mapY: square.mapY,
            maxLevel: 3,
            loadObjs: true,
            loadNpcs: true,
            loadLocs: true,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Set<number>(),
        };
        const sceneBuildInput = createByteDrivenSceneBuildInput(input, {
            mapBytesProvider,
            locTypeLoader: loaders.locTypeLoader,
            objTypeLoader: loaders.objTypeLoader,
            locModelLoader: {
                modelLoader: loaders.modelLoader,
                textureLoader: loaders.textureLoader,
                seqTypeLoader: loaders.seqTypeLoader,
                seqFrameLoader: loaders.seqFrameLoader,
                skeletalSeqLoader: session.getSkeletalSeqLoader(),
            },
            npcTypeLoader: loaders.npcTypeLoader,
            basTypeLoader: loaders.basTypeLoader,
            varProvider,
            underlayTypeLoader: loaders.underlayTypeLoader,
            overlayTypeLoader: loaders.overlayTypeLoader,
            objSpawns,
            cacheGame: cacheInfo.game,
            cacheRevision: cacheInfo.revision,
        }) as Record<string, unknown>;

        const expected = computeTsRequiredTypeIds(sceneBuildInput);
        const cppPrimaryRaw = await bridge.debugCollectRequiredPrimaryTypeIds?.(
            runtimeHandle,
            sceneBuildInput,
        );
        const cppExpandedRaw = await bridge.debugCollectRequiredExpandedTypeIds?.(
            runtimeHandle,
            sceneBuildInput,
        );
        const cppPrimary = asKinds(cppPrimaryRaw);
        const cppExpanded = asKinds(cppExpandedRaw);
        if (!cppPrimary || !cppExpanded) {
            mismatches++;
            console.error(
                `[deps-parity] ${square.mapX},${square.mapY}: runtime dependency collection unavailable`,
            );
            continue;
        }

        const primaryCmp = compareKinds("primary", expected.primary, cppPrimary, args.detail);
        const expandedCmp = compareKinds("expanded", expected.expanded, cppExpanded, args.detail);
        if (!primaryCmp.ok || !expandedCmp.ok) {
            mismatches++;
            console.error(`[deps-parity] mismatch at ${square.mapX},${square.mapY}`);
            const lines = [...primaryCmp.lines, ...expandedCmp.lines];
            for (let j = 0; j < lines.length; j++) {
                console.error(`  ${lines[j]}`);
            }
            if (args.detail && cppExpandedRaw?.typeIdsByKind instanceof Map) {
                const kindSummary = Array.from(cppExpandedRaw.typeIdsByKind.entries()).map(
                    ([kind, ids]) => `${kind}:${Array.isArray(ids) ? ids.length : 0}`,
                );
                console.error(`  cpp kind sizes: ${kindSummary.join(" ")}`);
            }
        } else {
            console.log(`[deps-parity] ok ${square.mapX},${square.mapY}`);
        }
    }

    bridge.destroyRuntime(runtimeHandle);
    console.log(
        `map-render-runtime-deps-parity: cache=${cacheInfo.name} squares=${squares.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
