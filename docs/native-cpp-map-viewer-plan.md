# Native C++ Map Viewer Plan

## Goal

Build a desktop native C++ map viewer where C++ owns cache ingest, scene/runtime state, command generation, tick/animation, and rendering.

## Current state (baseline)

1. C++ already owns byte-driven map runtime and command generation:
   `cpp/tools/rs_map_render_backend.cpp`, `cpp/rs/render/SceneCommandBuilder.cpp`.
2. TS still owns app shell and WebGL renderer:
   `src/mapviewer/MapViewerRenderer.ts`, `src/renderer/webgl/WebGLMapRenderer.ts`.
3. Worker path is still hybrid and uses TS fallback/scaffold:
   `src/worker/MapRenderDataBackend.ts`.
4. Scene cpp-wasm path is removed and falls back to TS:
   `src/worker/SceneBuildBackend.ts`.

## Principles

1. One runtime authority for production: C++.
2. TS parity paths stay for testing only.
3. Bridge/API should be minimal and typed.
4. Every milestone has measurable acceptance gates.

## Milestone M0: Stabilize native-facing C++ runtime API

### Scope

Define a C++ API that does not depend on wasm exports and can be used by both desktop native app and wasm bridge wrappers.

### Tasks

1. Introduce a runtime API header+impl in `cpp/rs/render` (create/destroy/reset, cache put, build map packet, tick patch output).
2. Refactor `cpp/tools/rs_map_render_backend.cpp` to call that API rather than owning logic directly.
3. Keep wasm exports as thin adapters only.
4. Add C++ unit tests for runtime lifecycle and build determinism.

### Exit criteria

1. `rs_map_render_backend.cpp` is mostly marshalling.
2. Runtime lifecycle and build tests pass from native C++ tests.

## Milestone M1: Native desktop shell with static map render

### Scope

Create a native desktop viewer that renders static map geometry from C++ packets.

### Tasks

1. Add desktop app target (`cpp/apps/rs_map_viewer_native`).
2. Add platform/window/input loop (SDL2 + OpenGL recommended).
3. Implement GPU upload for packet outputs:
   vertices, indices, draw ranges, model-info textures, height map.
4. Render opaque and alpha passes equivalent to current WebGL ordering.
5. Implement camera movement and map square selection.

### Exit criteria

1. Native app can load and render a fixed square list without TS.
2. Visual output roughly matches current TS viewer for static scene.

## Milestone M2: Native cache ownership and streaming

### Scope

Move cache read/decode/streaming entirely into native C++ app runtime.

### Tasks

1. Use C++ cache/session loaders directly in the native app.
2. Implement square streaming manager (load/unload around camera).
3. Add runtime resource cache policies for map/type/model/texture data.
4. Add async worker threads for decode/build to avoid render-thread stalls.

### Exit criteria

1. Native app streams squares while moving camera.
2. No TS/worker/fetch path required for map builds.

## Milestone M3: Tick/animation parity in native renderer

### Scope

Bring loc/npc animated updates into native runtime/render loop.

### Tasks

1. Integrate tick state updates and patch application per frame.
2. Port draw-range patch application logic currently used in TS runtime path.
3. Add npc geometry path integration into native renderer.
4. Add deterministic replay tests for ticked frames.

### Exit criteria

1. Animated loc/npc updates run in native app.
2. Frame-to-frame patch outputs are deterministic across runs.

## Milestone M4: Remove hybrid production path

### Scope

Demote TS path to tooling/parity; production path is native C++.

### Tasks

1. Remove TS fallback usage in production flow (`src/worker/MapRenderDataBackend.ts` style path no longer required for desktop app).
2. Keep parity scripts and wasm bridge as optional validation tools.
3. Add CI lanes for native app smoke + rendering regression snapshots.

### Exit criteria

1. Production viewer stack does not depend on TS.
2. TS remains only for validation/debug harnesses.

## Execution order (recommended)

1. M0 API stabilization.
2. M1 static desktop viewer.
3. M2 streaming/cache ownership.
4. M3 tick/animation.
5. M4 cleanup and CI hardening.

## Immediate next sprint (practical)

1. Implement M0 runtime API extraction from `rs_map_render_backend.cpp`.
2. Create native app target with SDL2+OpenGL window and packet upload.
3. Render one fixed square from C++ cache/session directly.
4. Add screenshot-based comparison against TS for the same square.
