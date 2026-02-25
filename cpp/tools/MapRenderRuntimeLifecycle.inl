// Extracted from `cpp/tools/rs_map_render_backend.cpp` (no behavior changes).

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_create() {
    return gMapRenderRuntimes.create();
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_create_with_config(
    const rs::i32 cacheGame,
    const rs::i32 cacheRevision,
    const rs::i32 sceneLevels,
    const rs::i32 unitsTileHeightBasis) {
    const rs::i32 handle = rs_map_render_runtime_create();
    MapRenderRuntimeState* runtime = getMapRenderRuntime(handle);
    if (!runtime) {
        return 0;
    }
    const rs::maprender::RuntimeBuildConfigApplied applied =
        rs::maprender::applyRuntimeBuildConfig(
            runtime->cache.cacheGame,
            runtime->cache.cacheRevision,
            cacheGame,
            cacheRevision,
            sceneLevels,
            unitsTileHeightBasis,
            RS_SCENE_LEVELS,
            128);
    runtime->cache.cacheGame = applied.cacheGame;
    runtime->cache.cacheRevision = applied.cacheRevision;
    runtime->cache.sceneLevels = applied.sceneLevels;
    runtime->cache.unitsTileHeightBasis = applied.unitsTileHeightBasis;
    return handle;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_destroy(const rs::i32 runtimeHandle) {
    if (runtimeHandle <= 0) {
        return 0;
    }
    clearPacketHandlesForRuntime(runtimeHandle);
    return gMapRenderRuntimes.destroy(runtimeHandle) ? 1 : 0;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_reset(const rs::i32 runtimeHandle) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return 0;
    }
    runtime->tickStates.clear();
    runtime->mapPayload.clear();
    runtime->cache.clear();
    runtime->lastBuiltCommandStream.clear();
    runtime->geometrySeedVertices.clear();
    runtime->geometrySeedIndices.clear();
    runtime->debugLastCollisionFlags.clear();
    runtime->debugLastCollisionLevels = 0;
    runtime->debugLastCollisionSizeX = 0;
    runtime->debugLastCollisionSizeY = 0;
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    runtime->debugLastMapInputHashDirect = 0;
    runtime->debugLastMapInputHashCache = 0;
    runtime->debugLastCacheScratchHeightHash = 0;
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_is_valid(const rs::i32 runtimeHandle) {
    return gMapRenderRuntimes.isValid(runtimeHandle) ? 1 : 0;
}

