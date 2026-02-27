import fs from "fs";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
    let cachesCsv;
    const passThrough = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--caches") {
            cachesCsv = String(argv[++i] ?? "");
            continue;
        }
        passThrough.push(arg);
    }
    const caches =
        cachesCsv && cachesCsv.trim().length > 0
            ? cachesCsv
                  .split(/[;,]/)
                  .map((v) => v.trim())
                  .filter((v) => v.length > 0)
            : undefined;
    return { caches, passThrough };
}

function loadCacheIndex() {
    const raw = fs.readFileSync("caches/caches.json", "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : [];
}

function pickCacheNameByGameRevision(infos, game, revision) {
    const matches = infos.filter(
        (c) => String(c.game) === game && (c.revision | 0) === (revision | 0),
    );
    if (matches.length <= 0) return undefined;
    matches.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return String(matches[0].name);
}

function runOne(cacheName, passThrough) {
    const cmd = [
        "npm",
        "run",
        "-s",
        "rs:map-render-runtime-cache-v2-parity",
        "--",
        "--cache",
        cacheName,
        "--matrix",
        "--stages",
        "--summary-only",
        ...passThrough,
    ];
    const r = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
    return r.status ?? 1;
}

const { caches, passThrough } = parseArgs(process.argv.slice(2));
const cacheInfos = loadCacheIndex();

const defaultTargets = [
    pickCacheNameByGameRevision(cacheInfos, "runescape", 225),
    pickCacheNameByGameRevision(cacheInfos, "runescape", 667),
    pickCacheNameByGameRevision(cacheInfos, "oldschool", 221),
].filter((v) => typeof v === "string");

const selected = caches && caches.length > 0 ? caches : defaultTargets;
if (!selected || selected.length <= 0) {
    console.error(
        "No caches selected. Provide --caches <name1,name2> or ensure caches/caches.json contains the default targets.",
    );
    process.exit(1);
}

let worst = 0;
for (const cacheName of selected) {
    console.log(`\n[parity-matrix] cache=${cacheName}`);
    const code = runOne(cacheName, passThrough);
    worst = Math.max(worst, code);
}
process.exit(worst);

