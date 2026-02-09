# C++ cache/io parity (Milestone A)

This folder contains a C++20, non-streaming parity tool for the `src/rs` cache + I/O layer.

## Build

From repo root:

-   `cmake -S cpp -B cpp/build`
-   `cmake --build cpp/build -j`

## Run

`rs_cli parity` auto-detects cache layout by files present (dat2 / dat / legacy).

Example (dat2 / OSRS):

-   `./cpp/build/rs_cli parity --cache osrs-221_2024-04-17 --indices 0 --maxIndices 1 --maxArchives 10 --out /tmp/parity-cpp.json`

Example (dat / older RS2):

-   `./cpp/build/rs_cli parity --cache rs2-377_2006-05-02 --maxIndices 5 --maxArchives 50 --out /tmp/parity-cpp.json`

Example (legacy bundle):

-   `./cpp/build/rs_cli parity --cache rs2-225_2004-05-06 --maxIndices 5 --maxArchives 50 --out /tmp/parity-cpp.json`

Compare against the TS implementation:

-   `npm run -s cache:parity -- --cache osrs-221_2024-04-17 --indices 0 --maxIndices 1 --maxArchives 10 --out /tmp/parity-ts.json`
-   `npm run -s cache:parity-compare -- --a /tmp/parity-ts.json --b /tmp/parity-cpp.json`

Model decode parity (dat2/dat/legacy):

-   `npm run -s rs:model-parity -- --cache osrs-221_2024-04-17 --limit 40`
-   `npm run -s rs:model-status-parity -- --cache osrs-221_2024-04-17 --limit 40`

Animation + transform parity:

-   `npm run -s rs:seqframe-parity -- --cache osrs-221_2024-04-17 --limit 40`
-   `npm run -s rs:seqtype-frame-length-parity -- --cache osrs-221_2024-04-17 --limit 30 --maxFrames 20`
-   `npm run -s rs:anim-selection-parity -- --cache osrs-221_2024-04-17 --npcLimit 20 --locLimit 20 --maxFrames 8`
-   `npm run -s rs:transform-parity -- --cache osrs-221_2024-04-17 --npcLimit 20 --locLimit 20 --maxSteps 8`
-   `npm run -s rs:skeletal-seq-parity -- --cache osrs-221_2024-04-17 --limit 30`
-   `npm run -s rs:skeletal-eval-parity -- --cache osrs-221_2024-04-17 --limit 20 --maxFrames 8`
-   `npm run -s rs:skeletal-model-parity -- --cache osrs-221_2024-04-17 --limit 20 --maxFrames 4`

End-to-end C++ pre-merge parity sweep:

-   `npm run -s rs:cpp-premerge`

## Session/loader parity checklist

-   Use `CacheSession` facade accessors at call sites (`tryGet*`, `textureMode`, `tryGetTexturePixelsArgb`) instead of reaching into tagged loader storage directly.
-   Prefer `CacheSession` service accessors for archive/index operations (`tryGetMapIndex`, `tryGetMapArchiveId`, `tryGetMapArchive*`, `tryGetModelsIndex`, `tryGetSeqFramesIndex`, `tryGetSpritesIndex`).
-   Keep loader capabilities and session capabilities aligned (`hasQuestTypeLoader`, `hasSkeletalSeqLoader`, `hasDistinctUnderlayTypeLoader`).
-   Keep Dat2 vs Dat/Legacy config dispatch behind `CacheSession` methods, matching TS session contract intent.

## Approved facade names

-   Capabilities: `hasQuestTypeLoader`, `hasSkeletalSeqLoader`, `hasDistinctUnderlayTypeLoader`.
-   Config access: `tryGetLocType`, `tryGetNpcType`, `tryGetObjType`, `tryGetSeqType`, `tryGetVarBitType`, `tryGetOverlayFloorType`, `tryGetUnderlayFloorType`, `tryGetQuestType`.
-   Rules/defaults: `tryGetCacheRules`, `tryGetMapRules`, `tryGetTextureRules`, `tryGetGraphicsDefaults`.
-   Services/indexes: `tryGetIndex`, `tryGetArchive`, `tryGetArchiveKey`, `tryGetMapIndex`, `tryGetMapArchiveId`, `tryGetMapArchive`, `tryGetMapArchiveKey`, `tryGetModelsIndex`, `tryGetSeqFramesIndex`, `tryGetSpritesIndex`.
-   Textures: `textureMode`, `textureStatus`, `tryGetTexturePixelsArgb`, `tryGetProceduralTextureLoader`.

## Wasm build (library-only)

This is a build-only target (no TS/Wasm FFI yet). It exists to ensure the `rs` core compiles under Emscripten and produces a static library suitable for later linking.

-   `bash cpp/tools/build-wasm.sh`

Artifacts:

-   `cpp/build-wasm/librs.a`

Optional smoke executable wrapper (disabled by default):

-   `BUILD_DIR=cpp/build-wasm-smoke bash -c 'emcmake cmake -S cpp -B cpp/build-wasm-smoke -DCMAKE_BUILD_TYPE=Release -DRS_BUILD_WASM_SMOKE=ON && cmake --build cpp/build-wasm-smoke -j'`
-   `cpp/build-wasm-smoke/rs_wasm_smoke.wasm`
-   `cpp/build-wasm-smoke/rs_wasm_smoke.js`
