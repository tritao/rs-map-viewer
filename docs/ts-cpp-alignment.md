# TS <-> C++ Alignment Notes (Portability + 1:1 Debugging)

This repo treats TS as the spec for scene build and render-command generation. The goal of the C++ port is:

-   File/function-level correspondence where practical.
-   Stable parity hooks that diff the same intermediate products (plan, digests, command-stream), not just final pixels.
-   Minimal JS/TS bridge logic (TS should orchestrate; C++ should own the heavy build/runtime work).

## Current Mapping (Intentional)

### Scene Build (map bytes -> scene state)

-   TS: `src/rs/scene/buildSceneFromMapBytesProvider.ts`
    -   C++: `cpp/rs/scene/BuildSceneFromMapBytesProvider.{hpp,cpp}`
-   TS: `src/rs/scene/SceneBuilder.ts`
    -   C++: `cpp/rs/scene/SceneBuildStages.{hpp,cpp}` (staged decode/fill/finalize)
-   TS: `src/rs/scene/SceneRuntimeServices.ts`
    -   C++: `cpp/rs/scene/SceneRuntimeServices.hpp`
-   TS: `src/rs/scene/Scene.ts` / `SceneTile.ts` / decode helpers
    -   C++: `cpp/rs/scene/SceneData.hpp` + `cpp/rs/map/*Decode*`

### Render Command Generation (scene -> vertices/indices + draw commands)

-   TS: `src/renderer/buffer/SceneBuffer.ts`
    -   C++: `cpp/rs/render/SceneBuffer.{hpp,cpp}`
-   TS: `src/renderer/buffer/SceneCommandPlan.ts` (merge/instance planning)
    -   C++: implemented as debug-plan ops/digests inside `cpp/rs/render/LocEmit.cpp` and `cpp/rs/render/SceneCommandBuilder.*`
-   TS: `src/renderer/buffer/SceneCommandBuilder.ts` (runtime pack: cmd arrays + model-info textures)
    -   C++: `cpp/rs/render/RuntimeCommandStreamPlan.{hpp,cpp}` + `cpp/rs/render/SceneCommandPack.{hpp,cpp}`

### Worker/Runtime/WASM (cache, lifecycle, packets)

-   TS: `src/worker/*` + `src/wasm/*bridge*`
    -   C++: `cpp/tools/rs_map_render_backend.cpp` + `cpp/tools/MapRenderRuntime*` headers/inls

## Biggest Deviations (What To Fix Next)

1. `cpp/tools/rs_map_render_backend.cpp` is still a monolith.

    - TS has distinct modules for cache upload, build, tick-state, debug/probes.
    - C++ should split the tool backend into focused `MapRenderRuntime*.inl` sections (no behavior change), mirroring TS boundaries.

2. Naming collisions around "SceneCommandPlan".

    - TS `SceneCommandPlan.ts` is merge/instance planning.
    - C++ previously had `SceneCommandPlan.*` for runtime packing (draw ranges + model info textures), which is not the TS meaning.
    - Fixed by renaming the C++ runtime-packing plan to `RuntimeCommandStreamPlan`.

3. Cross-boundary flattened-array layouts are easy to get wrong.
    - Rule: TS layout is canonical at the bridge boundary (e.g. collision flags y-major `x + y*sizeX`).
    - C++ may keep internal layouts, but exports/debug arrays must match TS contracts.

## Recommended Near-Term Plan (Ordered)

1. Keep TS as the spec; do not refactor TS unless it clarifies the spec boundary.
2. Reshape C++ `cpp/tools/rs_map_render_backend.cpp` into `MapRenderRuntime*.inl` modules:
    - cache v2 put/get
    - runtime build map packet
    - tick-state pack/unpack/advance
    - debug exports
3. Continue layout audits for any exported flattened arrays (collision done; do the same for any other debug/export buffers).
4. Only after the above: consider extracting the TS `SceneCommandPlan` planner into a first-class C++ module (plan vs execute parity).
