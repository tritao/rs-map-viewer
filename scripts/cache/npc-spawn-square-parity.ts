import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { XteaKey, asXteaKey } from "../../src/rs/crypto/Xtea";
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

function hashSpawns(spawns: ReturnType<typeof decodeNpcSpawnsFromBytes>): number {
    let h = 2166136261 >>> 0;
    for (const s of spawns) {
        h = fnv1a32UpdateInt(h, s.id | 0);
        h = fnv1a32UpdateInt(h, s.x | 0);
        h = fnv1a32UpdateInt(h, s.y | 0);
        h = fnv1a32UpdateInt(h, s.level | 0);
    }
    return h | 0;
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
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

function isNewTerrainFormat(cacheInfo: CacheInfo): boolean {
    return cacheInfo.game === 2 /* Oldschool */ && cacheInfo.revision >= 209;
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

    const keysByArchiveId = loadKeysMap(cacheInfo.name);
    const terrainScratch = new TerrainSquareDecodeScratch();
    const newFormat = isNewTerrainFormat(cacheInfo);

    const tsEntries: Array<{ mapX: number; mapY: number; spawnsHash: number; count: number }> = [];
    const squares: string[] = [];

    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (tsEntries.length >= args.limit) break outer;

            const terrainArchiveId = mapsIndex.tryGetArchiveId(`m${mapX}_${mapY}`);
            const locArchiveId = mapsIndex.tryGetArchiveId(`l${mapX}_${mapY}`);
            const npcArchiveId = mapsIndex.tryGetArchiveId(`n${mapX}_${mapY}`);
            if (
                terrainArchiveId === undefined ||
                locArchiveId === undefined ||
                npcArchiveId === undefined
            )
                continue;

            const terrainFile = mapsIndex.tryGetFile(terrainArchiveId, 0);
            if (!terrainFile) continue;

            const key = keysByArchiveId.get(locArchiveId) ?? null;
            const npcFile = mapsIndex.tryGetFileKey(npcArchiveId, 0, key);
            if (!npcFile) continue;

            decodeTerrainSquareFromBytesInto(
                terrainScratch,
                terrainFile.data,
                newFormat,
                mapX * 64,
                mapY * 64,
            );
            const spawns = decodeNpcSpawnsFromBytes(
                terrainScratch.tileRenderFlags[1],
                0,
                mapX,
                mapY,
                npcFile.data,
            );
            const spawnsHash = hashSpawns(spawns);

            tsEntries.push({ mapX, mapY, spawnsHash, count: spawns.length });
            squares.push(`${mapX}_${mapY}`);
        }
    }

    if (tsEntries.length === 0) {
        console.log(
            `npc-spawn-square-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} squares=0 (no nX_Y entries found)`,
        );
        return;
    }

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "npc_spawn_square_hashes",
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
            spawnsHash?: number;
            count?: number;
            status?: string;
        }>;
    };
    const cppByKey = new Map<
        string,
        { ok: boolean; spawnsHash?: number; count?: number; status?: string }
    >();
    for (const e of parsed.entries) cppByKey.set(`${e.mapX}_${e.mapY}`, e);

    let mismatches = 0;
    for (const ts of tsEntries) {
        const key = `${ts.mapX}_${ts.mapY}`;
        const c = cppByKey.get(key);
        if (!c) throw new Error(`Missing C++ entry for ${key}`);
        if (!c.ok) throw new Error(`C++ failed for ${key}: ${c.status ?? "?"}`);
        if (c.spawnsHash !== ts.spawnsHash) {
            mismatches++;
            console.error(`hash mismatch ${key}: ts=${ts.spawnsHash} cpp=${c.spawnsHash}`);
        } else if ((c.count ?? -1) !== ts.count) {
            mismatches++;
            console.error(`count mismatch ${key}: ts=${ts.count} cpp=${c.count}`);
        }
    }

    console.log(
        `npc-spawn-square-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} squares=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
