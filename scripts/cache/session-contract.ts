import assert from "node:assert/strict";
import fs from "node:fs";

import { CacheType, detectCacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId, DatIndexId, LegacyIndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { initErrorToString } from "../../src/rs/loaders/InitError";
import { computeCacheRules } from "../../src/rs/loaders/CacheRules";
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
        rules?: {
            isIndexConfigs: boolean;
            textureMode: "sprite" | "materials" | "old_procedural" | "dat";
            textureHasAlphaMaterialField: boolean;
            textureHasAlphaOperation: boolean;
            mapScenesMode: "archive" | "graphics_defaults";
            mapFunctionsMode: "osrs_archive" | "rs2_archive" | "graphics_defaults";
        };
        indexes?: {
            map: { present: boolean };
            models: { present: boolean };
            seqFrames: { present: boolean };
            sprites: { present: boolean };
        };
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

    if (c.expectedTs.rules) {
        const rules = computeCacheRules(info, cacheSystem);
        assert.equal(
            rules.isIndexConfigs,
            c.expectedTs.rules.isIndexConfigs,
            `${c.label}: rules.isIndexConfigs mismatch`,
        );
        if (rules.texture.mode === "sprite") {
            assert.equal(c.expectedTs.rules.textureMode, "sprite", `${c.label}: rules.textureMode mismatch`);
            assert.equal(
                c.expectedTs.rules.textureHasAlphaMaterialField,
                false,
                `${c.label}: rules.textureHasAlphaMaterialField mismatch`,
            );
            assert.equal(
                c.expectedTs.rules.textureHasAlphaOperation,
                false,
                `${c.label}: rules.textureHasAlphaOperation mismatch`,
            );
        } else if (rules.texture.mode === "materials") {
            assert.equal(c.expectedTs.rules.textureMode, "materials", `${c.label}: rules.textureMode mismatch`);
            assert.equal(
                c.expectedTs.rules.textureHasAlphaMaterialField,
                rules.texture.hasAlphaMaterialField,
                `${c.label}: rules.textureHasAlphaMaterialField mismatch`,
            );
            assert.equal(
                c.expectedTs.rules.textureHasAlphaOperation,
                rules.texture.hasAlphaOperation,
                `${c.label}: rules.textureHasAlphaOperation mismatch`,
            );
        } else if (rules.texture.mode === "old_procedural") {
            assert.equal(
                c.expectedTs.rules.textureMode,
                "old_procedural",
                `${c.label}: rules.textureMode mismatch`,
            );
            assert.equal(
                c.expectedTs.rules.textureHasAlphaMaterialField,
                false,
                `${c.label}: rules.textureHasAlphaMaterialField mismatch`,
            );
            assert.equal(
                c.expectedTs.rules.textureHasAlphaOperation,
                false,
                `${c.label}: rules.textureHasAlphaOperation mismatch`,
            );
        }
        assert.equal(
            c.expectedTs.rules.mapScenesMode,
            rules.mapScenes.mode,
            `${c.label}: rules.mapScenesMode mismatch`,
        );
        assert.equal(
            c.expectedTs.rules.mapFunctionsMode,
            rules.mapFunctions.mode,
            `${c.label}: rules.mapFunctionsMode mismatch`,
        );
    }

    if (c.expectedTs.indexes) {
        const mapIndexId =
            type === CacheType.Dat2
                ? Dat2IndexId.maps
                : type === CacheType.Dat
                  ? DatIndexId.maps
                  : LegacyIndexId.maps;
        const modelsIndexId =
            type === CacheType.Dat2
                ? Dat2IndexId.models
                : type === CacheType.Dat
                  ? DatIndexId.models
                  : LegacyIndexId.models;
        const seqFramesIndexId =
            type === CacheType.Dat2
                ? Dat2IndexId.animations
                : type === CacheType.Dat
                  ? DatIndexId.animations
                  : LegacyIndexId.models;

        assert.equal(
            !!session.tryGetIndex(mapIndexId),
            c.expectedTs.indexes.map.present,
            `${c.label}: indexes.map.present mismatch`,
        );
        assert.equal(
            !!session.tryGetIndex(modelsIndexId),
            c.expectedTs.indexes.models.present,
            `${c.label}: indexes.models.present mismatch`,
        );
        assert.equal(
            !!session.tryGetIndex(seqFramesIndexId),
            c.expectedTs.indexes.seqFrames.present,
            `${c.label}: indexes.seqFrames.present mismatch`,
        );
        const spritesPresent = type === CacheType.Dat2 ? !!session.tryGetIndex(Dat2IndexId.sprites) : false;
        assert.equal(
            spritesPresent,
            c.expectedTs.indexes.sprites.present,
            `${c.label}: indexes.sprites.present mismatch`,
        );
    }

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
