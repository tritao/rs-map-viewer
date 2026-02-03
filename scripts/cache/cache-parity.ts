import fs from "fs";
import path from "path";

import xxhash from "xxhash-wasm";

import { loadCacheFiles, loadCacheInfos } from "./load-util";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { CacheType, detectCacheType, getCacheTypeName } from "../../src/rs/cache/CacheType";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { readAllBytes } from "../../src/rs/io/ByteSourceUtil";
import { Uint8ArrayByteSource } from "../../src/rs/io/Uint8ArrayByteSource";
import { Container } from "../../src/rs/cache/format/Container";
import { Archive } from "../../src/rs/cache/format/Archive";
import { DatIndexType } from "../../src/rs/cache/IndexType";

type Args = {
    cacheName?: string;
    outPath?: string;
    maxIndices: number;
    maxArchivesPerIndex: number;
    indices?: number[];
};

type HashInfo = { len: number; xxh64: string };
type ParityFileEntry = { fileId: number; len: number; xxh64: string };
type ParityEntry = {
    indexId: number;
    archiveId: number;
    raw: HashInfo;
    containerPayload?: HashInfo;
    files?: ParityFileEntry[];
};

function parseArgs(argv: string[]): Args {
    const args: Args = {
        maxIndices: 5,
        maxArchivesPerIndex: 200,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") {
            args.cacheName = argv[++i];
        } else if (a === "--out") {
            args.outPath = argv[++i];
        } else if (a === "--maxIndices") {
            args.maxIndices = parseInt(argv[++i], 10);
        } else if (a === "--maxArchives") {
            args.maxArchivesPerIndex = parseInt(argv[++i], 10);
        } else if (a === "--indices") {
            const raw = argv[++i] ?? "";
            args.indices = raw
                .split(",")
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n));
        }
    }

    return args;
}

function h64Hex(v: bigint): string {
    return v.toString(16).padStart(16, "0");
}

function ensureDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const caches = loadCacheInfos();
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("No caches found");
    }

    const cacheInfo: CacheInfo =
        args.cacheName ? caches.find((c) => c.name === args.cacheName) ?? latest : latest;

    const cacheType = detectCacheType(cacheInfo);
    const cacheBundle = loadCacheFiles(cacheInfo);

    const compressionHandler = new JSCompressionHandler();
    const cacheSystem = createCacheSystemFromFiles(cacheType, cacheBundle, compressionHandler);

    const hashApi = await xxhash();

    const indexIds = (Array.from(cacheSystem.indices.keys()) as number[]).sort((a, b) => a - b);
    const selectedIndexIds = (args.indices && args.indices.length > 0 ? args.indices : indexIds).slice(
        0,
        args.maxIndices,
    );

    const entries: ParityEntry[] = [];

    for (const indexId of selectedIndexIds) {
        if (!cacheSystem.indexExists(indexId)) {
            continue;
        }

        const index = cacheSystem.getIndex(indexId);
        const selectedArchiveIds: number[] = Array.from(index.getArchiveIds())
            .sort((a, b) => a - b)
            .slice(0, args.maxArchivesPerIndex);

        // Only Dat/Dat2 indices are store-backed in this harness.
        const store: unknown = (index as any).store;
        if (!store) {
            continue;
        }

        for (const archiveId of selectedArchiveIds) {
            const rawSource = (store as any).openArchiveReader(indexId, archiveId);
            if (rawSource.size === 0) {
                continue;
            }

            const raw = readAllBytes(rawSource);
            if (raw.byteLength === 0) {
                continue;
            }
            const rawHash = h64Hex(hashApi.h64Raw(raw));

            const entry: ParityEntry = {
                indexId,
                archiveId,
                raw: { len: raw.byteLength, xxh64: rawHash },
            };

            if (cacheType === CacheType.Dat2) {
                const container = Container.decodeFromSource(
                    new Uint8ArrayByteSource(raw),
                    null,
                    compressionHandler,
                );
                entry.containerPayload = {
                    len: container.data.byteLength,
                    xxh64: h64Hex(hashApi.h64Raw(container.data)),
                };

                const archiveRef = index.getArchiveReference(archiveId);
                if (archiveRef) {
                    const archive = Archive.decodeFromSource(archiveRef, new Uint8ArrayByteSource(container.data));
                    entry.files = archive.files
                        .map((f) => ({
                            fileId: f.id,
                            len: f.data.byteLength,
                            xxh64: h64Hex(hashApi.h64Raw(f.data)),
                        }))
                        .sort((a, b) => a.fileId - b.fileId);
                }
            } else if (cacheType === CacheType.Dat) {
                const multipleFiles = indexId === DatIndexType.configs;
                let archive: Archive;
                try {
                    archive = Archive.decodeOld(archiveId, raw, multipleFiles, compressionHandler);
                } catch {
                    // Some dat indices contain empty/truncated entries; skip them.
                    continue;
                }
                entry.files = archive.files
                    .map((f) => ({
                        fileId: f.id,
                        len: f.data.byteLength,
                        xxh64: h64Hex(hashApi.h64Raw(f.data)),
                    }))
                    .sort((a, b) => a.fileId - b.fileId);
            }

            entries.push(entry);
        }
    }

    const outPath =
        args.outPath ??
        path.join("caches", cacheInfo.name, `parity-${getCacheTypeName(cacheType)}.json`);
    ensureDir(outPath);

    const out = {
        schema: 1,
        cache: {
            name: cacheInfo.name,
            revision: cacheInfo.revision,
            timestamp: cacheInfo.timestamp,
            type: getCacheTypeName(cacheType),
        },
        selection: {
            indices: selectedIndexIds,
            maxArchivesPerIndex: args.maxArchivesPerIndex,
        },
        entries,
    };

    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${entries.length} entries to ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
