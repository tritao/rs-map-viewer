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
import { LocTypeLoader } from "../../src/rs/config/loctype/LocTypeLoader";
import { VarManager } from "../../src/rs/config/vartype/VarManager";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { getQuestTypeLoader } from "../../src/rs/loaders/Loaders";
import { tryCreateLoaders } from "../../src/rs/loaders/createLoaders";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { MapBytesProvider, MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import {
    TerrainSquareDecodeScratch,
    decodeTerrainSquareFromBytesInto,
} from "../../src/rs/scene/decodeTerrainSquare";
import { decodeLocPlacementsFromBytes } from "../../src/rs/scene/decodeLocPlacements";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = { cacheName?: string; limit: number };

type TsSceneLocPlacement = {
    originalId: number;
    resolvedId: number;
    level: number;
    tileX: number;
    tileY: number;
    type: number;
    rotation: number;
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
    locPlacements: TsSceneLocPlacement[];
};

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 30 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--limit") args.limit = Number(argv[++i]);
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

function buildTsSceneHashForSquare(
    cacheInfo: CacheInfo,
    mapBytesProvider: MapBytesProvider,
    varProvider: VarManagerProvider,
    locTypeLoader: LocTypeLoader,
    mapX: number,
    mapY: number,
): { hash: number; locCount: number } {
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
                state.locPlacements.push({
                    originalId: p.id,
                    resolvedId: locType.id,
                    level: p.level,
                    tileX: sceneX,
                    tileY: sceneY,
                    type: p.type,
                    rotation: p.rotation,
                });
            }
        }
    }

    finalizeTileMinLevels(state);

    return { hash: hashSceneState(state), locCount: state.locPlacements.length };
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

    const tsEntries: Array<{ mapX: number; mapY: number; hash: number; locCount: number }> = [];
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
                mapX,
                mapY,
            );
            tsEntries.push({ mapX, mapY, hash: built.hash, locCount: built.locCount });
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
            locCount?: number;
            status?: string;
        }>;
    };
    const cppByKey = new Map<string, { ok: boolean; hash?: number; locCount?: number; status?: string }>();
    for (const e of parsed.entries) cppByKey.set(`${e.mapX}_${e.mapY}`, e);

    let mismatches = 0;
    for (const ts of tsEntries) {
        const key = `${ts.mapX}_${ts.mapY}`;
        const c = cppByKey.get(key);
        if (!c) throw new Error(`Missing C++ entry for ${key}`);
        if (!c.ok) throw new Error(`C++ failed for ${key}: ${c.status ?? "?"}`);
        if (c.hash !== ts.hash) {
            mismatches++;
            console.error(`hash mismatch ${key}: ts=${ts.hash} cpp=${c.hash}`);
        } else if ((c.locCount ?? -1) !== ts.locCount) {
            mismatches++;
            console.error(`locCount mismatch ${key}: ts=${ts.locCount} cpp=${c.locCount}`);
        }
    }

    console.log(
        `scene-square-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} squares=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
