# TS → C++ Porting Notes (config/loaders focus)

This document exists to keep the TypeScript implementation "C++-shaped" while we incrementally port.

## Architecture / object graph

-   `CacheSystem`: owns cache indices and (for Dat/Dat2) the underlying store/index tables.
-   `CacheSession` (`src/rs/runtime/createCacheSession.ts`): per-thread/per-worker runtime context.
    -   Shares `cacheSystem` with other sessions.
    -   Owns `loaders` (decoded type caches, error caches, etc).
    -   `tryFork()` mirrors "thread-local services" in C++ (new loader caches, same underlying store).
-   `Loaders` (`src/rs/loaders/Loaders.ts`): the stable surface for callers.

## Error / return conventions

Within config/type loaders:

-   Prefer `try*` returning either:
    -   `T | undefined` for "missing" (optional), OR
    -   `Result<T, DecodeError>` for decode failures + not-found.
-   Avoid throwing in decoding code paths. Type `decodeOpcode()` implementations may throw; callers
    should catch and convert into structured errors at the loader boundary (as `DecodeError`).
-   Use `*OrThrow` only at UI/tool boundaries.

These conventions map cleanly to:

-   `std::optional<T>` for "not found" / "not present"
-   `expected<T, Error>` (or `tl::expected`) for structured decode failures
-   "log once per id" should stay at loader boundaries, not inside pure decode helpers

## Arrays / "vector semantics"

Avoid JS holey arrays (`new Array(n)` + leaving entries unset, or `delete arr[i]`).

For id-indexed arrays, prefer one of:

-   Dense arrays initialized with `Array.from({ length: n }, () => defaultValue)`
-   Explicit optional entries: `Array<T | undefined>`

This avoids subtle differences vs `std::vector<T>` iteration and presence checks.

Example: config `actions` arrays use `undefined` instead of `delete`, matching
`std::vector<std::optional<std::string>>`.

## Strings / encoding policy

In the cache, strings are byte sequences terminated by either `0x00` (Dat2) or `0x0A` (older).
In this codebase we currently treat them as **byte strings** and build JS strings by decoding each
byte as a codepoint (`String.fromCharCode(byte)`).

Porting shape:

-   C++ core stores strings as non-owning `rs::Str` (ptr+len), typically backed by `rs::StringArena`.
-   No Unicode/UTF-8 assumptions in core decode code; conversion for UI/tooling should happen at edges.

## Loader source mapping (high level)

The following is a _shape_ guide for the C++ port; the concrete archive ids are in code.

-   Config type loaders:
    -   Dat / Legacy: mostly named `.dat/.idx` entries inside config archives.
    -   Dat2: index-based archive/file lookups, with bytes providers at the edge.
-   Content loaders:
    -   `ModelLoader`, `SeqFrameLoader`, `TextureLoader`, `SpriteLoader` pull bytes via indices/archives.

When porting:

1. Port `DecodeError` + `InitError` (and helpers) first.
2. Port `Type` / type decode loop (`src/rs/config/Type.ts`) next.
3. Port `TypeLoader` + specific config types/loaders.
4. Port `tryCreateLoaders` and keep `Loaders` as the stable boundary.
