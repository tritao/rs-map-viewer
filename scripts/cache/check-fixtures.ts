import fs from "fs";
import path from "path";

import { Archive } from "../../src/rs/cache/format/Archive";
import { SectorChainStore } from "../../src/rs/cache/store/SectorChainStore";
import { CacheInfo, GameType } from "../../src/rs/cache/CacheInfo";
import { Xtea } from "../../src/rs/crypto/Xtea";
import { VarBitType } from "../../src/rs/config/vartype/bit/VarBitType";
import { ModelData } from "../../src/rs/model/ModelData";
import { SeqBase } from "../../src/rs/model/seq/SeqBase";
import { Dat2SeqFrame } from "../../src/rs/model/seq/SeqFrame";
import { SeqTransformType } from "../../src/rs/model/seq/SeqTransformType";
import { readAllBytes } from "../../src/rs/io/ByteSourceUtil";
import { ByteBuffer } from "../../src/rs/io/ByteBuffer";
import { Uint8ArrayByteSource } from "../../src/rs/io/Uint8ArrayByteSource";
import { NamedBytesProvider } from "../../src/rs/io/NamedBytesProvider";
import { SpriteLoader } from "../../src/rs/sprite/SpriteLoader";

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

function checkIndexedSpriteDat(): void {
    const dir = path.join(FIXTURES_DIR, "indexed-sprite-dat");
    const { name, offset } = JSON.parse(fs.readFileSync(path.join(dir, "case.json"), "utf-8")) as {
        name: string;
        offset: number;
    };
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as {
        width: number;
        height: number;
        xOffset: number;
        yOffset: number;
        subWidth: number;
        subHeight: number;
        palette: number[];
        pixels: number[];
    };

    const indexBytes = readFileBytes(path.join(dir, "index.dat"));
    const dataBytes = readFileBytes(path.join(dir, `${name}.dat`));

    const source: NamedBytesProvider = {
        getBytes: (fileName: string) => {
            if (fileName === "index.dat") return indexBytes;
            if (fileName === `${name}.dat`) return dataBytes;
            return undefined;
        },
    };

    const sprite = SpriteLoader.tryLoadIndexedSpriteDatFromNamedBytes(source, name, offset);
    if (!sprite) {
        throw new Error("indexed-sprite-dat: failed decoding sprite");
    }

    const palette = Array.from(sprite.palette);
    const pixels = Array.from(sprite.pixels);

    const same =
        sprite.width === expected.width &&
        sprite.height === expected.height &&
        sprite.xOffset === expected.xOffset &&
        sprite.yOffset === expected.yOffset &&
        sprite.subWidth === expected.subWidth &&
        sprite.subHeight === expected.subHeight &&
        palette.length === expected.palette.length &&
        palette.every((v, i) => v === expected.palette[i]) &&
        pixels.length === expected.pixels.length &&
        pixels.every((v, i) => v === expected.pixels[i]);
    if (!same) {
        throw new Error(
            `indexed-sprite-dat: mismatch\nactual=${JSON.stringify(
                {
                    width: sprite.width,
                    height: sprite.height,
                    xOffset: sprite.xOffset,
                    yOffset: sprite.yOffset,
                    subWidth: sprite.subWidth,
                    subHeight: sprite.subHeight,
                    palette,
                    pixels,
                },
                null,
                2,
            )}\nexpected=${JSON.stringify(expected, null, 2)}`,
        );
    }
}

