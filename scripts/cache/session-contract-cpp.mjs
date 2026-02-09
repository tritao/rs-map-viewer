import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CASES = JSON.parse(
  fs.readFileSync(path.resolve("scripts/cache/session-contract.cases.json"), "utf8"),
).cases;

function ensureExists(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} not found: ${p}`);
  }
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch (error) {
    if (error && typeof error === "object" && error.status === 0 && typeof error.stdout === "string") {
      return error.stdout;
    }
    throw error;
  }
}

function main() {
  ensureExists(path.resolve("cpp/build/rs_cli"), "C++ CLI");
  ensureExists(path.resolve("caches/caches.json"), "Cache index");

  for (const c of CASES) {
    if (!c.expectedCpp) {
      throw new Error(`${c.label}: missing expectedCpp in fixture`);
    }
    const cacheDir = path.resolve("caches", c.cache);
    ensureExists(cacheDir, `Cache (${c.label})`);
    const out = run("./cpp/build/rs_cli", [
      "session_contract",
      "--cache",
      c.cache,
      "--game",
      c.game,
      "--revision",
      String(c.revision),
    ]);
    process.stdout.write(out);
    const parsed = JSON.parse(out);
    if (parsed.cacheType !== c.expectedCpp.cacheType) {
      throw new Error(`${c.label}: cacheType mismatch (${parsed.cacheType} != ${c.expectedCpp.cacheType})`);
    }
    if (parsed.hasQuestTypeLoader !== c.expectedCpp.hasQuestTypeLoader) {
      throw new Error(`${c.label}: quest capability mismatch`);
    }
    if (parsed.hasSkeletalSeqLoader !== c.expectedCpp.hasSkeletalSeqLoader) {
      throw new Error(`${c.label}: skeletal capability mismatch`);
    }
    if (parsed.hasDistinctUnderlayTypeLoader !== c.expectedCpp.hasDistinctUnderlayTypeLoader) {
      throw new Error(`${c.label}: underlay capability mismatch`);
    }
    if (parsed.hasModelService !== c.expectedCpp.hasModelService) {
      throw new Error(`${c.label}: model service availability mismatch`);
    }
    if (parsed.hasSeqFrameService !== c.expectedCpp.hasSeqFrameService) {
      throw new Error(`${c.label}: seq frame service availability mismatch`);
    }
    if (parsed.hasTextureService !== c.expectedCpp.hasTextureService) {
      throw new Error(`${c.label}: texture service availability mismatch`);
    }
    if (parsed.hasMapFileService !== c.expectedCpp.hasMapFileService) {
      throw new Error(`${c.label}: map file service availability mismatch`);
    }
  }

  console.log(`session-contract-cpp: ok (${CASES.length} cases)`);
}

main();
