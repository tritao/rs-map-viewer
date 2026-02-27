import { execSync } from "node:child_process";

// Default to the current high-signal runtime parity squares.
// Override with `--squares` when targeting specific regressions.
const DEFAULT_SQUARES = "17:51,17:52,18:52,18:53";

function parseArgs(argv) {
  let cache;
  let squares = DEFAULT_SQUARES;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cache") {
      cache = argv[++i];
    } else if (arg === "--squares") {
      squares = argv[++i] ?? "";
    }
  }
  if (!squares || !squares.trim()) {
    throw new Error("Invalid --squares value");
  }
  return { cache, squares };
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

function buildRunCmd(script, cache, extraArgs = "") {
  const cachePart = cache ? ` --cache ${cache}` : "";
  return `npm run -s ${script} --${cachePart}${extraArgs}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const squaresArg = ` --squares ${args.squares}`;
  const results = [];

  results.push({ name: "bridge-contract", ok: run(buildRunCmd("rs:map-render-runtime-bridge-contract", args.cache)) });
  results.push({ name: "surface-regression", ok: run(buildRunCmd("rs:map-render-wasm-surface-regression", args.cache)) });
  results.push({ name: "runtime-cache-v2-parity", ok: run(buildRunCmd("rs:map-render-runtime-cache-v2-parity", args.cache, `${squaresArg} --stages`)) });

  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(`\nmap-render-parity-full: cache=${args.cache ?? "<latest>"} squares=${args.squares}`);
  console.log(`map-render-parity-full: checks=${results.length} failed=${failed.length}`);
  if (failed.length > 0) {
    console.log(`map-render-parity-full: failing=${failed.join(",")}`);
    process.exit(1);
  }
}

main();
