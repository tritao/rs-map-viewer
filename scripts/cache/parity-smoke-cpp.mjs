import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const CASES = [
  {
    cache: "osrs-221_2024-04-17",
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

  run("npm run -s rs:session-contract-cpp");
  run("npm run -s rs:model-parity -- --cache osrs-221_2024-04-17 --limit 40");
  run("npm run -s rs:model-parity -- --cache rs2-377_2006-05-02 --limit 40");
  run("npm run -s rs:model-parity -- --cache rs2-225_2004-05-06 --limit 40");
  run("npm run -s rs:model-status-parity -- --cache osrs-221_2024-04-17 --limit 40");
  run("npm run -s rs:model-status-parity -- --cache rs2-377_2006-05-02 --limit 40");
  run("npm run -s rs:model-status-parity -- --cache rs2-225_2004-05-06 --limit 40");
  run("npm run -s rs:seqframe-parity -- --cache osrs-221_2024-04-17 --limit 40");
  run("npm run -s rs:seqframe-parity -- --cache rs2-377_2006-05-02 --limit 40");
  run("npm run -s rs:seqframe-parity -- --cache rs2-225_2004-05-06 --limit 40");
  run("npm run -s rs:seqtype-frame-length-parity -- --cache osrs-221_2024-04-17 --limit 30 --maxFrames 20");
  run("npm run -s rs:seqtype-frame-length-parity -- --cache rs2-377_2006-05-02 --limit 30 --maxFrames 20");
  run("npm run -s rs:seqtype-frame-length-parity -- --cache rs2-225_2004-05-06 --limit 30 --maxFrames 20");
  run("npm run -s rs:anim-selection-parity -- --cache osrs-221_2024-04-17 --npcLimit 20 --locLimit 20 --maxFrames 8");
  run("npm run -s rs:anim-selection-parity -- --cache rs2-377_2006-05-02 --npcLimit 20 --locLimit 20 --maxFrames 8");
  run("npm run -s rs:anim-selection-parity -- --cache rs2-225_2004-05-06 --npcLimit 20 --locLimit 20 --maxFrames 8");
  run("npm run -s rs:transform-parity -- --cache osrs-221_2024-04-17 --npcLimit 20 --locLimit 20 --maxSteps 8");
  run("npm run -s rs:transform-parity -- --cache rs2-377_2006-05-02 --npcLimit 20 --locLimit 20 --maxSteps 8");
  run("npm run -s rs:transform-parity -- --cache rs2-225_2004-05-06 --npcLimit 20 --locLimit 20 --maxSteps 8");
  run("npm run -s rs:skeletal-seq-parity -- --cache osrs-221_2024-04-17 --limit 30");
  run("npm run -s rs:skeletal-eval-parity -- --cache osrs-221_2024-04-17 --limit 20 --maxFrames 8");
  run("npm run -s rs:skeletal-model-parity -- --cache osrs-221_2024-04-17 --limit 20 --maxFrames 4");
}

main();
