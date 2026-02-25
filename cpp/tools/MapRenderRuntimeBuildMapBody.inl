(void)loadNpcs;
MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
if (!runtime || sizeX <= 0 || sizeY <= 0 || borderSize < 0) {
    return RS_MAP_RENDER_STATUS_INVALID_ARG;
}
if (runtime->cache.unitsTileHeightBasis <= 0) {
    return RS_MAP_RENDER_STATUS_STATE;
}
runtime->lastBuiltCommandStream.clear();

const rs::i32 baseX = mapX * kMapSquareSize - borderSize;
const rs::i32 baseY = mapY * kMapSquareSize - borderSize;

std::vector<rs::i32> mapSquareIds;
std::vector<rs::i32> terrainOffsets;
std::vector<rs::i32> terrainLengths;
std::vector<rs::u8> terrainBytes;
std::vector<rs::i32> locOffsets;
std::vector<rs::i32> locLengths;
std::vector<rs::u8> locBytes;

const rs::i32 collectStatus = collectRuntimeCachedMapInput(
    *runtime,
    baseX,
    baseY,
    sizeX,
    sizeY,
    &mapSquareIds,
    &terrainOffsets,
    &terrainLengths,
    &terrainBytes,
    &locOffsets,
    &locLengths,
    &locBytes);
if (collectStatus != RS_MAP_RENDER_STATUS_OK) {
    return collectStatus;
}

rs::i32 cacheSeedHash = 0;
const rs::i32 cacheSeedStatus = computeSeedTileHeightsHashFromMapInput(
    baseX,
    baseY,
    sizeX,
    sizeY,
    smoothTerrain,
    locLoadType,
    runtime->cache.cacheGame,
    runtime->cache.cacheRevision,
    static_cast<rs::i32>(mapSquareIds.size()),
    mapSquareIds.data(),
    terrainOffsets.data(),
    terrainLengths.data(),
    terrainBytes.data(),
    static_cast<rs::i32>(terrainBytes.size()),
    locOffsets.data(),
    locLengths.data(),
    locBytes.data(),
    static_cast<rs::i32>(locBytes.size()),
    &cacheSeedHash);
if (cacheSeedStatus == RS_MAP_RENDER_STATUS_OK) {
    runtime->debugLastMapInputHashCache = cacheSeedHash;
}

const rs::i32 typesStatus = ensureRuntimeSceneTypesInitialized(runtime);
if (typesStatus != RS_MAP_RENDER_STATUS_OK) {
    return typesStatus;
}

// Keep a debug snapshot of collision flags for parity and worker-side debugging.
// Collision is independent of command-stream generation (models), so compute it from the
// same cache inputs before building the command stream.
const rs::i32 collisionStatus = buildRuntimeCollisionFlagsFromCachedMapInput(
    runtime,
    baseX,
    baseY,
    sizeX,
    sizeY,
    locLoadType,
    mapSquareIds,
    terrainOffsets,
    terrainLengths,
    terrainBytes,
    locOffsets,
    locLengths,
    locBytes);
if (collisionStatus != RS_MAP_RENDER_STATUS_OK) {
    return collisionStatus;
}

MapRenderCachedCommandStream commandStream{};
const RuntimeCommandStreamBuildResult nativeBuildResult =
    tryBuildRuntimeCommandStreamFromBytes(
        runtime,
        baseX,
        baseY,
        sizeX,
        sizeY,
        smoothTerrain,
        locLoadType,
        minimizeDrawCalls,
        loadLocs,
        loadObjs,
        mapSquareIds,
        terrainOffsets,
        terrainLengths,
        terrainBytes,
        locOffsets,
        locLengths,
        locBytes,
        !buildPayload,
        &commandStream);
if (nativeBuildResult != RuntimeCommandStreamBuildResult::Built || !commandStream.loaded) {
    runtime->lastBuiltCommandStream.clear();
    return RS_MAP_RENDER_STATUS_STATE;
}
runtime->lastBuiltCommandStream = commandStream;

if (!buildPayload) {
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    return RS_MAP_RENDER_STATUS_OK;
}

const rs::i32 totalCmdCount = static_cast<rs::i32>(commandStream.cmdOffsets.size());
if (commandStream.cmdBucketIndices.size() != commandStream.cmdOffsets.size() ||
    commandStream.cmdElements.size() != commandStream.cmdOffsets.size() ||
    commandStream.cmdInstanceCounts.size() != commandStream.cmdOffsets.size()) {
    return RS_MAP_RENDER_STATUS_STATE;
}

std::array<rs::i32, kRuntimeDrawBucketCount> runtimeScratchBucketCmdCounts{};
std::array<rs::i32, kRuntimeDrawBucketCount> runtimeScratchBucketModelInfoLengths{};
rs::i32 runtimeScratchPlannedTotalModelInfoLength = 0;
const rs::i32 planStatus = planCommandStreamBucketsAndModelInfo(
    totalCmdCount > 0 ? commandStream.cmdBucketIndices.data() : nullptr,
    totalCmdCount > 0 ? commandStream.cmdInstanceCounts.data() : nullptr,
    totalCmdCount,
    runtimeScratchBucketCmdCounts.data(),
    static_cast<rs::i32>(runtimeScratchBucketCmdCounts.size()),
    runtimeScratchBucketModelInfoLengths.data(),
    static_cast<rs::i32>(runtimeScratchBucketModelInfoLengths.size()),
    &runtimeScratchPlannedTotalModelInfoLength);
