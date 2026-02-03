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
    if (key === "disable") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
      args.disable ??= [];
      args.disable.push(next);
      i++;
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

function report(findings, sourceFile, node, ruleId, severity, message, dedupe) {
  const start = node.getStart(sourceFile, false);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  if (dedupe) {
    const key = `${ruleId}:${sourceFile.fileName}:${line + 1}:${character + 1}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
  }
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

const DATA_VIEW_METHODS_WITH_ENDIAN = new Set([
  "getInt16",
  "getInt32",
  "getUint16",
  "getUint32",
  "getFloat32",
  "getFloat64",
  "getBigInt64",
  "getBigUint64",
  "setInt16",
  "setInt32",
  "setUint16",
  "setUint32",
  "setFloat32",
  "setFloat64",
  "setBigInt64",
  "setBigUint64",
]);

const BITWISE_OPS = new Set([
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
]);

const ARITH_OPS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
]);

function isExplicitIntCoercion(expr) {
  // x | 0, 0 | x
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarToken) {
    if (isNumericZero(expr.left) || isNumericZero(expr.right)) return true;
  }
  // x >>> 0
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken &&
    isNumericZero(expr.right)
  ) {
    return true;
  }
  // ~~x
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.TildeToken) {
    const op = expr.operand;
    if (ts.isPrefixUnaryExpression(op) && op.operator === ts.SyntaxKind.TildeToken) return true;
  }
  // toU32(x) / toI32(x) conventions (if you add them)
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const name = expr.expression.text;
    if (name === "toU32" || name === "toI32") return true;
  }
  return false;
}

function isTopLevelArithmetic(expr) {
  const e = unwrapParens(expr);
  return ts.isBinaryExpression(e) && ARITH_OPS.has(e.operatorToken.kind);
}

function unwrapParens(expr) {
  let cur = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

function flattenOrChain(expr, out) {
  const e = unwrapParens(expr);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarToken) {
    flattenOrChain(e.left, out);
    flattenOrChain(e.right, out);
    return;
  }
  out.push(e);
}

function shiftAmountIfByteShift(expr) {
  const e = unwrapParens(expr);
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.LessThanLessThanToken) return null;
  const amt = unwrapParens(e.right);
  if (!ts.isNumericLiteral(amt)) return null;
  const n = Number(amt.text);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 56) return null;
  if (n % 8 !== 0) return null;
  return n;
}

function looksLikeManualByteAssemble(expr) {
  const terms = [];
  flattenOrChain(expr, terms);
  if (terms.length < 3 || terms.length > 5) return false;
  const shifts = [];
  for (const t of terms) {
    const s = shiftAmountIfByteShift(t);
    if (s != null) shifts.push(s);
  }
  // Typical u32 assembly has 3 shift terms (24,16,8) plus a base term
  // or sometimes only 2 (16,8) for u24.
  if (shifts.length < 2) return false;
  // Only consider byte-aligned shifts up to 24/56.
  const maxShift = Math.max(...shifts);
  if (maxShift < 8) return false;
  return true;
}

function scanFile(filePath, findings, disabledRules) {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const dedupe = new Set();

  function isDisabled(ruleId) {
    return disabledRules?.has(ruleId);
  }

  // Comment-based hazards
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("@ts-ignore")) {
      if (isDisabled("tsIgnore")) continue;
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
      if (isDisabled("tsExpectError")) continue;
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
      if (isDisabled("nonNullAssertion")) return;
      report(
        findings,
        sf,
        node,
        "nonNullAssertion",
        "warn",
        "Uses non-null assertion (!) (make invariants explicit for C++).",
        dedupe,
      );
    }

    // `as any`
    if (ts.isAsExpression(node) && node.type && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      if (isDisabled("asAny")) return;
      report(
        findings,
        sf,
        node,
        "asAny",
        "warn",
        "Casts to any (erases types; model explicitly before C++).",
        dedupe,
      );
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const isLooseEq =
        op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
      if (isLooseEq && (isNullLiteral(node.left) || isNullLiteral(node.right))) {
        if (!isDisabled("looseNullCheck")) {
        report(
          findings,
          sf,
          node,
          "looseNullCheck",
          "warn",
          "Uses ==/!= null (be explicit about null vs undefined before C++ port).",
          dedupe,
        );
        }
      }

      // JS int32 coercions
      if (op === ts.SyntaxKind.BarToken && (isNumericZero(node.left) || isNumericZero(node.right))) {
        if (!isDisabled("toInt32Or0")) {
        report(
          findings,
          sf,
          node,
          "toInt32Or0",
          "info",
          "Uses |0 (JS ToInt32 coercion; make integer intent explicit for C++).",
          dedupe,
        );
        }
      } else if (op === ts.SyntaxKind.BarToken && looksLikeManualByteAssemble(node)) {
        if (!isDisabled("manualByteAssemble")) {
        report(
          findings,
          sf,
          node,
          "manualByteAssemble",
          "warn",
          "Manually assembles an integer via (byte << k) | ... (prefer centralized BE helpers like readU32BE/readU24BE).",
          dedupe,
        );
        }
      }
      if (
        (op === ts.SyntaxKind.GreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.LessThanLessThanToken) &&
        isNumericZero(node.right)
      ) {
        if (!isDisabled("shiftBy0")) {
        report(
          findings,
          sf,
          node,
          "shiftBy0",
          "info",
          "Uses shift by 0 (often used for coercion/masking; confirm integer semantics for C++).",
          dedupe,
        );
        }
      }

      if (op === ts.SyntaxKind.InstanceOfKeyword) {
        if (!isDisabled("instanceof")) {
        report(
          findings,
          sf,
          node,
          "instanceof",
          "warn",
          "Uses instanceof (may require RTTI/design changes in C++).",
          dedupe,
        );
        }
      }

      if (BITWISE_OPS.has(op)) {
        if (isExplicitIntCoercion(node)) {
          // Explicit 32-bit normalization (x|0, x>>>0, ~~x).
          // Still tracked separately via toInt32Or0/shiftBy0/doubleTilde rules.
          return;
        }
        if (isDisabled("bitwiseArithmeticMixing")) return;
        const left = unwrapParens(node.left);
        const right = unwrapParens(node.right);
        const leftArith = isTopLevelArithmetic(left) && !isExplicitIntCoercion(left);
        const rightArith = isTopLevelArithmetic(right) && !isExplicitIntCoercion(right);
        if (leftArith || rightArith) {
          report(
            findings,
            sf,
            node,
            "bitwiseArithmeticMixing",
            "info",
            "Bitwise op mixes with arithmetic (+-*/%) without explicit 32-bit normalization (consider toU32/toI32 helpers).",
            dedupe,
          );
        }
      }
    }

    // ~~x
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken) {
      const operand = node.operand;
      if (ts.isPrefixUnaryExpression(operand) && operand.operator === ts.SyntaxKind.TildeToken) {
        if (isDisabled("doubleTilde")) return;
        report(findings, sf, node, "doubleTilde", "info", "Uses ~~x (JS ToInt32 coercion).", dedupe);
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
        if (!isDisabled("mathImul")) {
        report(
          findings,
          sf,
          node,
          "mathImul",
          "info",
          "Uses Math.imul (32-bit multiply semantics; replicate explicitly in C++).",
          dedupe,
        );
        }
      }

      // DataView get*/set* calls where the endianness arg is omitted.
      if (ts.isPropertyAccessExpression(expr) && DATA_VIEW_METHODS_WITH_ENDIAN.has(expr.name.text)) {
        const method = expr.name.text;
        const argc = node.arguments.length;
        const isGet = method.startsWith("get");
        const isSet = method.startsWith("set");
        const missingEndian = (isGet && argc === 1) || (isSet && argc === 2);
        if (missingEndian) {
          if (isDisabled("dataViewNoEndian")) return;
          report(
            findings,
            sf,
            node,
            "dataViewNoEndian",
            "warn",
            "DataView read/write without explicit endianness argument (pass false for BE or route through BE helper).",
            dedupe,
          );
        }
      }
    }

    // BigInt
    if (node.kind === ts.SyntaxKind.BigIntLiteral) {
      if (!isDisabled("bigIntLiteral")) {
      report(
        findings,
        sf,
        node,
        "bigIntLiteral",
        "info",
        "Uses BigInt literal (choose uint64_t/int64_t).",
        dedupe,
      );
      }
    }
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, "BigInt")) {
      if (isDisabled("bigIntCall")) return;
      report(findings, sf, node, "bigIntCall", "info", "Uses BigInt() (choose uint64_t/int64_t).", dedupe);
    }

    // new Array(n) => holey array
    if (
      ts.isNewExpression(node) &&
      isIdentifierNamed(node.expression, "Array") &&
      node.arguments?.length === 1
    ) {
      if (isDisabled("newArraySize")) return;
      report(
        findings,
        sf,
        node,
        "newArraySize",
        "warn",
        "Uses new Array(n) (holey array; C++ vector semantics differ unless fully initialized).",
        dedupe,
      );
    }

    // [ , , ] omitted elements (holey)
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) {
        if (el.kind === ts.SyntaxKind.OmittedExpression) {
          if (isDisabled("arrayOmittedElement")) return;
          report(
            findings,
            sf,
            node,
            "arrayOmittedElement",
            "warn",
            "Array literal has omitted elements (holey array).",
            dedupe,
          );
          break;
        }
      }
    }

    // require(...)
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, "require")) {
      if (isDisabled("requireCall")) return;
      report(
        findings,
        sf,
        node,
        "requireCall",
        "warn",
        "Uses require() (mixed module semantics; avoid for port).",
        dedupe,
      );
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
  const disabledRules = new Set(argv.disable ?? []);

  const files = walkFiles(root).filter((f) => isTsFile(f, includeDts));
  const findings = [];
  for (const f of files) {
    scanFile(f, findings, disabledRules);
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
