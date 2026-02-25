// Extracted runtime type-demand export APIs (primary/expanded) from rs_map_render_backend.cpp.
RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_collect_required_primary_type_ids(
    const rs::i32 runtimeHandle,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 includeLocs,
    const rs::i32 includeObjs,
    const rs::i32 includeNpcs,
    rs::i32* outPacked,
    const rs::i32 outPackedLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || sizeX <= 0 || sizeY <= 0 || outPackedLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::vector<rs::i32> pairs{};
    const rs::i32 collectStatus = collectRuntimeRequiredPrimaryTypePairs(
        runtime,
        baseX,
        baseY,
        sizeX,
        sizeY,
        includeLocs,
        includeObjs,
        includeNpcs,
        &pairs);
    if (collectStatus != RS_MAP_RENDER_STATUS_OK) {
        return collectStatus;
    }

    const rs::i32 entryCount = static_cast<rs::i32>(pairs.size() / 2);
    const rs::i32 neededLength = 2 + (entryCount * 2);
    if (!outPacked || outPackedLength < neededLength) {
        return neededLength;
    }
    outPacked[0] = 1; // packed version
    outPacked[1] = entryCount;
    if (!pairs.empty()) {
        std::memcpy(
            outPacked + 2,
            pairs.data(),
            static_cast<std::size_t>(pairs.size()) * sizeof(rs::i32));
    }
    return neededLength;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_collect_required_expanded_type_ids(
    const rs::i32 runtimeHandle,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 includeLocs,
    const rs::i32 includeObjs,
    const rs::i32 includeNpcs,
    rs::i32* outPacked,
    const rs::i32 outPackedLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || sizeX <= 0 || sizeY <= 0 || outPackedLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::vector<rs::i32> pairs{};
    const rs::i32 collectStatus = collectRuntimeRequiredExpandedTypePairs(
        runtime,
        baseX,
        baseY,
        sizeX,
        sizeY,
        includeLocs,
        includeObjs,
        includeNpcs,
        &pairs);
    if (collectStatus != RS_MAP_RENDER_STATUS_OK) {
        return collectStatus;
    }

    const rs::i32 entryCount = static_cast<rs::i32>(pairs.size() / 2);
    const rs::i32 neededLength = 2 + (entryCount * 2);
    if (!outPacked || outPackedLength < neededLength) {
        return neededLength;
    }
    outPacked[0] = 1; // packed version
    outPacked[1] = entryCount;
    if (!pairs.empty()) {
        std::memcpy(
            outPacked + 2,
            pairs.data(),
            static_cast<std::size_t>(pairs.size()) * sizeof(rs::i32));
    }
    return neededLength;
}
