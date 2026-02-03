import fs from "fs";

type HashInfo = { len: number; xxh64: string };
type FileEntry = { fileId: number; len: number; xxh64: string };
type Entry = {
    indexId: number;
    archiveId: number;
    raw: HashInfo;
    containerPayload?: HashInfo;
    files?: FileEntry[];
};

type Manifest = {
    schema: number;
    cache?: unknown;
    selection?: unknown;
    entries: Entry[];
};

type Args = { a?: string; b?: string };

function parseArgs(argv: string[]): Args {
    const args: Args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--a") {
            args.a = argv[++i];
        } else if (a === "--b") {
            args.b = argv[++i];
        } else if (!a.startsWith("-")) {
            if (!args.a) args.a = a;
            else if (!args.b) args.b = a;
        }
    }
    return args;
}

function readJson(filePath: string): Manifest {
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object") {
        throw new Error(`Invalid JSON: ${filePath}`);
    }
    if (!Array.isArray((json as any).entries)) {
        throw new Error(`Invalid parity manifest (missing entries[]): ${filePath}`);
    }
    return json as Manifest;
}

function keyOf(e: Entry): string {
    return `${e.indexId}:${e.archiveId}`;
}

function compareHashInfo(label: string, a: HashInfo | undefined, b: HashInfo | undefined): string[] {
    if (!a && !b) return [];
    if (!a || !b) return [`${label}: presence mismatch`];
    const diffs: string[] = [];
    if (a.len !== b.len) diffs.push(`${label}.len ${a.len} != ${b.len}`);
    if (a.xxh64 !== b.xxh64) diffs.push(`${label}.xxh64 ${a.xxh64} != ${b.xxh64}`);
    return diffs;
}

function compareEntry(a: Entry, b: Entry): string[] {
    const diffs: string[] = [];
    diffs.push(...compareHashInfo("raw", a.raw, b.raw));
    diffs.push(...compareHashInfo("containerPayload", a.containerPayload, b.containerPayload));

    const aFiles = (a.files ?? []).slice().sort((x, y) => x.fileId - y.fileId);
    const bFiles = (b.files ?? []).slice().sort((x, y) => x.fileId - y.fileId);
    if (aFiles.length !== bFiles.length) {
        diffs.push(`files.count ${aFiles.length} != ${bFiles.length}`);
        return diffs;
    }
    for (let i = 0; i < aFiles.length; i++) {
        const af = aFiles[i];
        const bf = bFiles[i];
        if (af.fileId !== bf.fileId) {
            diffs.push(`files[${i}].fileId ${af.fileId} != ${bf.fileId}`);
            continue;
        }
        if (af.len !== bf.len) diffs.push(`file(${af.fileId}).len ${af.len} != ${bf.len}`);
        if (af.xxh64 !== bf.xxh64) diffs.push(`file(${af.fileId}).xxh64 ${af.xxh64} != ${bf.xxh64}`);
    }
    return diffs;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (!args.a || !args.b) {
        throw new Error("Usage: compare-parity --a <a.json> --b <b.json> (or positional: <a.json> <b.json>)");
    }

    const a = readJson(args.a);
    const b = readJson(args.b);

    if (a.schema !== b.schema) {
        throw new Error(`Schema mismatch: ${a.schema} != ${b.schema}`);
    }

    const aMap = new Map<string, Entry>(a.entries.map((e) => [keyOf(e), e]));
    const bMap = new Map<string, Entry>(b.entries.map((e) => [keyOf(e), e]));

    const keys = Array.from(new Set([...aMap.keys(), ...bMap.keys()])).sort();
    let mismatches = 0;

    for (const k of keys) {
        const ae = aMap.get(k);
        const be = bMap.get(k);
        if (!ae || !be) {
            mismatches++;
            console.error(`[${k}] missing in ${!ae ? "A" : "B"}`);
            continue;
        }
        const diffs = compareEntry(ae, be);
        if (diffs.length > 0) {
            mismatches++;
            console.error(`[${k}]`);
            for (const d of diffs) console.error(`  - ${d}`);
        }
    }

    if (mismatches > 0) {
        console.error(`FAIL: ${mismatches} mismatches`);
        process.exit(1);
    }

    console.log(`OK: ${keys.length} entries match`);
}

main();

