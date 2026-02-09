import assert from "node:assert/strict";
import fs from "node:fs";

import { detectCacheType } from "../../src/rs/cache/CacheType";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { tryCreateCacheSessionFromSystem } from "../../src/rs/runtime/createCacheSession";
import type { XteaKey } from "../../src/rs/crypto/Xtea";
import type { LoadedCache } from "../../src/util/Caches";
import { loadCacheFiles, loadCacheInfos } from "./load-util";

type Case = {
    cache: string;
    label: string;
    game: string;
    revision: number;
    expectedTs: {
        cacheType: "dat2" | "dat" | "legacy";
        hasQuestTypeLoader: boolean;
        hasSkeletalSeqLoader: boolean;
        hasDistinctUnderlayTypeLoader: boolean;
        hasModelService: boolean;
        hasSeqFrameService: boolean;
        hasTextureService: boolean;
        hasMapFileService: boolean;
    };
    expectedCpp?: {
        cacheType: "dat2" | "dat" | "legacy";
        hasQuestTypeLoader: boolean;
        hasSkeletalSeqLoader: boolean;
        hasDistinctUnderlayTypeLoader: boolean;
        hasModelService?: boolean;
        hasSeqFrameService?: boolean;
        hasTextureService?: boolean;
        hasMapFileService?: boolean;
    };
};

function loadCases(): Case[] {
    const raw = fs.readFileSync("./scripts/cache/session-contract.cases.json", "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.cases)) {
        throw new Error("Invalid session-contract.cases.json: missing cases");
    }
    return parsed.cases as Case[];
}

const CASES: Case[] = loadCases();

function getCacheInfoByName(name: string) {
    const infos = loadCacheInfos();
    const info = infos.find((v) => v.name === name);
    if (!info) {
        throw new Error(`Cache not found in caches/caches.json: ${name}`);
    }
    return info;
}

function runCase(c: Case): void {
    const info = getCacheInfoByName(c.cache);
    const type = detectCacheType(info);
    const bundle = loadCacheFiles(info);
    const compression = new JSCompressionHandler();
    const cacheSystem = createCacheSystemFromFiles(type, bundle, compression);

    const loadedCache: LoadedCache = {
        info,
        type,
        bundle,
        xteas: new Map<number, XteaKey>(),
    };

    const sessionResult = tryCreateCacheSessionFromSystem(loadedCache, cacheSystem);
    if (!sessionResult.ok) {
        throw new Error(initErrorToString(sessionResult.error));
    }
    const session = sessionResult.value;

    assert.equal(session.loaders.capabilities.cacheType, type, `${c.label}: cacheType capability mismatch`);
    assert.equal(
        c.expectedTs.cacheType,
        c.label,
        `${c.label}: fixture label/cacheType mismatch`,
    );
    assert.equal(
        session.loaders.capabilities.hasQuestTypeLoader,
        c.expectedTs.hasQuestTypeLoader,
        `${c.label}: quest capability mismatch`,
    );
    assert.equal(
        session.loaders.capabilities.hasSkeletalSeqLoader,
        c.expectedTs.hasSkeletalSeqLoader,
        `${c.label}: skeletal capability mismatch`,
    );
    assert.equal(
        session.loaders.capabilities.hasDistinctUnderlayTypeLoader,
        c.expectedTs.hasDistinctUnderlayTypeLoader,
        `${c.label}: underlay distinction capability mismatch`,
    );

    assert.equal(
        session.mapFileIndex,
        session.loaders.mapFileLoader.mapFileIndex,
        `${c.label}: mapFileIndex must mirror loaders.mapFileLoader.mapFileIndex`,
    );
    assert.equal(
        !!session.getTextureLoader(),
        c.expectedTs.hasTextureService,
        `${c.label}: texture service availability mismatch`,
    );
    assert.equal(
        !!session.getSeqFrameLoader(),
        c.expectedTs.hasSeqFrameService,
        `${c.label}: seq frame service availability mismatch`,
    );
    assert.equal(
        !!session.getModelLoader(),
        c.expectedTs.hasModelService,
        `${c.label}: model service availability mismatch`,
    );
    assert.equal(
        !!session.getMapFileLoader(),
        c.expectedTs.hasMapFileService,
        `${c.label}: map file service availability mismatch`,
    );

    session.clearCaches();

    const forkResult = session.tryFork();
    if (!forkResult.ok) {
        throw new Error(initErrorToString(forkResult.error));
    }
    const fork = forkResult.value;
    assert.deepEqual(
        fork.loaders.capabilities,
        session.loaders.capabilities,
        `${c.label}: fork capabilities mismatch`,
    );
}

function main(): void {
    for (const c of CASES) {
        runCase(c);
    }
    console.log(`session-contract: ok (${CASES.length} cases)`);
}

main();
