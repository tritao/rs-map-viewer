# Runtime Generalization Plan

## Goal

Decouple the runtime/render/sim pipeline from RuneScape cache assumptions so the repo can support:

1. RuneScape cache-backed content through an adapter.
2. Future editor-authored or server-authored worlds through a different adapter.

Non-goal: rewrite the existing RS decoding stack first. The short path is to keep `src/rs/**` as the RuneScape adapter while moving core runtime contracts to neutral interfaces.

## Problem Statement

Today the "runtime" is still defined by RuneScape-specific inputs and nouns:

- `CacheSession` exposes RS loaders directly (`loc`, `npc`, `obj`, `seq`, `varbit`, `mapFile`).
- `MapBytesProvider` assumes RS map square blobs and XTEA for encrypted data.
- `SceneBuilder` branches on `GameType` and revision behavior.
- worker/bootstrap state stores RS-specific spawns, animation tables, and tile flags.
- runtime payloads expose RS names such as `locsAnimated` and `npcTypeAnimationTable`.

This makes every higher-level feature inherit RS format constraints.

## Current Coupling Map

### Content/session seam

- Current: `src/rs/loaders/CacheSession.ts`
- Current: `src/rs/loaders/Loaders.ts`
- Problem: core-facing code consumes RS type systems instead of a neutral content/session contract.

### World/chunk seam

- Current: `src/rs/map/MapBytesProvider.ts`
- Current: `src/rs/scene/buildSceneFromMapBytesProvider.ts`
- Problem: "load world content" is hard-wired to RS terrain/loc/npc square files.

### Scene build seam

- Current: `src/rs/scene/SceneBuilder.ts`
- Problem: scene build behavior depends on RS cache revision and RS config types.

### Worker/runtime seam

- Current: `src/maprender/MapRenderBackend.ts`
- Current: `src/worker/WorkerBuildService.ts`
- Current: `src/worker/WorkerBuildTypes.ts`
- Problem: runtime build deps are RS service graphs, not generic world content/build deps.

### Runtime packet seam

- Current: `src/runtime/MapRuntimePayload.ts`
- Problem: runtime registration/bootstrap payloads leak RS-specific fields into the world/sim path.

## Target Layering

### Layer 1: Core runtime

Owns chunk activation, render packet generation, world mutation application, animation playback, and future replication hooks.

This layer must not import from `src/rs/**`.

### Layer 2: Content adapter

Provides chunk content, definition catalogs, animation catalogs, and auxiliary metadata in a neutral shape.

Examples:

- `RunescapeContentAdapter`
- future `StudioContentAdapter`
- future `ServerSnapshotContentAdapter`

### Layer 3: Format/import implementation

Format-specific decoding and loader logic.

For RuneScape this remains under `src/rs/**`.

## Proposed New Files

### `src/core/content/ContentSession.ts`

Purpose: neutral replacement for core uses of `CacheSession`.

```ts
export type ContentFormatId = "runescape-cache" | "studio-world" | "server-snapshot";

export type ContentSession = Readonly<{
    format: ContentFormatId;
    getWorldChunkSource(): WorldChunkSource;
    getDefinitionCatalog(): DefinitionCatalog;
    getAnimationCatalog(): AnimationCatalog;
    getMaterialCatalog(): MaterialCatalog;
    clearCaches(): void;
    fork(): Promise<ContentSession>;
}>;
```

Initial implementation:

- add `RunescapeContentSession` that wraps existing `CacheSession`
- keep `CacheSession` unchanged during first migration

### `src/core/content/WorldChunkSource.ts`

Purpose: replace direct `MapBytesProvider` usage in core code.

```ts
export type WorldChunkId = number;

export type WorldChunkRequest = Readonly<{
    chunkId: WorldChunkId;
    lod?: number;
}>;

export type WorldChunkSource = Readonly<{
    loadChunk(request: WorldChunkRequest): Promise<WorldChunkData | undefined>;
}>;
```

`WorldChunkData` should be normalized and not expose RS file names:

```ts
export type WorldChunkData = Readonly<{
    chunkId: WorldChunkId;
    terrain?: Uint8Array;
    staticInstances?: Uint8Array;
    actorSpawns?: Uint8Array;
    metadata?: Record<string, unknown>;
}>;
```

RuneScape adapter mapping:

- `terrain` <- `mX_Y`
- `staticInstances` <- `lX_Y`
- `actorSpawns` <- npc spawn bytes or fallback data

### `src/core/content/DefinitionCatalog.ts`

Purpose: replace core dependency on RS-specific loader bags.

