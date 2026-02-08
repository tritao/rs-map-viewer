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

## Wasm build (library-only)

This is a build-only target (no TS/Wasm FFI yet). It exists to ensure the `rs` core compiles under Emscripten and produces a static library suitable for later linking.

-   `bash cpp/tools/build-wasm.sh`

Artifacts:

-   `cpp/build-wasm/librs.a`

Optional smoke executable wrapper (disabled by default):

-   `BUILD_DIR=cpp/build-wasm-smoke bash -c 'emcmake cmake -S cpp -B cpp/build-wasm-smoke -DCMAKE_BUILD_TYPE=Release -DRS_BUILD_WASM_SMOKE=ON && cmake --build cpp/build-wasm-smoke -j'`
-   `cpp/build-wasm-smoke/rs_wasm_smoke.wasm`
-   `cpp/build-wasm-smoke/rs_wasm_smoke.js`