if (planStatus != RS_MAP_RENDER_STATUS_OK || runtimeScratchPlannedTotalModelInfoLength < 0) {
    return RS_MAP_RENDER_STATUS_STATE;
}
const rs::i32 runtimeScratchModelInfoCapacity =
    runtimeScratchPlannedTotalModelInfoLength > (2147483647 - (1 << 20))
    ? runtimeScratchPlannedTotalModelInfoLength
    : (runtimeScratchPlannedTotalModelInfoLength + (1 << 20));
std::vector<rs::u16> runtimeScratchModelInfoTextureConcat(
    static_cast<std::size_t>(runtimeScratchModelInfoCapacity));
const rs::i32 runtimeScratchHeightMapLength = RS_SCENE_LEVELS * sizeX * sizeY;
std::vector<rs::i16> runtimeScratchHeightMap(
    static_cast<std::size_t>(runtimeScratchHeightMapLength));
std::vector<rs::i32> runtimeScratchDrawRanges(
    static_cast<std::size_t>(totalCmdCount) * 3U);
rs::i32 runtimeScratchTotalModelInfoLength = 0;

const rs::i32 buildStatus =
    rs_build_map_payload_from_map_squares_and_command_stream_internal(
        baseX,
        baseY,
        sizeX,
        sizeY,
        locLoadType,
        runtime->cache.cacheGame,
        runtime->cache.cacheRevision,
        static_cast<rs::i32>(mapSquareIds.size()),
        mapSquareIds.data(),
        terrainOffsets.data(),
        terrainLengths.data(),
        terrainBytes.data(),
        static_cast<rs::i32>(terrainBytes.size()),
        locOffsets.data(),
        locLengths.data(),
        locBytes.data(),
        static_cast<rs::i32>(locBytes.size()),
        runtime->cache.unitsTileHeightBasis,
        totalCmdCount > 0 ? commandStream.cmdBucketIndices.data() : nullptr,
        totalCmdCount > 0 ? commandStream.cmdOffsets.data() : nullptr,
        totalCmdCount > 0 ? commandStream.cmdElements.data() : nullptr,
        totalCmdCount > 0 ? commandStream.cmdInstanceCounts.data() : nullptr,
        totalCmdCount,
        commandStream.cmdPackedInstances.empty() ? nullptr : commandStream.cmdPackedInstances.data(),
        static_cast<rs::i32>(commandStream.cmdPackedInstances.size()),
        runtimeScratchBucketCmdCounts.data(),
        static_cast<rs::i32>(runtimeScratchBucketCmdCounts.size()),
        runtimeScratchBucketModelInfoLengths.data(),
        static_cast<rs::i32>(runtimeScratchBucketModelInfoLengths.size()),
        &runtimeScratchTotalModelInfoLength,
        runtimeScratchDrawRanges.empty() ? nullptr : runtimeScratchDrawRanges.data(),
        static_cast<rs::i32>(runtimeScratchDrawRanges.size()),
        runtimeScratchModelInfoTextureConcat.data(),
        static_cast<rs::i32>(runtimeScratchModelInfoTextureConcat.size()),
        runtimeScratchHeightMap.data(),
        static_cast<rs::i32>(runtimeScratchHeightMap.size()));
if (buildStatus != RS_MAP_RENDER_STATUS_OK) {
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    return buildStatus;
}
// Geometry is expected to come from the cached command stream.
const rs::u8* runtimeGeometryVertices =
    commandStream.vertices.empty() ? nullptr : commandStream.vertices.data();
const rs::i32 runtimeGeometryVerticesLength =
    static_cast<rs::i32>(commandStream.vertices.size());
const rs::i32* runtimeGeometryIndices =
    commandStream.indices.empty() ? nullptr : commandStream.indices.data();
const rs::i32 runtimeGeometryIndicesLength =
    static_cast<rs::i32>(commandStream.indices.size());

const rs::i32 storeStatus = rs::tooling::storeLoadedPayload(
    &runtime->mapPayload,
    runtimeScratchBucketCmdCounts.data(),
    static_cast<rs::i32>(runtimeScratchBucketCmdCounts.size()),
    runtimeScratchBucketModelInfoLengths.data(),
    static_cast<rs::i32>(runtimeScratchBucketModelInfoLengths.size()),
    &runtimeScratchTotalModelInfoLength,
    runtimeScratchDrawRanges.empty() ? nullptr : runtimeScratchDrawRanges.data(),
    static_cast<rs::i32>(runtimeScratchDrawRanges.size()),
    runtimeScratchModelInfoTextureConcat.empty()
        ? nullptr
        : runtimeScratchModelInfoTextureConcat.data(),
    static_cast<rs::i32>(runtimeScratchModelInfoTextureConcat.size()),
    runtimeScratchHeightMap.empty() ? nullptr : runtimeScratchHeightMap.data(),
    static_cast<rs::i32>(runtimeScratchHeightMap.size()),
    runtimeGeometryVertices,
    runtimeGeometryVerticesLength,
    runtimeGeometryIndices,
    runtimeGeometryIndicesLength,
    RS_SCENE_LEVELS,
    sizeX,
    sizeY,
    runtime->cache.unitsTileHeightBasis);
if (storeStatus != 1) {
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    return RS_MAP_RENDER_STATUS_STATE;
}
runtime->payloadGeneration++;
clearPacketHandlesForRuntime(runtimeHandle);
runtime->debugLastCacheScratchHeightHash = static_cast<rs::i32>(
    fnv1a32SpanI16(runtimeScratchHeightMap));

return RS_MAP_RENDER_STATUS_OK;
