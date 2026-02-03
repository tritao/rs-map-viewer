import fs from "fs";
import path from "path";

import { Xtea } from "../../src/rs/crypto/Xtea";
import { SectorChainStore } from "../../src/rs/cache/store/SectorChainStore";
import { readAllBytes } from "../../src/rs/cache/store/ByteSourceUtil";
import { Uint8ArrayByteSource } from "../../src/rs/io/Uint8ArrayByteSource";
import { Archive } from "../../src/rs/cache/format/Archive";

const OUT_DIR = path.resolve("testdata/cache-fixtures");

function mkdirp(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function writeFileBytes(filePath: string, bytes: Uint8Array): void {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, Buffer.from(bytes));
}

function writeU16BE(buf: Uint8Array, off: number, value: number): void {
    buf[off] = (value >>> 8) & 0xff;
    buf[off + 1] = value & 0xff;
}

function writeU24BE(buf: Uint8Array, off: number, value: number): void {
    buf[off] = (value >>> 16) & 0xff;
    buf[off + 1] = (value >>> 8) & 0xff;
    buf[off + 2] = value & 0xff;
}

function writeI32BE(buf: Uint8Array, off: number, value: number): void {
    buf[off] = (value >>> 24) & 0xff;
    buf[off + 1] = (value >>> 16) & 0xff;
    buf[off + 2] = (value >>> 8) & 0xff;
    buf[off + 3] = value & 0xff;
}

function genXteaFixture(): void {
    const dir = path.join(OUT_DIR, "xtea");
    mkdirp(dir);

    const key = [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00];

    const input = new Uint8Array(64);
    for (let i = 0; i < input.length; i++) {
        input[i] = (i * 7 + 3) & 0xff;
    }

    const expected = new Uint8Array(input);
    Xtea.decryptInPlace(expected, 0, expected.length, key);

    writeFileBytes(path.join(dir, "input.bin"), input);
    writeFileBytes(path.join(dir, "expected.bin"), expected);
    fs.writeFileSync(path.join(dir, "key.json"), JSON.stringify(key));
}

function genSectorChainDatFixture(): void {
    const dir = path.join(OUT_DIR, "sectorchain");
    mkdirp(dir);

    // Build a minimal legacy (no idx255) sector chain store:
    // - One index file (idx0)
    // - One archive (archiveId=1) spanning two sectors
    const indexId = 0;
    const sectorIndexId = indexId + 1; // matches SectorChainStore.getSectorIndexId when metaFile=null
    const archiveId = 1;

    const payload = new Uint8Array(600);
    for (let i = 0; i < payload.length; i++) {
        payload[i] = (i * 13 + 17) & 0xff;
    }

    const sectorSize = 520;
    const sectorDataSize = 512;

    const firstSectorId = 1;
    const secondSectorId = 2;

    const dat = new Uint8Array((secondSectorId + 1) * sectorSize);

    // Sector 1 header (8 bytes) + data (512 bytes)
    {
        const base = firstSectorId * sectorSize;
        writeU16BE(dat, base + 0, archiveId);
        writeU16BE(dat, base + 2, 0); // chunk 0
        writeU24BE(dat, base + 4, secondSectorId);
        dat[base + 7] = sectorIndexId & 0xff;
        dat.set(payload.subarray(0, sectorDataSize), base + 8);
    }

    // Sector 2 header + remaining data (padded with zeros)
    {
        const base = secondSectorId * sectorSize;
        writeU16BE(dat, base + 0, archiveId);
        writeU16BE(dat, base + 2, 1); // chunk 1
        writeU24BE(dat, base + 4, 0); // end
        dat[base + 7] = sectorIndexId & 0xff;
        dat.set(payload.subarray(sectorDataSize), base + 8);
    }

    // idx0 entry (6 bytes per archive)
    const idx0 = new Uint8Array((archiveId + 1) * 6);
    writeU24BE(idx0, archiveId * 6 + 0, payload.length);
    writeU24BE(idx0, archiveId * 6 + 3, firstSectorId);

    // Verify our synthetic store round-trips through the TS reader.
    const store = new SectorChainStore(
        new Uint8ArrayByteSource(dat),
        [new Uint8ArrayByteSource(idx0)],
        null,
    );
    const readBack = readAllBytes(store.openArchiveReader(indexId, archiveId));
    if (readBack.length !== payload.length) {
        throw new Error(`SectorChain fixture mismatch: expected len=${payload.length}, got len=${readBack.length}`);
    }
    for (let i = 0; i < payload.length; i++) {
        if (payload[i] !== readBack[i]) {
            throw new Error(`SectorChain fixture mismatch at ${i}: expected=${payload[i]} got=${readBack[i]}`);
        }
    }

    writeFileBytes(path.join(dir, "main_file_cache.dat"), dat);
    writeFileBytes(path.join(dir, "main_file_cache.idx0"), idx0);
    writeFileBytes(path.join(dir, "expected-idx0-archive1.bin"), payload);
    fs.writeFileSync(
        path.join(dir, "case.json"),
        JSON.stringify({ indexId, archiveId, size: payload.length, firstSectorId }),
    );
}

