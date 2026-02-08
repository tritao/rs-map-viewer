import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { XteaKey, asXteaKey } from "../../src/rs/crypto/Xtea";
import { decodeLocPlacementsFromBytes } from "../../src/rs/scene/decodeLocPlacements";
import { decodeNpcSpawnsFromBytes } from "../../src/rs/scene/decodeNpcSpawns";
import {
    TerrainSquareDecodeScratch,
    decodeTerrainSquareFromBytesInto,
} from "../../src/rs/scene/decodeTerrainSquare";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Args = { cacheName?: string; limit: number };

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

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function isNewTerrainFormat(cacheInfo: CacheInfo): boolean {
    // Mirrors `SceneBuilder` rule.
    return cacheInfo.game === 2 /* Oldschool */ && cacheInfo.revision >= 209;
}

function loadKeysMap(cacheName: string): Map<number, XteaKey> {
    const p = path.join("caches", cacheName, "keys.json");
    if (!fs.existsSync(p)) return new Map();
    const json = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, number[]>;
    const out = new Map<number, XteaKey>();
    for (const [k, v] of Object.entries(json)) {
        const id = Number(k);
        if (!Number.isFinite(id)) continue;
        out.set(id, asXteaKey(v));
    }
    return out;
}

function hashTerrainInputs(scratch: TerrainSquareDecodeScratch): number {
    let h = 2166136261 >>> 0;

    // Section tags (reduce accidental collisions).
    h = fnv1a32UpdateInt(h, 0x54455252); // 'TERR'
    for (let level = 0; level < scratch.tileHeights.length; level++) {
        const grid = scratch.tileHeights[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }

    h = fnv1a32UpdateInt(h, 0x464c4147); // 'FLAG'
    for (let level = 0; level < scratch.tileRenderFlags.length; level++) {
        const grid = scratch.tileRenderFlags[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }

    h = fnv1a32UpdateInt(h, 0x554e444c); // 'UNDL'
    for (let level = 0; level < scratch.tileUnderlays.length; level++) {
        const grid = scratch.tileUnderlays[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }

    h = fnv1a32UpdateInt(h, 0x4f564552); // 'OVER'
    for (let level = 0; level < scratch.tileOverlays.length; level++) {
        const grid = scratch.tileOverlays[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }

    h = fnv1a32UpdateInt(h, 0x53484150); // 'SHAP'
    for (let level = 0; level < scratch.tileShapes.length; level++) {
        const grid = scratch.tileShapes[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }

    h = fnv1a32UpdateInt(h, 0x524f5441); // 'ROTA'
    for (let level = 0; level < scratch.tileRotations.length; level++) {
        const grid = scratch.tileRotations[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }

    return h >>> 0;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const caches = loadCacheInfos();
    const cacheInfo = pickCache(caches, args.cacheName);
    const cacheType = detectCacheType(cacheInfo);
    if (cacheType !== CacheType.Dat2)
        throw new Error(`Only dat2 caches are supported (got ${cacheType})`);

    const bundle = loadCacheFiles(cacheInfo);
    const cacheSystem = createCacheSystemFromFiles(cacheType, bundle, new JSCompressionHandler());
    const mapsIndex = cacheSystem.getIndex(Dat2IndexId.maps);

    const newFormat = isNewTerrainFormat(cacheInfo);
    const scratch = new TerrainSquareDecodeScratch();

    const keysByArchiveId = loadKeysMap(cacheInfo.name);

    const tsEntries: Array<{
        mapX: number;
        mapY: number;
        hash: number;
        locCount: number;
        hasNpc: boolean;
        npcCount: number;
    }> = [];
    const squares: string[] = [];

    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (tsEntries.length >= args.limit) break outer;

            const terrainArchiveId = mapsIndex.tryGetArchiveId(`m${mapX}_${mapY}`);
            const locArchiveId = mapsIndex.tryGetArchiveId(`l${mapX}_${mapY}`);
            if (terrainArchiveId === undefined || locArchiveId === undefined) continue;

            const terrFile = mapsIndex.tryGetFile(terrainArchiveId, 0);
            if (!terrFile) continue;

            const key = keysByArchiveId.get(locArchiveId) ?? null;
            const locFile = mapsIndex.tryGetFileKey(locArchiveId, 0, key);
            if (!locFile) continue;

            decodeTerrainSquareFromBytesInto(
                scratch,
                terrFile.data,
                newFormat,
                mapX * 64,
                mapY * 64,
            );
            const placements = decodeLocPlacementsFromBytes(locFile.data);

            let h = hashTerrainInputs(scratch);

            h = fnv1a32UpdateInt(h, 0x4c4f4353); // 'LOCS'
            for (const p of placements) {
                h = fnv1a32UpdateInt(h, p.id | 0);
                h = fnv1a32UpdateInt(h, p.level | 0);
                h = fnv1a32UpdateInt(h, p.localX | 0);
                h = fnv1a32UpdateInt(h, p.localY | 0);
                h = fnv1a32UpdateInt(h, (p.type as any) | 0);
                h = fnv1a32UpdateInt(h, p.rotation | 0);
            }

            let hasNpc = false;
            let npcCount = 0;
            h = fnv1a32UpdateInt(h, 0x4e504353); // 'NPCS'

            const npcArchiveId = mapsIndex.tryGetArchiveId(`n${mapX}_${mapY}`);
            if (npcArchiveId !== undefined) {
                const npcFile = mapsIndex.tryGetFileKey(npcArchiveId, 0, key);
                if (npcFile) {
                    try {
                        const spawns = decodeNpcSpawnsFromBytes(
                            scratch.tileRenderFlags[1],
                            0,
                            mapX,
                            mapY,
                            npcFile.data,
                        );
                        hasNpc = true;
                        npcCount = spawns.length;
                        for (const sp of spawns) {
                            h = fnv1a32UpdateInt(h, sp.id | 0);
                            h = fnv1a32UpdateInt(h, sp.x | 0);
                            h = fnv1a32UpdateInt(h, sp.y | 0);
                            h = fnv1a32UpdateInt(h, sp.level | 0);
                        }
                    } catch {
                        hasNpc = false;
                        npcCount = 0;
                    }
                }
            }

            tsEntries.push({
                mapX,
                mapY,
                hash: h | 0,
                locCount: placements.length,
                hasNpc,
                npcCount,
            });
            squares.push(`${mapX}_${mapY}`);
        }
    }

    if (tsEntries.length === 0) throw new Error("No squares selected");

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "map_square_inputs_hashes",
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
        newTerrainFormat: boolean;
        entries: Array<{
            mapX: number;
            mapY: number;
            ok: boolean;
            hash?: number;
            locCount?: number;
            hasNpc?: boolean;
            npcCount?: number;
            status?: string;
        }>;
    };

    if (parsed.newTerrainFormat !== newFormat) {
        throw new Error(`newTerrainFormat mismatch TS=${newFormat} C++=${parsed.newTerrainFormat}`);
    }

    const cppByKey = new Map<string, (typeof parsed.entries)[number]>();
    for (const e of parsed.entries) cppByKey.set(`${e.mapX}_${e.mapY}`, e);

    let mismatches = 0;
    for (const ts of tsEntries) {
        const key = `${ts.mapX}_${ts.mapY}`;
        const c = cppByKey.get(key);
        if (!c) throw new Error(`Missing C++ entry for ${key}`);
        if (!c.ok) throw new Error(`C++ failed for ${key}: ${c.status ?? "?"}`);
        if ((c.hash ?? 0) !== ts.hash) {
            mismatches++;
            console.error(`hash mismatch ${key}: ts=${ts.hash} cpp=${c.hash}`);
        } else if ((c.locCount ?? -1) !== ts.locCount) {
            mismatches++;
            console.error(`locCount mismatch ${key}: ts=${ts.locCount} cpp=${c.locCount}`);
        } else if ((c.hasNpc ?? false) !== ts.hasNpc) {
            mismatches++;
            console.error(`hasNpc mismatch ${key}: ts=${ts.hasNpc} cpp=${c.hasNpc}`);
        } else if ((c.npcCount ?? -1) !== ts.npcCount) {
            mismatches++;
            console.error(`npcCount mismatch ${key}: ts=${ts.npcCount} cpp=${c.npcCount}`);
        }
    }

    console.log(
        `map-square-inputs-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} squares=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