```ts
export type DefinitionKind = "object" | "actor" | "item" | "animation" | "material" | "var";

export type DefinitionCatalog = Readonly<{
    getObjectDef(id: number): Promise<WorldObjectDef | undefined>;
    getActorDef(id: number): Promise<WorldActorDef | undefined>;
    getItemDef?(id: number): Promise<WorldItemDef | undefined>;
    getVarValueResolver?(): VarValueResolver | undefined;
}>;
```

RuneScape adapter mapping:

- object -> `LocType`
- actor -> `NpcType`
- item -> `ObjType`
- var resolver -> `VarManager` + `VarBitTypeLoader`

### `src/core/content/AnimationCatalog.ts`

Purpose: isolate animation clip/frame lookup from RS seq/frame loaders.

```ts
export type AnimationCatalog = Readonly<{
    getObjectAnimationSet(id: number): Promise<ObjectAnimationSet | undefined>;
    getActorAnimationSet(id: number): Promise<ActorAnimationSet | undefined>;
    getClip(id: number): Promise<AnimationClip | undefined>;
}>;
```

RuneScape adapter mapping:

- object/actor animation lookup <- `SeqType`, `SeqFrame`, skeletal seq loaders, BAS data

### `src/core/content/MaterialCatalog.ts`

Purpose: isolate texture/material queries from `TextureLoader`.

```ts
export type MaterialCatalog = Readonly<{
    getMaterial(id: number): Promise<RenderMaterial | undefined>;
    getPixelsArgb(id: number, size: number): Promise<Int32Array | undefined>;
}>;
```

### `src/core/world/WorldChunkModel.ts`

Purpose: define the neutral in-memory chunk representation that scene/build code consumes.

```ts
export type WorldInstanceKind = "object" | "ground-item" | "actor-spawn" | "marker";

export type WorldChunkModel = Readonly<{
    chunkId: number;
    bounds: WorldChunkBounds;
    terrain: TerrainLayerSet;
    instances: ReadonlyArray<WorldInstance>;
    collision?: CollisionLayerSet;
    lighting?: LightingSeedSet;
}>;
```

This is the key normalization boundary. RS decoding should map into this model instead of letting `SceneBuilder` pull RS types directly.

### `src/core/build/WorldBuildBackend.ts`

Purpose: replace `MapRenderBackend`'s RS-specific build deps with core deps.

```ts
export type WorldBuildDeps = Readonly<{
    contentSession: ContentSession;
    chunkSource: WorldChunkSource;
    sceneCompiler: SceneCompiler;
    actorModelSource: ActorModelSource;
    objectModelSource: ObjectModelSource;
    materialCatalog: MaterialCatalog;
    telemetry?: boolean;
}>;
```

This backend still returns the current render payload shape initially, but its inputs become neutral.

### `src/core/scene/SceneCompiler.ts`

Purpose: replace direct core dependency on `SceneBuilder`.

```ts
export type SceneCompilerInput = Readonly<{
    chunk: WorldChunkModel;
    buildOptions: SceneBuildOptions;
}>;

export type SceneCompiler = Readonly<{
    compile(input: SceneCompilerInput): Promise<CompiledScene>;
}>;
```

Initial implementation:

- `RunescapeSceneCompiler` wraps the existing `SceneBuilder`
- later, `SceneBuilder` can be split so RS decode happens before generic compile

### `src/core/runtime/WorldRuntimePayload.ts`

Purpose: neutral replacement for `src/runtime/MapRuntimePayload.ts`.

```ts
export type WorldRuntimeRegistration = Readonly<{
    collisionMaskPrimary?: Uint8Array[];
    animatedInstances: ReadonlyArray<AnimatedInstanceRegistration>;
    actorAnimationTable: ReadonlyArray<ActorAnimationRegistration>;
}>;

export type WorldRuntimeBootstrap = Readonly<{
    actorOrderKeys: Int32Array;
    dynamicState?: DynamicWorldState;
}>;
```

Rename mapping for first migration:

- `tileRenderFlagsLevel1` -> `collisionMaskPrimary`
- `locsAnimated` -> `animatedInstances`
- `npcTypeAnimationTable` -> `actorAnimationTable`
- `npcOrderKeys` -> `actorOrderKeys`

### `src/adapters/runescape/RunescapeContentSession.ts`

Purpose: adapter from `CacheSession` to `ContentSession`.

Responsibilities:

- own wrapped `CacheSession`
- expose `WorldChunkSource`, `DefinitionCatalog`, `AnimationCatalog`, `MaterialCatalog`
- keep all RS-specific imports inside adapter files

### `src/adapters/runescape/RunescapeWorldChunkSource.ts`

Purpose: wrap `MapFileBytesProvider` and fallback spawn sources.

Responsibilities:

- map chunk id to RS `mapX/mapY`
- read terrain/loc/npc bytes
- attach adapter metadata needed for decode

