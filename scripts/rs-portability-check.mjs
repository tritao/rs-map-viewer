import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === "json" || key === "include-dts") {
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

function walkFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) out.push(abs);
    }
  }
  out.sort();
  return out;
}

function isTsFile(filePath, includeDts) {
  if (filePath.endsWith(".d.ts")) return !!includeDts;
  return filePath.endsWith(".ts") || filePath.endsWith(".tsx");
}

function severityRank(sev) {
  switch (sev) {
    case "error":
      return 3;
    case "warn":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function shouldFail(failOn, findings) {
  const threshold = severityRank(failOn);
  return findings.some((f) => severityRank(f.severity) >= threshold);
}

function report(findings, sourceFile, node, ruleId, severity, message) {
  const start = node.getStart(sourceFile, false);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  findings.push({
    ruleId,
    severity,
    file: sourceFile.fileName,
    line: line + 1,
    column: character + 1,
    message,
  });
}

function isNullLiteral(node) {
  return node && node.kind === ts.SyntaxKind.NullKeyword;
}

function isNumericZero(node) {
  return ts.isNumericLiteral(node) && node.text === "0";
}

function isIdentifierNamed(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function scanFile(filePath, findings) {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  // Comment-based hazards
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("@ts-ignore")) {
      findings.push({
        ruleId: "tsIgnore",
        severity: "error",
        file: filePath,
        line: i + 1,
        column: Math.max(1, line.indexOf("@ts-ignore") + 1),
        message: "Uses @ts-ignore (hides typing issues; avoid before C++ port).",
      });
    }
    if (line.includes("@ts-expect-error")) {
      findings.push({
        ruleId: "tsExpectError",
        severity: "warn",
        file: filePath,
        line: i + 1,
        column: Math.max(1, line.indexOf("@ts-expect-error") + 1),
        message: "Uses @ts-expect-error (track/remove before C++ port).",
      });
    }
  }

  function visit(node) {
    // Non-null assertion: x!
    if (ts.isNonNullExpression(node)) {
      report(
        findings,
        sf,
        node,
        "nonNullAssertion",
        "warn",
        "Uses non-null assertion (!) (make invariants explicit for C++).",
      );
    }

    // `as any`
    if (ts.isAsExpression(node) && node.type && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      report(findings, sf, node, "asAny", "warn", "Casts to any (erases types; model explicitly before C++).");
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const isLooseEq =
        op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
      if (isLooseEq && (isNullLiteral(node.left) || isNullLiteral(node.right))) {
        report(
          findings,
          sf,
          node,
          "looseNullCheck",
          "warn",
          "Uses ==/!= null (be explicit about null vs undefined before C++ port).",
        );
      }

      // JS int32 coercions
      if (op === ts.SyntaxKind.BarToken && (isNumericZero(node.left) || isNumericZero(node.right))) {
        report(
          findings,
          sf,
          node,
          "toInt32Or0",
          "info",
          "Uses |0 (JS ToInt32 coercion; make integer intent explicit for C++).",
        );
      }
      if (
        (op === ts.SyntaxKind.GreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.LessThanLessThanToken) &&
        isNumericZero(node.right)
      ) {
        report(
          findings,
          sf,
          node,
          "shiftBy0",
          "info",
          "Uses shift by 0 (often used for coercion/masking; confirm integer semantics for C++).",
        );
      }

      if (op === ts.SyntaxKind.InstanceOfKeyword) {
        report(
          findings,
          sf,
          node,
          "instanceof",
          "warn",
          "Uses instanceof (may require RTTI/design changes in C++).",
        );
      }
    }

    // ~~x
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken) {
      const operand = node.operand;
      if (ts.isPrefixUnaryExpression(operand) && operand.operator === ts.SyntaxKind.TildeToken) {
        report(findings, sf, node, "doubleTilde", "info", "Uses ~~x (JS ToInt32 coercion).");
      }
    }

    // Math.imul(...)
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (
        ts.isPropertyAccessExpression(expr) &&
        isIdentifierNamed(expr.expression, "Math") &&
        expr.name.text === "imul"
      ) {
        report(
          findings,
          sf,
          node,
          "mathImul",
          "info",
          "Uses Math.imul (32-bit multiply semantics; replicate explicitly in C++).",
        );
      }
    }

    // BigInt
    if (node.kind === ts.SyntaxKind.BigIntLiteral) {
      report(findings, sf, node, "bigIntLiteral", "info", "Uses BigInt literal (choose uint64_t/int64_t).");
    }
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, "BigInt")) {
      report(findings, sf, node, "bigIntCall", "info", "Uses BigInt() (choose uint64_t/int64_t).");
    }

    // new Array(n) => holey array
    if (
      ts.isNewExpression(node) &&
      isIdentifierNamed(node.expression, "Array") &&
      node.arguments?.length === 1
    ) {
      report(
        findings,
        sf,
        node,
        "newArraySize",
        "warn",
        "Uses new Array(n) (holey array; C++ vector semantics differ unless fully initialized).",
      );
    }

    // [ , , ] omitted elements (holey)
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) {
        if (el.kind === ts.SyntaxKind.OmittedExpression) {
          report(findings, sf, node, "arrayOmittedElement", "warn", "Array literal has omitted elements (holey array).");
          break;
        }
      }
    }

    // require(...)
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, "require")) {
      report(findings, sf, node, "requireCall", "warn", "Uses require() (mixed module semantics; avoid for port).");
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
}

function main() {
  const argv = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(process.cwd());
  const root = path.resolve(repoRoot, argv.root ?? "src/rs");
  const includeDts = !!argv["include-dts"];
  const failOn = argv["fail-on"] ?? "error"; // error|warn|info
  const max = Number(argv.max ?? "200");

  const files = walkFiles(root).filter((f) => isTsFile(f, includeDts));
  const findings = [];
  for (const f of files) {
    scanFile(f, findings);
    if (findings.length >= max) break;
  }

  findings.sort((a, b) => {
    const d = severityRank(b.severity) - severityRank(a.severity);
    if (d) return d;
    const fc = a.file.localeCompare(b.file);
    if (fc) return fc;
    const lc = a.line - b.line;
    if (lc) return lc;
    return a.column - b.column;
  });

  const bySev = new Map();
  const byRule = new Map();
  for (const f of findings) {
    bySev.set(f.severity, (bySev.get(f.severity) ?? 0) + 1);
    byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
  }

  const summary = {
    root: path.relative(repoRoot, root),
    filesScanned: files.length,
    findings: findings.length,
    truncated: findings.length >= max,
    failOn,
    countsBySeverity: Object.fromEntries([...bySev.entries()].sort()),
    topRules: Object.fromEntries([...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)),
  };

  if (argv.json) {
    process.stdout.write(JSON.stringify({ summary, findings }, null, 2) + "\n");
  } else {
    console.log(`rs portability check: ${summary.root}`);
    console.log(`files=${summary.filesScanned} findings=${summary.findings} failOn=${summary.failOn}`);
    if (summary.truncated) console.log(`(truncated to max=${max})`);
    console.log("");
    for (const [sev, count] of Object.entries(summary.countsBySeverity)) {
      console.log(`${sev}: ${count}`);
    }
    console.log("");
    for (const f of findings) {
      const rel = path.relative(repoRoot, f.file);
      console.log(`${f.severity.toUpperCase()} ${rel}:${f.line}:${f.column} ${f.ruleId} - ${f.message}`);
    }
  }

  if (shouldFail(failOn, findings)) process.exitCode = 1;
}

main();

