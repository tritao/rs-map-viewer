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

function hashPlacements(placements: ReturnType<typeof decodeLocPlacementsFromBytes>): number {
    let h = 2166136261 >>> 0;
    for (const p of placements) {
        h = fnv1a32UpdateInt(h, p.id | 0);
        h = fnv1a32UpdateInt(h, p.level | 0);
        h = fnv1a32UpdateInt(h, p.localX | 0);
        h = fnv1a32UpdateInt(h, p.localY | 0);
        h = fnv1a32UpdateInt(h, (p.type as any) | 0);
        h = fnv1a32UpdateInt(h, p.rotation | 0);
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

    const tsEntries: Array<{ mapX: number; mapY: number; placementsHash: number; count: number }> =
        [];
    const squares: string[] = [];

    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (tsEntries.length >= args.limit) break outer;
            const archiveId = mapsIndex.tryGetArchiveId(`l${mapX}_${mapY}`);
            if (archiveId === undefined) continue;

            const key = keysByArchiveId.get(archiveId) ?? null;
            const file = mapsIndex.tryGetFileKey(archiveId, 0, key);
            if (!file) continue;

            const placements = decodeLocPlacementsFromBytes(file.data);
            const placementsHash = hashPlacements(placements);
            tsEntries.push({ mapX, mapY, placementsHash, count: placements.length });
            squares.push(`${mapX}_${mapY}`);
        }
    }

    if (tsEntries.length === 0) throw new Error("No loc squares selected");

    const cpp = spawnSync(
        "./cpp/build/rs_cli",
        [
            "loc_square_hashes",
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
            placementsHash?: number;
            count?: number;
            status?: string;
        }>;
    };
    const cppByKey = new Map<
        string,
        { ok: boolean; placementsHash?: number; count?: number; status?: string }
    >();
    for (const e of parsed.entries) cppByKey.set(`${e.mapX}_${e.mapY}`, e);

    let mismatches = 0;
    for (const ts of tsEntries) {
        const key = `${ts.mapX}_${ts.mapY}`;
        const c = cppByKey.get(key);
        if (!c) throw new Error(`Missing C++ entry for ${key}`);
        if (!c.ok) throw new Error(`C++ failed for ${key}: ${c.status ?? "?"}`);
        if (c.placementsHash !== ts.placementsHash) {
            mismatches++;
            console.error(`hash mismatch ${key}: ts=${ts.placementsHash} cpp=${c.placementsHash}`);
        } else if ((c.count ?? -1) !== ts.count) {
            mismatches++;
            console.error(`count mismatch ${key}: ts=${ts.count} cpp=${c.count}`);
        }
    }

    console.log(
        `loc-square-parity: cache=${cacheInfo.name} rev=${cacheInfo.revision} squares=${tsEntries.length} mismatches=${mismatches}`,
    );
    if (mismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
