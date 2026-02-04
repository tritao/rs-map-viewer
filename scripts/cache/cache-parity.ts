import fs from "fs";
import path from "path";

import xxhash from "xxhash-wasm";

import { loadCacheFiles, loadCacheInfos } from "./load-util";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { CacheType, detectCacheType, getCacheTypeName } from "../../src/rs/cache/CacheType";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { Uint8ArrayByteSource } from "../../src/rs/io/Uint8ArrayByteSource";
import { Archive } from "../../src/rs/cache/format/Archive";
import { DatIndexId, LegacyIndexId } from "../../src/rs/cache/IndexId";

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

function bytesOf(buffer: ArrayBuffer | undefined): Uint8Array {
    return buffer ? new Uint8Array(buffer) : new Uint8Array(0);
}

function legacyRawArchiveBytes(
    bundle: any,
    indexId: number,
    archiveId: number,
): Uint8Array | null {
    const legacy = bundle?.legacy;
    if (!legacy) return null;

    if (archiveId !== 0 && indexId !== LegacyIndexId.maps) {
        return null;
    }

    switch (indexId) {
        case LegacyIndexId.configs:
            return bytesOf(legacy.config);
        case LegacyIndexId.media:
            return bytesOf(legacy.media);
        case LegacyIndexId.textures:
            return bytesOf(legacy.textures);
        case LegacyIndexId.models:
            return bytesOf(legacy.models);
        case LegacyIndexId.maps: {
            const maps: ArrayBuffer[] = legacy.maps ?? [];
            if (archiveId < 0 || archiveId >= maps.length) return null;
            return bytesOf(maps[archiveId]);
        }
        default:
            return null;
    }
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

        for (const archiveId of selectedArchiveIds) {
            let raw: Uint8Array;

            // Dat/Dat2 indices are store-backed; Legacy indices are decoded up-front (no store).
            const store: unknown = (index as any).store;
            if (store) {
                raw = index.readArchiveBytes(archiveId);
                if (raw.byteLength === 0) {
                    continue;
                }
            } else {
                const legacyRaw = legacyRawArchiveBytes(cacheBundle, indexId, archiveId);
                if (!legacyRaw || legacyRaw.byteLength === 0) {
                    continue;
                }
                raw = legacyRaw;
            }
            const rawHash = h64Hex(hashApi.h64Raw(raw));

            const entry: ParityEntry = {
                indexId,
                archiveId,
                raw: { len: raw.byteLength, xxh64: rawHash },
            };

            if (cacheType === CacheType.Dat2) {
                const payload = index.readContainerPayload(archiveId, null);
                entry.containerPayload = { len: payload.byteLength, xxh64: h64Hex(hashApi.h64Raw(payload)) };

                const archiveRef = index.getArchiveReference(archiveId);
                if (archiveRef) {
                    const archive = Archive.decodeFromSource(archiveRef, new Uint8ArrayByteSource(payload));
                    entry.files = archive.files
                        .map((f) => ({
                            fileId: f.id,
                            len: f.data.byteLength,
                            xxh64: h64Hex(hashApi.h64Raw(f.data)),
                        }))
                        .sort((a, b) => a.fileId - b.fileId);
                }
            } else if (cacheType === CacheType.Dat) {
                const multipleFiles = indexId === DatIndexId.configs;
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
            } else {
                // Legacy/Classic: cacheSystem already contains decoded Archives.
                const archive = index.getArchive(archiveId);
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
