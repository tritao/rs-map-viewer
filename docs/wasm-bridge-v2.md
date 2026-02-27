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

### 2) Cache blob-store entries (only cache API)

-   `rs_map_render_runtime_cache_put_blob_batch(runtime, domain, groupsPtr, filesPtr, offsetsPtr, lengthsPtr, count, bytesPtr, bytesLen) -> status`
-   `rs_map_render_runtime_cache_clear_blob_domain(runtime, domain) -> status`
-   `rs_map_render_runtime_cache_clear_all_blobs(runtime) -> status`

Key schemes (stable):

-   Map squares: `(domain=2, group=mapSquareId, file=channel)`
    -   `channel=0`: terrain
    -   `channel=1`: locs
    -   `channel=2`: npc spawns
-   Type entries: `(domain=100+kind, group=0, file=id)`
    -   `kind=1..16` (loc, varbit, model, seqtype, seqframe, npc, bas, underlay, overlay, obj, etc)
-   Dat (classic) seq frame-maps: `(domain=3, group=frameMapId, file=0)`
-   Legacy seq global files: `(domain=4, group=0, file=<enum>)`
-   Legacy model global files: `(domain=5, group=0, file=<enum>)`
-   Texture ARGB: `(domain=6, group=textureId, file=0)` (bytes = raw `Int32Array` backing store, little-endian)
-   Material params: `(domain=7, group=materialId, file=0)` (bytes = raw `Int32Array` backing store, little-endian)

### 3) Cache presence query (dedupe lives in C++)

-   `rs_map_render_runtime_cache_has_type_ids(runtime, kind, idsPtr, idCount, outPresentFlagsPtr, outPresentFlagsLen) -> status`
-   Returns `outPresentFlags[i] = 1` if the runtime can satisfy the type id (direct blob entry or derived/global source), else `0`.
-   `rs_map_render_runtime_cache_has_blob_entries(runtime, domain, groupsPtr, filesPtr, count, outPresentFlagsPtr, outPresentFlagsLen) -> status`
-   Returns `outPresentFlags[i] = 1` if `(domain, groups[i], files[i])` exists in the blob-store, else `0`.

### 4) Cache varps

-   `rs_map_render_runtime_cache_set_varps(runtime, varpsPtr, varpCount) -> status`

### 5) Build map packet from runtime cache

-   `rs_map_render_runtime_build_map_packet_handle_from_cache(runtime, mapX, mapY, borderSize, sizeX, sizeY, smoothTerrain, locLoadType, minimizeDrawCalls, loadLocs, loadObjs, loadNpcs) -> packetHandleOrNegativeStatus`

Behavior:

-   Builds from blob-store inputs only (map-square bytes + type bytes + optional derived/global blobs).
-   Produces a render packet handle (command-stream + geometry payload for the WebGL renderer).

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

1. Keep all cache inputs as blob-store domains (no parallel typed cache APIs).
2. Expand derived presence and invalidation as we add more "real cache units" (dat2 groups/archives, legacy containers, etc).
3. Keep parity probes opt-in and minimize stable runtime surface area (packet + command-stream digests only by default).
