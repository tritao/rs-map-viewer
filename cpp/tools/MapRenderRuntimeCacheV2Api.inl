// Extracted from `cpp/tools/rs_map_render_backend.cpp` (no behavior changes).

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_set_build_config(
    const rs::i32 runtimeHandle,
    const rs::i32 cacheGame,
    const rs::i32 cacheRevision,
    const rs::i32 sceneLevels,
    const rs::i32 unitsTileHeightBasis) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
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
    const bool cacheChanged = applied.cacheIdentityChanged;
    if (cacheChanged) {
        runtime->cache.clear();
        runtime->geometrySeedVertices.clear();
        runtime->geometrySeedIndices.clear();
    }
    runtime->cache.cacheGame = applied.cacheGame;
    runtime->cache.cacheRevision = applied.cacheRevision;
    runtime->cache.sceneLevels = applied.sceneLevels;
    runtime->cache.unitsTileHeightBasis = applied.unitsTileHeightBasis;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_needs_type_upload(
    const rs::i32 runtimeHandle) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return 0;
    }
    return (!runtime->cache.locTypes.loaded || !runtime->cache.varbits.loaded || !runtime->cache.npcTypes.loaded || !runtime->cache.basTypes.loaded || !runtime->cache.objTypes.loaded) ? 1 : 0;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_map_square(
    const rs::i32 runtimeHandle,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::u8* terrainBytes,
    const rs::i32 terrainBytesLength,
    const rs::u8* locBytes,
    const rs::i32 locBytesLength,
    const rs::u8* npcBytes,
    const rs::i32 npcBytesLength) {
    return rs::tooling::runtimeCachePutMapSquare(
        getMapRenderRuntime(runtimeHandle),
        mapX,
        mapY,
        terrainBytes,
        terrainBytesLength,
        locBytes,
        locBytesLength,
        npcBytes,
        npcBytesLength,
        mapSquareId,
        assignBytes,
        RS_MAP_RENDER_STATUS_INVALID_ARG,
        RS_MAP_RENDER_STATUS_OK);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_map_squares_packed(
    const rs::i32 runtimeHandle,
    const rs::i32 count,
    const rs::i32* mapXs,
    const rs::i32* mapYs,
    const rs::i32* terrainOffsets,
    const rs::i32* terrainLengths,
    const rs::u8* terrainBytes,
    const rs::i32 terrainBytesLength,
    const rs::i32* locOffsets,
    const rs::i32* locLengths,
    const rs::u8* locBytes,
    const rs::i32 locBytesLength,
    const rs::i32* npcOffsets,
    const rs::i32* npcLengths,
    const rs::u8* npcBytes,
    const rs::i32 npcBytesLength) {
    return rs::tooling::runtimeCachePutMapSquaresPacked(
        getMapRenderRuntime(runtimeHandle),
        count,
        mapXs,
        mapYs,
        terrainOffsets,
        terrainLengths,
        terrainBytes,
        terrainBytesLength,
        locOffsets,
        locLengths,
        locBytes,
        locBytesLength,
        npcOffsets,
        npcLengths,
        npcBytes,
        npcBytesLength,
        mapSquareId,
        assignBytes,
        RS_MAP_RENDER_STATUS_INVALID_ARG,
        RS_MAP_RENDER_STATUS_OK);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_clear_map_squares(
    const rs::i32 runtimeHandle) {
    return rs::tooling::runtimeCacheClearMapSquares(
        getMapRenderRuntime(runtimeHandle),
        RS_MAP_RENDER_STATUS_INVALID_ARG,
        RS_MAP_RENDER_STATUS_OK);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_type_blob(
    const rs::i32 runtimeHandle,
    const rs::i32 kind,
    const rs::i32* ids,
    const rs::i32* offsets,
    const rs::i32* lengths,
    const rs::i32 count,
    const rs::u8* bytes,
    const rs::i32 bytesLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    const rs::i32 status = rs::tooling::runtimeCachePutTypeBlob(
        runtime,
        kind,
        ids,
        offsets,
        lengths,
        count,
        bytes,
        bytesLength,
        resolveRuntimeTypeBlob,
        RS_MAP_RENDER_STATUS_INVALID_ARG,
        RS_MAP_RENDER_STATUS_OK);
    if (status == RS_MAP_RENDER_STATUS_OK && runtime) {
        runtime->cache.typeEntriesByKind.erase(kind);
    }
    return status;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_clear_type_kind(
    const rs::i32 runtimeHandle,
    const rs::i32 kind) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    MapRenderCachedTypeBlob* blob = resolveRuntimeTypeBlob(runtime, kind);
    if (!blob) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    blob->clear();
    runtime->cache.typeEntriesByKind.erase(kind);
    runtime->cache.typeGeneration++;
    runtime->cache.appliedTypeGeneration = -1;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_type_entry(
    const rs::i32 runtimeHandle,
    const rs::i32 kind,
    const rs::i32 id,
    const rs::u8* bytes,
    const rs::i32 bytesLength) {
    if (id < 0 || bytesLength < 0 || (bytesLength > 0 && !bytes)) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    MapRenderCachedTypeBlob* blob = resolveRuntimeTypeBlob(runtime, kind);
    if (!blob) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    auto& entryStore = runtime->cache.typeEntriesByKind[kind];
    entryStore.loaded = true;
    std::vector<rs::u8> entryBytes{};
    if (bytesLength > 0) {
        entryBytes.assign(bytes, bytes + static_cast<std::size_t>(bytesLength));
    }
    entryStore.entriesById[id] = std::move(entryBytes);
    runtime->cache.typeEntriesDirty = true;
    blob->loaded = false;
    runtime->cache.typeGeneration++;
    runtime->cache.appliedTypeGeneration = -1;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_set_varps(
    const rs::i32 runtimeHandle,
    const rs::i32* varps,
    const rs::i32 varpCount) {
    return rs::tooling::runtimeCacheSetVarps(
        getMapRenderRuntime(runtimeHandle),
        varps,
        varpCount,
        RS_MAP_RENDER_STATUS_INVALID_ARG,
        RS_MAP_RENDER_STATUS_OK);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_set_geometry_seed(
    const rs::i32 runtimeHandle,
    const rs::u8* vertices,
    const rs::i32 verticesLength,
    const rs::i32* indices,
    const rs::i32 indicesLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || verticesLength < 0 || indicesLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if ((verticesLength > 0 && !vertices) || (indicesLength > 0 && !indices)) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    runtime->geometrySeedVertices.clear();
    if (verticesLength > 0) {
        runtime->geometrySeedVertices.assign(
            vertices,
            vertices + static_cast<std::size_t>(verticesLength));
    }

    runtime->geometrySeedIndices.clear();
    if (indicesLength > 0) {
        runtime->geometrySeedIndices.assign(
            indices,
            indices + static_cast<std::size_t>(indicesLength));
    }

    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_clear_geometry_seed(
    const rs::i32 runtimeHandle) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->geometrySeedVertices.clear();
    runtime->geometrySeedIndices.clear();
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_texture_argb(
    const rs::i32 runtimeHandle,
    const rs::i32 textureId,
    const rs::i32* argb,
    const rs::i32 argbLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || textureId < 0 || argbLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (argbLength > 0 && !argb) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (argbLength == 0) {
        runtime->cache.textureArgbById.erase(textureId);
        return RS_MAP_RENDER_STATUS_OK;
    }
    std::vector<rs::i32>& out = runtime->cache.textureArgbById[textureId];
    out.assign(argb, argb + static_cast<std::size_t>(argbLength));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_clear_texture_argb(
    const rs::i32 runtimeHandle) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->cache.textureArgbById.clear();
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_material_params(
    const rs::i32 runtimeHandle,
    const rs::i32 materialId,
    const rs::i32* params,
    const rs::i32 paramsLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || materialId < 0 || paramsLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (paramsLength > 0 && !params) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (paramsLength == 0) {
        runtime->cache.materialParamsById.erase(materialId);
        return RS_MAP_RENDER_STATUS_OK;
    }
    std::vector<rs::i32>& out = runtime->cache.materialParamsById[materialId];
    out.assign(params, params + static_cast<std::size_t>(paramsLength));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_clear_material_params(
    const rs::i32 runtimeHandle) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->cache.materialParamsById.clear();
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_get_resource_counts(
    const rs::i32 runtimeHandle,
    rs::i32* outCounts,
    const rs::i32 outCountsLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outCounts || outCountsLength < 2) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outCounts[0] = static_cast<rs::i32>(runtime->cache.textureArgbById.size());
    outCounts[1] = static_cast<rs::i32>(runtime->cache.materialParamsById.size());
    return RS_MAP_RENDER_STATUS_OK;
}

