import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const CASES = [
  {
    cache: "osrs-221_2024-05-15",
    args: "--indices 0 --maxIndices 1 --maxArchives 10",
    key: "osrs221",
  },
  {
    cache: "rs2-377_2006-05-02",
    args: "--maxIndices 5 --maxArchives 50",
    key: "rs2377",
  },
  {
    cache: "rs2-667_2011-10-15",
    args: "--maxIndices 5 --maxArchives 50",
    key: "rs2667",
  },
];

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function ensureExists(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} not found: ${p}`);
  }
}

function main() {
  ensureExists(path.resolve("cpp/build/rs_cli"), "C++ parity CLI");
  ensureExists(path.resolve("caches/caches.json"), "Cache index");

  const tmpDir = os.tmpdir();
  for (const c of CASES) {
    const cacheDir = path.resolve("caches", c.cache);
    ensureExists(cacheDir, "Cache directory");

    const tsOut = path.join(tmpDir, `parity-ts-${c.key}.json`);
    const cppOut = path.join(tmpDir, `parity-cpp-${c.key}.json`);

    run(`npm run -s cache:parity -- --cache ${c.cache} ${c.args} --out ${tsOut}`);
    run(`./cpp/build/rs_cli parity --cache ${c.cache} ${c.args} --out ${cppOut}`);
    run(`npm run -s cache:parity-compare -- --a ${tsOut} --b ${cppOut}`);
  }
}

main();
