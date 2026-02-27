RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_build_map_packet_handle_from_cache(
    const rs::i32 runtimeHandle,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::i32 borderSize,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 smoothTerrain,
    const rs::i32 locLoadType,
    const rs::i32 minimizeDrawCalls,
    const rs::i32 loadLocs,
    const rs::i32 loadObjs,
    const rs::i32 loadNpcs,
    rs::i32* outPacketHandle) {
    return rs::tooling::runtimeBuildPacketHandle(
        runtimeHandle,
        outPacketHandle,
        [=]() {
            return runtimeBuildMapFromCacheInternal(
                runtimeHandle,
                mapX,
                mapY,
                borderSize,
                sizeX,
                sizeY,
                smoothTerrain,
                locLoadType,
                minimizeDrawCalls,
                loadLocs,
                loadObjs,
                loadNpcs,
                /*buildPayload=*/true);
        },
        getMapRenderRuntimeConst,
        allocateMapRenderPacketHandle,
        RS_MAP_RENDER_STATUS_OK,
        RS_MAP_RENDER_STATUS_INVALID_ARG,
        RS_MAP_RENDER_STATUS_STATE,
        RS_MAP_RENDER_STATUS_CAPACITY);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_build_map_plan_from_cache(
    const rs::i32 runtimeHandle,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::i32 borderSize,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 smoothTerrain,
    const rs::i32 locLoadType,
    const rs::i32 minimizeDrawCalls,
    const rs::i32 loadLocs,
    const rs::i32 loadObjs,
    const rs::i32 loadNpcs) {
    return runtimeBuildMapFromCacheInternal(
        runtimeHandle,
        mapX,
        mapY,
        borderSize,
        sizeX,
        sizeY,
        smoothTerrain,
        locLoadType,
        minimizeDrawCalls,
        loadLocs,
        loadObjs,
        loadNpcs,
        /*buildPayload=*/false);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_get_packet_meta(
    const rs::i32 packetHandle,
    rs::i32* outPackedMeta,
    const rs::i32 outPackedMetaLength) {
    if (packetHandle <= 0 || !outPackedMeta) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    const MapRenderPacketHandleState* handleState =
        gMapRenderPacketHandles.get(packetHandle);
    if (!handleState) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderRuntimeState* runtime =
        getMapRenderRuntimeConst(handleState->runtimeHandle);
    if (!runtime || !runtime->mapPayload.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (runtime->payloadGeneration != handleState->payloadGeneration) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    return rs::tooling::packRenderPacketMeta(
        runtime->mapPayload,
        outPackedMeta,
        outPackedMetaLength);
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_release_packet(const rs::i32 packetHandle) {
    if (packetHandle <= 0) {
        return 0;
    }
    return gMapRenderPacketHandles.destroy(packetHandle) ? 1 : 0;
}
