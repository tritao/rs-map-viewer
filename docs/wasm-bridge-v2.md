# WASM Bridge v2 (Draft)

Status: Draft, partially implemented.

Goal:

-   TS worker acts as byte transport and orchestration only.
-   C++ runtime owns cache state and map-build lifecycle.
-   Runtime map-build no longer depends on TS command-stream contracts.

## Capability

-   `CAP_RUNTIME_CACHE_V2 = 1 << 10`

## Runtime APIs

### 1) Runtime creation

-   `rs_map_render_runtime_create_with_config(cacheGame, cacheRevision, sceneLevels, unitsTileHeightBasis) -> runtimeHandle`
-   Existing `rs_map_render_runtime_create()` remains supported for compatibility.

### 2) Cache map-square bytes

-   `rs_map_render_runtime_cache_put_map_square(runtime, mapX, mapY, terrainPtr, terrainLen, locPtr, locLen, npcPtr, npcLen) -> status`
-   `len == 0` clears that channel for the square.

### 3) Cache type blobs

-   `rs_map_render_runtime_cache_put_type_blob(runtime, kind, idsPtr, offsetsPtr, lengthsPtr, count, bytesPtr, bytesLen) -> status`
-   Kinds:
    -   `1`: loc types
    -   `2`: varbits

### 4) Cache varps

-   `rs_map_render_runtime_cache_set_varps(runtime, varpsPtr, varpCount) -> status`

### 5) Build map from runtime cache

-   `rs_map_render_runtime_build_map_from_cache(runtime, mapX, mapY, borderSize, sizeX, sizeY, smoothTerrain, locLoadType, outPacketHandlePtr) -> status`

Behavior:

-   Builds scene seed from runtime-cached map-square bytes.
-   Ensures scene type init from runtime-cached loc/varbit blobs.
-   Produces a render packet handle.

Current limitation:

-   Runtime map-build currently requires a cached command stream for the same request shape
    `(baseX/baseY/sizeX/sizeY/locLoadType)`.
-   On first build for a request, TS bootstraps via runtime command-stream input
    (packed-seed only as fallback compatibility path) so C++ can cache command stream state.
-   Full native C++ command generation for cache-only map builds is still pending.

### 6) Get render packet

-   `rs_map_render_runtime_get_render_packet(runtime, packetHandle, outMetaI32Ptr, outMetaI32Len) -> status`
-   `outMetaI32Len` must be `>= 15`.

Packed meta layout (`i32[15]`):

1. bucketCmdCounts pointer
2. bucketCmdCounts length
3. bucketModelInfoLengths pointer
4. bucketModelInfoLengths length
5. drawRangesPacked pointer
6. drawRangesPacked length
7. modelInfoTextureConcat pointer
8. modelInfoTextureConcat length
9. heightMap pointer
10. heightMap length
11. levels
12. sizeX
13. sizeY
14. unitsTileHeightBasis
15. totalModelInfoLength

### 7) Release render packet

-   `rs_map_render_runtime_release_render_packet(runtime, packetHandle) -> status`

### 8) Runtime reset/destroy

-   `rs_map_render_runtime_reset(runtime) -> status`
-   `rs_map_render_runtime_destroy(runtime) -> status`

## Status codes

-   `1`: ok
-   `-1`: invalid argument
-   `-2`: not found
-   `-3`: size mismatch
-   `-4`: invalid runtime state
-   `-5`: capacity/handle exhaustion

## Next implementation steps

1. Port command generation/batching into C++ runtime map-build path.
    - `cpp/rs/render/SceneCommandBuilder.*` seam is now present and wired from
      `rs_map_render_runtime_build_map_from_cache` cold-start path.
    - First functional slice shipped: packed-seed -> command-stream decode now lives in
      `SceneCommandBuilder` and is used by runtime rebuild paths.
    - Remaining work: byte-driven/native command generation is still scaffold-only
      (`buildSceneCommandStream` returns `Status::Unsupported`).
2. Extend render packet to include full renderer payload expected by TS WebGL path.
3. Remove packed-seed runtime bootstrap path after command-stream fallback coverage is complete.
4. Remove old runtime command-stream bridge contract once C++ command generation is native.