### `src/adapters/runescape/RunescapeSceneCompiler.ts`

Purpose: bridge normalized chunk/build requests back to the existing RS `SceneBuilder` during migration.

Responsibilities:

- accept neutral `WorldChunkModel` or `WorldChunkData`
- invoke RS decode/build path
- emit generic `CompiledScene`

## Existing Files To Retarget

### `src/worker/WorkerBuildTypes.ts`

Current:

- stores `session: CacheSession`
- stores `sceneBuilder: SceneBuilder`
- stores RS model loaders and `MapImageRenderer`

Target:

- store `contentSession: ContentSession`
- store `chunkSource: WorldChunkSource`
- store `sceneCompiler: SceneCompiler`
- keep RS-specific extras only inside adapter-owned state

### `src/worker/WorkerBuildService.ts`

Current:

- creates `CacheSession`
- builds `MapFileBytesProvider`
- constructs `SceneBuilder`, model loaders, texture loader directly

Target:

- construct `RunescapeContentSession`
- pass `ContentSession` and neutral catalogs/sources into core worker state
- keep RS bootstrap data loading in adapter init only

### `src/maprender/MapRenderBackend.ts`

Current:

- `MapRenderBuildDeps` leaks `CacheSession`, `SceneBuilder`, RS loaders, spawn data

Target:

- `WorldBuildDeps` consumes only core contracts
- RS backend implementation lives under `src/adapters/runescape/**`

### `src/runtime/MapRuntimePayload.ts`

Target:

- keep wire layout stable first
- rename exported types to neutral terms
- provide temporary aliases so callers can migrate incrementally

### `src/rs/scene/buildSceneFromMapBytesProvider.ts`

Target:

- keep as RS-only helper
- no new core code should import this directly

### `src/rs/loaders/CacheSession.ts`

Target:

- keep as internal RS adapter implementation
- no new non-adapter imports from `src/worker`, `src/runtime`, `src/maprender`, or `src/world`

## Migration Phases

### Phase 0: Introduce neutral contracts without behavior change

Add:

- `src/core/content/*`
- `src/core/runtime/WorldRuntimePayload.ts`
- `src/adapters/runescape/*`

Rules:

- adapters may import `src/rs/**`
- core may not import `src/rs/**`

### Phase 1: Wrap session/build bootstrap

Refactor:

- `src/worker/WorkerBuildService.ts`
- `src/worker/WorkerBuildTypes.ts`
- `src/maprender/MapRenderBackend.ts`

Outcome:

- worker initializes a `RunescapeContentSession`
- core worker state depends on `ContentSession`

### Phase 2: Move chunk loading behind `WorldChunkSource`

Refactor:

- replace direct `MapFileBytesProvider` use in core paths
- retain RS decoding in adapter/compiler wrapper

Outcome:

- chunk streaming no longer cares whether bytes came from cache, editor save, or server snapshot

### Phase 3: Neutralize runtime payload names

Refactor:

- `src/runtime/MapRuntimePayload.ts`
- `src/world/*`
- `src/runtime/sim/*`

Outcome:

- world/sim code uses actor/object/instance terminology instead of npc/loc-specific registration contracts

### Phase 4: Split decode from compile

Refactor:

- keep raw RS decode under `src/adapters/runescape/decode/*`
- introduce generic scene compile input from normalized chunk model

Outcome:

- RuneScape becomes one importer into a generic world model instead of the runtime spec

## Guardrails

### Allowed dependencies

- `src/adapters/runescape/**` -> may import `src/rs/**`
- `src/core/**` -> may not import `src/rs/**`
- `src/world/**` and `src/runtime/**` -> should import `src/core/**`, not `src/rs/**`

### Temporary compatibility aliases

During migration it is acceptable to export aliases such as:

```ts
export type MapRuntimeRegistration = WorldRuntimeRegistration;
export type MapRuntimeBootstrap = WorldRuntimeBootstrap;
```

This keeps churn manageable while call sites move.

### What should stay RS-specific

Do not try to genericize these in the first pass:

- cache revision detection
- XTEA handling
- `LocType` / `NpcType` / `ObjType` decode logic
- RS map square byte parsing
- RS fallback NPC/object spawn data

Those belong in the adapter.

## First Concrete Cut

If only a small first slice is taken, do this:

1. Add `ContentSession`, `WorldChunkSource`, and `WorldRuntimePayload` neutral types.
2. Add `RunescapeContentSession` adapter wrapping `CacheSession`.
3. Refactor `WorkerBuildTypes.ts` and `WorkerBuildService.ts` to hold `ContentSession` rather than `CacheSession`.
4. Keep `SceneBuilder` and RS loaders behind the adapter for now.

That gives the repo a real architectural seam without forcing a decoder rewrite.
