import { spawnSync } from "child_process";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
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

function fnv1a32Heights(tileHeights: Int32Array[][]): number {
    let h = 2166136261 >>> 0;
    for (let level = 0; level < tileHeights.length; level++) {
        const grid = tileHeights[level];
        for (let x = 0; x < grid.length; x++) {
            const col = grid[x];
            for (let y = 0; y < col.length; y++) {
                h = fnv1a32UpdateInt(h, col[y] | 0);
            }
        }
    }
    return h | 0;
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
    const scratch = new TerrainSquareDecodeScratch();
    const newFormat = isNewTerrainFormat(cacheInfo);

    const tsEntries: Array<{ mapX: number; mapY: number; heightsHash: number }> = [];
    const squares: string[] = [];

    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (tsEntries.length >= args.limit) break outer;
            const archiveId = mapsIndex.tryGetArchiveId(`m${mapX}_${mapY}`);
            if (archiveId === undefined) continue;
            const file = mapsIndex.tryGetFile(archiveId, 0);
            if (!file) continue;
            decodeTerrainSquareFromBytesInto(scratch, file.data, newFormat, mapX * 64, mapY * 64);
            const heightsHash = fnv1a32Heights(scratch.tileHeights);
            tsEntries.push({ mapX, mapY, heightsHash });
            squares.push(`${mapX}_${mapY}`);
        }
    }

    if (tsEntries.length === 0) throw new Error("No terrain squares selected");

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "terrain_square_hashes",
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
            heightsHash?: number;
            status?: string;
        }>;
    };

    if (parsed.newTerrainFormat !== newFormat) {
        throw new Error(`newTerrainFormat mismatch TS=${newFormat} C++=${parsed.newTerrainFormat}`);
    }

    const cppByKey = new Map<string, { ok: boolean; heightsHash?: number; status?: string }>();
    for (const e of parsed.entries) cppByKey.set(`${e.mapX}_${e.mapY}`, e);

    let mismatches = 0;
    for (const ts of tsEntries) {
        const key = `${ts.mapX}_${ts.mapY}`;
        const c = cppByKey.get(key);
        if (!c) throw new Error(`Missing C++ entry for ${key}`);
        if (!c.ok) throw new Error(`C++ failed for ${key}: ${c.status ?? "?"}`);
        if (c.heightsHash !== ts.heightsHash) {
            mismatches++;
            console.error(`hash mismatch ${key}: ts=${ts.heightsHash} cpp=${c.heightsHash}`);
        }
    }

    console.log(
        `terrain-square-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} squares=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