function buildMultiFileArchivePayload(
    files: Uint8Array[],
    segmentSizesPerChunk: number[][],
): Uint8Array {
    const fileCount = files.length;
    const chunks = segmentSizesPerChunk.length;
    if (chunks <= 0) {
        throw new Error("chunks must be > 0");
    }
    for (let chunk = 0; chunk < chunks; chunk++) {
        if (segmentSizesPerChunk[chunk].length !== fileCount) {
            throw new Error("segmentSizesPerChunk shape mismatch");
        }
        for (let f = 1; f < fileCount; f++) {
            if (segmentSizesPerChunk[chunk][f] < segmentSizesPerChunk[chunk][f - 1]) {
                throw new Error("segment sizes must be nondecreasing across files per chunk");
            }
        }
    }

    const fileOffsets = new Array<number>(fileCount).fill(0);
    const bodyParts: Uint8Array[] = [];

    for (let chunk = 0; chunk < chunks; chunk++) {
        for (let f = 0; f < fileCount; f++) {
            const segSize = segmentSizesPerChunk[chunk][f];
            const start = fileOffsets[f];
            const end = start + segSize;
            if (end > files[f].length) {
                throw new Error(`segment exceeds file length (chunk=${chunk}, file=${f})`);
            }
            bodyParts.push(files[f].subarray(start, end));
            fileOffsets[f] = end;
        }
    }

    for (let f = 0; f < fileCount; f++) {
        if (fileOffsets[f] !== files[f].length) {
            throw new Error(`file ${f} not fully consumed: ${fileOffsets[f]} != ${files[f].length}`);
        }
    }

    const tableBytes = chunks * fileCount * 4;
    const bodyBytes = bodyParts.reduce((acc, part) => acc + part.length, 0);
    const out = new Uint8Array(bodyBytes + tableBytes + 1);

    let writeOff = 0;
    for (const part of bodyParts) {
        out.set(part, writeOff);
        writeOff += part.length;
    }

    for (let chunk = 0; chunk < chunks; chunk++) {
        let last = 0;
        for (let f = 0; f < fileCount; f++) {
            const segSize = segmentSizesPerChunk[chunk][f];
            const delta = segSize - last;
            writeI32BE(out, writeOff, delta | 0);
            writeOff += 4;
            last = segSize;
        }
    }

    out[writeOff] = chunks & 0xff;
    return out;
}

function genArchiveSplitFixture(): void {
    const dir = path.join(OUT_DIR, "archive-split");
    mkdirp(dir);

    const file0 = new TextEncoder().encode("abcdefghij"); // 10 bytes
    const file1 = new TextEncoder().encode("ABCDEFGHIJKLMNOPQR"); // 18 bytes

    // 2 chunks, 2 files. Ensure per-chunk segment sizes are nondecreasing across files.
    const segmentSizesPerChunk = [
        [3, 5], // chunk 0: file0 3, file1 5
        [7, 13], // chunk 1: file0 7, file1 13
    ];

    const payload = buildMultiFileArchivePayload([file0, file1], segmentSizesPerChunk);

    // Decode using TS logic for verification / expected output generation.
    const fileIds = new Int32Array([0, 1]);
    const fileNameHashes = new Int32Array([0, 0]);
    const archive = Archive.decodeFromSource(
        0,
        1,
        2,
        fileIds,
        fileNameHashes,
        new Uint8ArrayByteSource(payload),
    );
    const out0 = archive.getFile(0);
    const out1 = archive.getFile(1);
    if (!out0 || !out1) {
        throw new Error("archive split fixture decode failed");
    }

    writeFileBytes(path.join(dir, "payload.bin"), payload);
    writeFileBytes(
        path.join(dir, "expected-file0.bin"),
        new Uint8Array(out0.data.buffer, out0.data.byteOffset, out0.data.byteLength),
    );
    writeFileBytes(
        path.join(dir, "expected-file1.bin"),
        new Uint8Array(out1.data.buffer, out1.data.byteOffset, out1.data.byteLength),
    );
    fs.writeFileSync(path.join(dir, "case.json"), JSON.stringify({ fileCount: 2, chunks: 2 }));
}

function main(): void {
    genXteaFixture();
    genSectorChainDatFixture();
    genArchiveSplitFixture();
    console.log(`Wrote fixtures under ${OUT_DIR}`);
}

main();
