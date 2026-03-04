# TS <-> C++ Map-Render Module Map (Target: 1:1 Mental Model)

This doc tracks how the TS "scene -> command-plan -> command-stream -> packet" pipeline maps to the C++ runtime/wasm implementation.

Goal: keep file/function boundaries comparable so parity issues can be chased at the function level.

## Core Pipeline (TS is the spec)

-   Scene decode/build (terrain + loc placements + collision + lighting)

    -   TS: `src/rs/scene/SceneBuildStages.ts`, `src/rs/scene/buildSceneFromMapBytesProvider.ts`, `src/rs/scene/SceneBuilder.ts`
    -   C++: `cpp/rs/scene/SceneBuildStages.cpp`, `cpp/rs/scene/BuildSceneFromMapBytesProvider.cpp`
    -   Deviation: C++ uses a bytes-first runtime build entry; TS uses loader objects.

-   Scene buffer + command plan

    -   TS: `src/renderer/buffer/SceneBuffer.ts`, `src/renderer/buffer/SceneCommandPlan.ts`
    -   C++: `cpp/rs/render/SceneBuffer.cpp`, `cpp/rs/render/SceneCommandPlan.cpp`
    -   Good: there is already explicit plan logic on both sides.

-   Command-stream/buckets + packed render payload

    -   TS: `src/renderer/buffer/SceneCommandBuilder.ts`, `src/worker/MapRenderDataContract.ts`
    -   C++: `cpp/rs/render/SceneCommandBuilder.cpp`, `cpp/rs/render/SceneCommandPack.cpp`

-   Runtime cache-v2 + build entry
    -   TS: `src/worker/MapRenderDataBackend.ts` (uploads bytes + types + varps, requests build)
    -   C++ (wasm tool): `cpp/tools/rs_map_render_backend.cpp`, `cpp/tools/MapRenderRuntimeBuildMapBody.inl`
    -   Deviation: the wasm tool file is a monolith; TS is split across multiple modules.

## Known Biggest Deviations (Fix Targets)

1. `cpp/tools/rs_map_render_backend.cpp` is a single large TU with many responsibilities.

    - Fix direction: extract sections into TS-shaped `cpp/tools/*.inl` modules first, then to `.cpp/.hpp` as needed.

2. Cross-boundary array layouts are not consistently documented/enforced.

    - Fix direction: declare TS layout as canonical at the bridge boundary and enforce it in wasm exports.
    - Example fixed: collision flags are now exposed in TS order (y-major) for debug/parity.

3. Collision semantics are not yet a first-class core module in C++ (TS has `CollisionMap.ts`).

    - Fix direction: introduce a core collision helper/module that mirrors TS operations (blocked-by-floor, addLoc, addWall)
      and use it in runtime build (not a bridge-only helper).

4. Runtime services/type resolution seams differ.
    - TS uses loader object graph (`SceneBuilder` + loaders).
    - C++ uses type blobs + `rs_scene_types_init` seam.
    - Fix direction: keep the bytes-driven runtime as the production seam, but ensure the internal "stage" functions match
      TS stage boundaries and can be debugged/diffed 1:1.

## Immediate Next Refactors (Low Risk)

-   Extract `cpp/tools/rs_map_render_backend.cpp` helpers into small `.inl` files:

    -   collision compute (`MapRenderRuntimeCollision.inl`) (done)
    -   debug exports group
    -   tick-state group
    -   cache-v2 upload group
    -   packet build/release group

-   Add a short "layout contract" note to `docs/wasm-bridge-v2.md` for each array that crosses TS<->wasm:
    -   collision flags: `idx = x + y*sizeX` per level
    -   tileRenderFlagsLevel1: flattened x-major `idx = x*height + y`
