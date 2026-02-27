// Extracted from `cpp/tools/rs_map_render_backend.cpp` (no behavior changes).

static bool isTypeEntryBlobDomain(const rs::i32 domain) noexcept {
    // Type-entry blobs live in "kind domains": (domain in [101..116], group=0, file=id).
    return domain >= RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MIN &&
        domain <= RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MAX;
}

static void invalidateDerivedCachesForBlobDomain(
    MapRenderRuntimeState* runtime,
    const rs::i32 domain,
    const bool mutated) noexcept {
    if (!runtime || !mutated) {
        return;
    }
    if (isTypeEntryBlobDomain(domain)) {
        runtime->cache.typeGeneration++;
        runtime->cache.appliedTypeGeneration = -1;
    }
    if (domain == RS_MAP_RENDER_BLOB_DOMAIN_DAT_SEQ_FRAME_MAP) {
        runtime->cache.datSeqFrameMapGeneration++;
        runtime->cache.appliedDatSeqFrameMapGeneration = -1;
    }
    if (domain == RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES) {
        runtime->cache.legacySeqFilesGeneration++;
        runtime->cache.appliedLegacySeqFilesGeneration = -1;
    }
    if (domain == RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_MODEL_FILES) {
        runtime->cache.legacyModelFilesGeneration++;
        runtime->cache.appliedLegacyModelFilesGeneration = -1;
    }
}

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
    }
    runtime->cache.cacheGame = applied.cacheGame;
    runtime->cache.cacheRevision = applied.cacheRevision;
    runtime->cache.sceneLevels = applied.sceneLevels;
    runtime->cache.unitsTileHeightBasis = applied.unitsTileHeightBasis;
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

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_put_blob_batch(
    const rs::i32 runtimeHandle,
    const rs::i32 domain,
    const rs::i32* groups,
    const rs::i32* files,
    const rs::i32* offsets,
    const rs::i32* lengths,
    const rs::i32 count,
    const rs::u8* bytes,
    const rs::i32 bytesLength) {
    if (domain < 0 || count < 0 || bytesLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (count > 0 && (!groups || !files || !offsets || !lengths)) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (bytesLength > 0 && !bytes) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    auto& store = runtime->cache.blobEntries;
    const bool typeDomain = isTypeEntryBlobDomain(domain);
    const rs::i32 n = count | 0;
    for (rs::i32 i = 0; i < n; i++) {
        const rs::i32 group = groups[i] | 0;
        const rs::i32 file = files[i] | 0;
        const rs::i32 off = offsets[i] | 0;
        const rs::i32 len = lengths[i] | 0;
        if (group < 0 || file < 0 || off < 0 || len < 0) {
            return RS_MAP_RENDER_STATUS_INVALID_ARG;
        }
        if (typeDomain && group != 0) {
            return RS_MAP_RENDER_STATUS_INVALID_ARG;
        }
        if (off > bytesLength || len > bytesLength - off) {
            return RS_MAP_RENDER_STATUS_INVALID_ARG;
        }

        const MapRenderRuntimeCacheState::BlobKey key{domain, group, file};
        auto it = store.find(key);
        std::vector<rs::u8> payload{};
        if (len > 0) {
            payload.assign(bytes + static_cast<std::size_t>(off), bytes + static_cast<std::size_t>(off + len));
        }
        if (it == store.end()) {
            runtime->cache.blobEntriesBytes += payload.size();
            store.emplace(key, std::move(payload));
        } else {
            runtime->cache.blobEntriesBytes -= it->second.size();
            it->second = std::move(payload);
            runtime->cache.blobEntriesBytes += it->second.size();
        }
    }

    invalidateDerivedCachesForBlobDomain(runtime, domain, n > 0);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_clear_blob_domain(
    const rs::i32 runtimeHandle,
    const rs::i32 domain) {
    if (domain < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    auto& store = runtime->cache.blobEntries;
    bool removed = false;
    for (auto it = store.begin(); it != store.end();) {
        if (it->first.domain == domain) {
            runtime->cache.blobEntriesBytes -= it->second.size();
            it = store.erase(it);
            removed = true;
        } else {
            ++it;
        }
    }
    invalidateDerivedCachesForBlobDomain(runtime, domain, removed);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_cache_clear_all_blobs(
    const rs::i32 runtimeHandle) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->cache.blobEntries.clear();
    runtime->cache.blobEntriesBytes = 0;

    // Invalidate derived caches.
    runtime->cache.typeGeneration++;
    runtime->cache.appliedTypeGeneration = -1;

    runtime->cache.datSeqFrameMapGeneration++;
    runtime->cache.appliedDatSeqFrameMapGeneration = -1;

    runtime->cache.legacySeqFilesGeneration++;
    runtime->cache.appliedLegacySeqFilesGeneration = -1;

    runtime->cache.legacyModelFilesGeneration++;
    runtime->cache.appliedLegacyModelFilesGeneration = -1;

    return RS_MAP_RENDER_STATUS_OK;
}
