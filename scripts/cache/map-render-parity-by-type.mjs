import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_TYPES = ["legacy", "dat", "dat2"];
const DEFAULT_SQUARES = "17:51,17:52,18:52,18:53";

function parseCommaList(value) {
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseArgs(argv) {
  let caches = [];
  let types = [...DEFAULT_TYPES];
  let squares = DEFAULT_SQUARES;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--caches") {
      caches = parseCommaList(argv[++i]);
    } else if (arg === "--types") {
      const parsed = parseCommaList(argv[++i]);
      if (parsed.length > 0) {
        types = parsed;
      }
    } else if (arg === "--squares") {
      squares = argv[++i] ?? "";
    }
  }

  if (!squares || !squares.trim()) {
    throw new Error("Invalid --squares value");
  }

  const validTypes = new Set(DEFAULT_TYPES);
  for (const type of types) {
    if (!validTypes.has(type)) {
      throw new Error(`Invalid --types value '${type}'. Expected: ${DEFAULT_TYPES.join(",")}`);
    }
  }

  return { caches, types, squares };
}

function quoteArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function detectCacheStorageType(cacheName) {
  const cacheDir = path.join("caches", cacheName);
  if (fs.existsSync(path.join(cacheDir, "main_file_cache.dat2"))) {
    return "dat2";
  }
  if (fs.existsSync(path.join(cacheDir, "main_file_cache.dat"))) {
    return "dat";
  }
  return "legacy";
}

function loadCacheInfos() {
  const raw = fs.readFileSync(path.join("caches", "caches.json"), "utf8");
  const infos = JSON.parse(raw);
  if (!Array.isArray(infos)) {
    throw new Error("caches/caches.json must be an array");
  }
  return infos;
}

function selectLatestCachesByType(types) {
  const infos = loadCacheInfos().slice();
  infos.sort((a, b) => {
    const ta = Date.parse(a?.timestamp ?? "");
    const tb = Date.parse(b?.timestamp ?? "");
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  const selected = [];
  for (const wantedType of types) {
    const match = infos.find((info) => detectCacheStorageType(info.name) === wantedType);
    if (!match) {
      console.warn(`[map-render-parity-by-type] no cache found for type=${wantedType}`);
      continue;
    }
    selected.push({ name: match.name, type: wantedType });
  }
  return selected;
}

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const selected = args.caches.length > 0
    ? args.caches.map((name) => ({ name, type: detectCacheStorageType(name) }))
    : selectLatestCachesByType(args.types);

  if (selected.length === 0) {
    throw new Error("No caches selected (check caches/caches.json and your --types/--caches args).");
  }

  const results = [];
  for (const cache of selected) {
    const ok = run(
      `npm run -s rs:map-render-parity-full -- --cache ${quoteArg(cache.name)} --squares ${quoteArg(args.squares)}`
    );
    results.push({ cache: cache.name, type: cache.type, ok });
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\nmap-render-parity-by-type summary:");
  for (const r of results) {
    console.log(`- ${r.ok ? "ok" : "FAIL"} type=${r.type} cache=${r.cache}`);
  }
  if (failed.length > 0) {
    process.exit(1);
  }
}

main();