function checkVarBitType(): void {
    const dir = path.join(FIXTURES_DIR, "varbit-type");
    const bytes = readFileBytes(path.join(dir, "input.bin"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as {
        baseVar: number;
        startBit: number;
        endBit: number;
    };

    const cacheInfo = new CacheInfo("fixtures", GameType.Runescape, "live", 999, "n/a", 0);
    const type = new VarBitType(0, cacheInfo);
    type.decode(new ByteBuffer(bytes));

    const actual = { baseVar: type.baseVar, startBit: type.startBit, endBit: type.endBit };
    if (
        actual.baseVar !== expected.baseVar ||
        actual.startBit !== expected.startBit ||
        actual.endBit !== expected.endBit
    ) {
        throw new Error(`varbit-type: mismatch\nactual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
}

function checkModelV1Empty(): void {
    const dir = path.join(FIXTURES_DIR, "model-v1-empty");
    const bytes = readFileBytes(path.join(dir, "input.bin"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as {
        version: number;
        verticesCount: number;
        faceCount: number;
        textureFaceCount: number;
        priority: number;
    };

    const model = ModelData.decode(bytes);
    const actual = {
        version: model.version,
        verticesCount: model.verticesCount,
        faceCount: model.faceCount,
        textureFaceCount: model.textureFaceCount,
        priority: model.priority,
    };

    if (
        actual.version !== expected.version ||
        actual.verticesCount !== expected.verticesCount ||
        actual.faceCount !== expected.faceCount ||
        actual.textureFaceCount !== expected.textureFaceCount ||
        actual.priority !== expected.priority
    ) {
        throw new Error(`model-v1-empty: mismatch\nactual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
}

function checkModelV2Triangle(): void {
    const dir = path.join(FIXTURES_DIR, "model-v2-tri");
    const bytes = readFileBytes(path.join(dir, "input.bin"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as {
        version: number;
        verticesCount: number;
        faceCount: number;
        indices1: number[];
        indices2: number[];
        indices3: number[];
        faceColors: number[];
    };

    const model = ModelData.decode(bytes);
    const actual = {
        version: model.version,
        verticesCount: model.verticesCount,
        faceCount: model.faceCount,
        indices1: Array.from(model.indices1),
        indices2: Array.from(model.indices2),
        indices3: Array.from(model.indices3),
        faceColors: Array.from(model.faceColors),
    };

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`model-v2-tri: mismatch\nactual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
}

function checkDat2SeqFrameMinimal(): void {
    const dir = path.join(FIXTURES_DIR, "dat2-seqframe-min");
    const bytes = readFileBytes(path.join(dir, "input.bin"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as {
        transformCount: number;
        transformGroups: number[];
        transformX: number[];
        transformY: number[];
        transformZ: number[];
        resetOriginGroups: number[];
        hasAlphaTransform: boolean;
        hasColorTransform: boolean;
    };

    const cacheInfo = new CacheInfo("fixtures", GameType.Runescape, "live", 1, "n/a", 0);
    const base = new SeqBase(
        0,
        1,
        [SeqTransformType.TRANSLATE],
        [true],
        new Uint16Array([0xffff]),
        [[]],
    );
    const baseLoader = {
        tryLoad: (_id: number) => {
            throw new Error("not used");
        },
        tryGet: (id: number) => (id === 0 ? base : undefined),
        clearCache: () => {},
    };

    const frame = Dat2SeqFrame.tryLoad(cacheInfo, baseLoader, bytes);
    if (!frame) {
        throw new Error("dat2-seqframe-min: failed decoding frame");
    }

    const actual = {
        transformCount: frame.transformCount,
        transformGroups: frame.transformGroups,
        transformX: frame.transformX,
        transformY: frame.transformY,
        transformZ: frame.transformZ,
        resetOriginGroups: frame.resetOriginGroups,
        hasAlphaTransform: frame.hasAlphaTransform,
        hasColorTransform: frame.hasColorTransform,
    };

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`dat2-seqframe-min: mismatch\nactual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
}

function checkDat2SeqFrameNonTrivial(): void {
    const dir = path.join(FIXTURES_DIR, "dat2-seqframe-nontrivial");
    const bytes = readFileBytes(path.join(dir, "input.bin"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as {
        transformCount: number;
        transformGroups: number[];
        transformX: number[];
        transformY: number[];
        transformZ: number[];
        resetOriginGroups: number[];
        hasAlphaTransform: boolean;
        hasColorTransform: boolean;
    };

    const cacheInfo = new CacheInfo("fixtures", GameType.Runescape, "live", 1, "n/a", 0);
    const base = new SeqBase(
        0,
        4,
        [SeqTransformType.ORIGIN, SeqTransformType.TRANSLATE, SeqTransformType.ROTATE, SeqTransformType.ALPHA],
        [true, true, true, true],
        new Uint16Array([0xffff, 0xffff, 0xffff, 0xffff]),
        [[], [], [], []],
    );
    const baseLoader = {
        tryLoad: (_id: number) => {
            throw new Error("not used");
        },
        tryGet: (id: number) => (id === 0 ? base : undefined),
        clearCache: () => {},
    };

    const frame = Dat2SeqFrame.tryLoad(cacheInfo, baseLoader, bytes);
    if (!frame) {
        throw new Error("dat2-seqframe-nontrivial: failed decoding frame");
    }

    const actual = {
        transformCount: frame.transformCount,
        transformGroups: frame.transformGroups,
        transformX: frame.transformX,
        transformY: frame.transformY,
        transformZ: frame.transformZ,
        resetOriginGroups: frame.resetOriginGroups,
        hasAlphaTransform: frame.hasAlphaTransform,
        hasColorTransform: frame.hasColorTransform,
    };

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `dat2-seqframe-nontrivial: mismatch\nactual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
        );
    }
}

function main(): void {
    checkXtea();
    checkSectorChain();
    checkArchiveSplit();
    checkIndexedSpriteDat();
    checkVarBitType();
    checkModelV1Empty();
    checkModelV2Triangle();
    checkDat2SeqFrameMinimal();
    checkDat2SeqFrameNonTrivial();
    console.log("OK: cache fixtures");
}

main();
