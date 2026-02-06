import fs from "fs";
import path from "path";

import { Archive } from "../../src/rs/cache/format/Archive";
import { SectorChainStore } from "../../src/rs/cache/store/SectorChainStore";
import { Xtea } from "../../src/rs/crypto/Xtea";
import { readAllBytes } from "../../src/rs/io/ByteSourceUtil";
import { Uint8ArrayByteSource } from "../../src/rs/io/Uint8ArrayByteSource";

const FIXTURES_DIR = path.resolve("testdata/cache-fixtures");

function readFileBytes(filePath: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(filePath));
}

function assertBytesEqual(label: string, actual: Uint8Array, expected: Uint8Array): void {
    if (actual.length !== expected.length) {
        throw new Error(`${label}: length mismatch (actual=${actual.length} expected=${expected.length})`);
    }
    for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
            throw new Error(`${label}: mismatch at byte ${i} (actual=${actual[i]} expected=${expected[i]})`);
        }
    }
}

function checkXtea(): void {
    const dir = path.join(FIXTURES_DIR, "xtea");
    const input = readFileBytes(path.join(dir, "input.bin"));
    const expected = readFileBytes(path.join(dir, "expected.bin"));
    const key = JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf-8")) as number[];

    const actual = new Uint8Array(input);
    Xtea.decryptInPlace(actual, 0, actual.length, key);
    assertBytesEqual("xtea", actual, expected);
}

function checkSectorChain(): void {
    const dir = path.join(FIXTURES_DIR, "sectorchain");
    const dat = readFileBytes(path.join(dir, "main_file_cache.dat"));
    const idx0 = readFileBytes(path.join(dir, "main_file_cache.idx0"));
    const expected = readFileBytes(path.join(dir, "expected-idx0-archive1.bin"));
    const { indexId, archiveId } = JSON.parse(fs.readFileSync(path.join(dir, "case.json"), "utf-8")) as {
        indexId: number;
        archiveId: number;
    };

    const store = new SectorChainStore(
        new Uint8ArrayByteSource(dat),
        [new Uint8ArrayByteSource(idx0)],
        null,
    );
    const actual = readAllBytes(store.openArchiveReader(indexId, archiveId));
    assertBytesEqual("sectorchain", actual, expected);
}

function checkArchiveSplit(): void {
    const dir = path.join(FIXTURES_DIR, "archive-split");
    const payload = readFileBytes(path.join(dir, "payload.bin"));
    const expected0 = readFileBytes(path.join(dir, "expected-file0.bin"));
    const expected1 = readFileBytes(path.join(dir, "expected-file1.bin"));

    const archive = Archive.decodeFromSource(
        {
            id: 0,
            lastFileId: 1,
            fileCount: 2,
            fileIds: new Int32Array([0, 1]),
            fileNameHashes: new Int32Array([0, 0]),
        },
        new Uint8ArrayByteSource(payload),
    );

    const file0 = archive.getFile(0);
    const file1 = archive.getFile(1);
    if (!file0 || !file1) {
        throw new Error("archive-split: missing decoded files");
    }

    assertBytesEqual("archive-split:file0", file0.data, expected0);
    assertBytesEqual("archive-split:file1", file1.data, expected1);
}

function main(): void {
    checkXtea();
    checkSectorChain();
    checkArchiveSplit();
    console.log("OK: cache fixtures");
}

main();

