import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import url from "node:url";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === "json" || key === "no-fail" || key === "include-dts") {
      args[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = next;
    i++;
  }
  return args;
}

function isTsLikeFile(filePath) {
  if (filePath.endsWith(".d.ts")) return false;
  return filePath.endsWith(".ts") || filePath.endsWith(".tsx");
}

function walkFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile()) {
        out.push(abs);
      }
    }
  }
  out.sort();
  return out;
}

function resolveImport(fromFile, spec, rootDir) {
  if (!spec.startsWith(".")) return null;

  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];

  // exact path
  candidates.push(base);
  // add extensions
  candidates.push(`${base}.ts`);
  candidates.push(`${base}.tsx`);
  // index files
  candidates.push(path.join(base, "index.ts"));
  candidates.push(path.join(base, "index.tsx"));

  for (const cand of candidates) {
    if (!fs.existsSync(cand) || !fs.statSync(cand).isFile()) continue;
    const rel = path.relative(rootDir, cand);
    if (rel.startsWith("..") || path.isAbsolute(rel) === false && rel.startsWith("..")) continue;
    return path.resolve(cand);
  }
  return null;
}

function extractModuleSpecifiers(sourceFile) {
  const specs = [];

  function addIfString(node) {
    if (node && ts.isStringLiteralLike(node)) specs.push(node.text);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addIfString(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const mref = node.moduleReference;
      if (ts.isExternalModuleReference(mref)) addIfString(mref.expression);
    } else if (ts.isCallExpression(node)) {
      // import("...") or require("...")
      if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword) {
          specs.push(node.arguments[0].text);
        } else if (ts.isIdentifier(callee) && callee.text === "require") {
          specs.push(node.arguments[0].text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specs;
}

function topLevelGroup(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 1) return "(root)";
  return parts[0];
}

function compileGlob(pattern) {
  if (pattern === "*" || pattern === "(any)") return /.*/;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function ruleMatches(rule, fromGroup, toGroup) {
  const fromRe = compileGlob(rule.from ?? "*");
  const toRe = compileGlob(rule.to ?? "*");
  return fromRe.test(fromGroup) && toRe.test(toGroup);
}

function loadRules(rulesPath, repoRoot) {
  const abs = path.resolve(repoRoot, rulesPath);
  const raw = fs.readFileSync(abs, "utf8");
  const json = JSON.parse(raw);
  if (!json || !Array.isArray(json.rules)) throw new Error(`Invalid rules file: ${rulesPath}`);
  return { absPath: abs, ...json };
}

function stableHash(obj) {
  const text = JSON.stringify(obj);
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function main() {
  const argv = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(process.cwd());

  const rulesPath = argv.rules ?? "scripts/rs-layer-rules.json";
  const rules = loadRules(rulesPath, repoRoot);
  const rsRoot = path.resolve(repoRoot, argv.root ?? rules.root ?? "src/rs");

  const includeDts = !!argv["include-dts"];
  const allFiles = walkFiles(rsRoot).filter((f) => {
    if (includeDts) return f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".d.ts");
    return isTsLikeFile(f);
  });

  const fileSet = new Set(allFiles.map((f) => path.resolve(f)));
  const folderEdgeCounts = new Map(); // `${from} -> ${to}` => count
  const folderEdgeExamples = new Map(); // key => [{fromFile, spec, toFile}]

  for (const file of allFiles) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const specs = extractModuleSpecifiers(sf);
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const resolved = resolveImport(file, spec, rsRoot);
      if (!resolved) continue;
      if (!fileSet.has(resolved)) continue;

      const fromGroup = topLevelGroup(rsRoot, file);
      const toGroup = topLevelGroup(rsRoot, resolved);
      if (fromGroup === toGroup) continue;

      const key = `${fromGroup} -> ${toGroup}`;
      folderEdgeCounts.set(key, (folderEdgeCounts.get(key) ?? 0) + 1);
      const ex = folderEdgeExamples.get(key) ?? [];
      if (ex.length < 5) {
        ex.push({
          fromFile: path.relative(repoRoot, file),
          spec,
          toFile: path.relative(repoRoot, resolved),
        });
        folderEdgeExamples.set(key, ex);
      }
    }
  }

  const edges = [];
  for (const [key, count] of folderEdgeCounts.entries()) {
    const [fromGroup, toGroup] = key.split(" -> ");
    edges.push({ fromGroup, toGroup, count, examples: folderEdgeExamples.get(key) ?? [] });
  }
  edges.sort((a, b) => (b.count - a.count) || a.fromGroup.localeCompare(b.fromGroup) || a.toGroup.localeCompare(b.toGroup));

  const forbiddenRules = rules.rules.filter((r) => (r.action ?? "forbid") === "forbid");
  const violations = [];

  for (const e of edges) {
    const matching = forbiddenRules.filter((r) => ruleMatches(r, e.fromGroup, e.toGroup));
    for (const rule of matching) {
      violations.push({
        fromGroup: e.fromGroup,
        toGroup: e.toGroup,
        count: e.count,
        reason: rule.reason ?? "(no reason provided)",
        examples: e.examples,
      });
      break;
    }
  }

  const summary = {
    root: path.relative(repoRoot, rsRoot),
    files: allFiles.length,
    crossFolderEdges: edges.reduce((acc, e) => acc + e.count, 0),
    uniqueFolderEdges: edges.length,
    violations: violations.length,
    rulesFile: path.relative(repoRoot, rules.absPath),
  };
  summary.hash = stableHash({ summary, rules: rules.rules });

  if (argv.json) {
    process.stdout.write(JSON.stringify({ summary, violations, edges }, null, 2) + "\n");
  } else {
    console.log(`rs layer check: ${summary.root}`);
    console.log(
      `files=${summary.files} crossFolderEdges=${summary.crossFolderEdges} uniqueFolderEdges=${summary.uniqueFolderEdges}`,
    );
    console.log(`rules=${summary.rulesFile} hash=${summary.hash}`);
    console.log("");

    if (violations.length === 0) {
      console.log("OK: no forbidden folder dependencies detected.");
    } else {
      console.log(`FAIL: ${violations.length} forbidden folder dependencies detected:`);
      for (const v of violations) {
        console.log(`- ${v.fromGroup} -> ${v.toGroup} (${v.count}) : ${v.reason}`);
        for (const ex of v.examples) {
          console.log(`  - ${ex.fromFile} imports ${ex.spec} -> ${ex.toFile}`);
        }
      }
    }
  }

  if (!argv["no-fail"] && violations.length > 0) process.exitCode = 1;
}

main();

