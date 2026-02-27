MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
if (!runtime || sizeX <= 0 || sizeY <= 0 || borderSize < 0) {
    return recordBuildFailure(runtime, kBuildFailInvalidArg, RS_MAP_RENDER_STATUS_INVALID_ARG, sizeX, sizeY);
}
if (runtime->cache.unitsTileHeightBasis <= 0) {
    return recordBuildFailure(
        runtime,
        kBuildFailInvalidArg,
        RS_MAP_RENDER_STATUS_STATE,
        runtime->cache.unitsTileHeightBasis,
        0);
}
runtime->lastBuiltCommandStream.clear();
runtime->debugLastBuildFailureStage = kBuildFailNone;
runtime->debugLastBuildFailureStatus = 0;
runtime->debugLastBuildFailureDetail0 = 0;
runtime->debugLastBuildFailureDetail1 = 0;

const rs::i32 baseX = mapX * kMapSquareSize - borderSize;
const rs::i32 baseY = mapY * kMapSquareSize - borderSize;

std::vector<rs::i32> mapSquareIds;
std::vector<rs::i32> terrainOffsets;
std::vector<rs::i32> terrainLengths;
std::vector<rs::u8> terrainBytes;
std::vector<rs::i32> locOffsets;
std::vector<rs::i32> locLengths;
std::vector<rs::u8> locBytes;
CollectRuntimeCachedMapInputDebug collectDebug{};

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
    &locBytes,
    &collectDebug);
runtime->debugLastCollectMapInputStatus = collectDebug.status;
runtime->debugLastCollectMapInputReason = collectDebug.reason;
runtime->debugLastCollectMapInputMapStartX = collectDebug.mapStartX;
runtime->debugLastCollectMapInputMapStartY = collectDebug.mapStartY;
runtime->debugLastCollectMapInputMapEndX = collectDebug.mapEndX;
runtime->debugLastCollectMapInputMapEndY = collectDebug.mapEndY;
runtime->debugLastCollectMapInputExpectedSquares = collectDebug.expectedSquares;
runtime->debugLastCollectMapInputSquaresWithAny = collectDebug.squaresWithAny;
runtime->debugLastCollectMapInputSquaresWithTerrain = collectDebug.squaresWithTerrain;
runtime->debugLastCollectMapInputSquaresWithLoc = collectDebug.squaresWithLoc;
runtime->debugLastCollectMapInputFirstPresentMapSquareId = collectDebug.firstPresentMapSquareId;
runtime->debugLastCollectMapInputFirstMissingMapSquareId = collectDebug.firstMissingMapSquareId;
if (collectStatus != RS_MAP_RENDER_STATUS_OK &&
    !(collectStatus == RS_MAP_RENDER_STATUS_NOT_FOUND &&
      collectDebug.reason == kCollectMapInputReasonNoSquaresInWindow)) {
    return recordBuildFailure(
        runtime,
        kBuildFailCollectMapInput,
        collectStatus,
        collectDebug.reason,
        collectDebug.squaresWithAny);
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

MapRenderCachedCommandStream commandStream{};
rs::Status commandStreamStatus = rs::Status::Ok;
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
        &commandStream,
        &commandStreamStatus);
if (nativeBuildResult != RuntimeCommandStreamBuildResult::Built || !commandStream.loaded) {
    runtime->lastBuiltCommandStream.clear();
    return recordBuildFailure(
        runtime,
        kBuildFailCommandStream,
        RS_MAP_RENDER_STATUS_STATE,
        static_cast<rs::i32>(commandStreamStatus),
        static_cast<rs::i32>(nativeBuildResult));
}
runtime->lastBuiltCommandStream = commandStream;

if (!buildPayload) {
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    runtime->debugLastBuildFailureStage = kBuildFailNone;
    return RS_MAP_RENDER_STATUS_OK;
}

const rs::i32 totalCmdCount = static_cast<rs::i32>(commandStream.cmdOffsets.size());
if (commandStream.cmdBucketIndices.size() != commandStream.cmdOffsets.size() ||
    commandStream.cmdElements.size() != commandStream.cmdOffsets.size() ||
    commandStream.cmdInstanceCounts.size() != commandStream.cmdOffsets.size()) {
    return recordBuildFailure(runtime, kBuildFailPlanPayload, RS_MAP_RENDER_STATUS_STATE);
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
    return recordBuildFailure(
        runtime,
        kBuildFailPlanPayload,
        RS_MAP_RENDER_STATUS_STATE,
        planStatus,
        runtimeScratchPlannedTotalModelInfoLength);
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
    return recordBuildFailure(runtime, kBuildFailBuildPayload, buildStatus);
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
    return recordBuildFailure(runtime, kBuildFailStorePayload, RS_MAP_RENDER_STATUS_STATE, storeStatus, 0);
}

if ((loadNpcs | 0) != 0) {
    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    const rs::i32 npcStatus = tryBuildNpcGeometryForMapSquareIntoPayloadFromCache(
        runtime,
        cacheInfo,
        mapX,
        mapY,
        borderSize,
        sizeX,
        sizeY,
        &runtime->mapPayload);
    if (npcStatus != RS_MAP_RENDER_STATUS_OK) {
        // NPCs are optional; don't fail the base packet build.
        runtime->mapPayload.npcDrawRangesBase.clear();
        runtime->mapPayload.npcDrawRangesAlpha.clear();
        runtime->mapPayload.npcVertices.clear();
        runtime->mapPayload.npcIndices.clear();
        runtime->mapPayload.npcOrderKeys.clear();
    }
}

// Derive used texture ids from packed vertices so TS can drive texture residency without
// building a full TS SceneBuffer scaffold.
//
// Vertex format stores 0-based indices into the runtime `textureIds` list; shader adds +1.
// Decode both primary and blended texture ids and map back to raw texture ids using the
// uploaded SD texture id list (domain=109).
{
    std::vector<rs::i32> textureIds{};
    collectBlobDomainGroup0IdsSortedUnique(runtime, RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS, &textureIds);
    runtime->mapPayload.usedTextureIds.clear();
    if (!textureIds.empty() && !runtime->mapPayload.vertices.empty()) {
        std::vector<rs::u8> seen(textureIds.size(), 0);

        const auto readU32LE = [](const rs::u8* p) noexcept -> rs::u32 {
            return static_cast<rs::u32>(p[0]) |
                (static_cast<rs::u32>(p[1]) << 8u) |
                (static_cast<rs::u32>(p[2]) << 16u) |
                (static_cast<rs::u32>(p[3]) << 24u);
        };

        const rs::u8* vbytes = runtime->mapPayload.vertices.data();
        const std::size_t vcount = runtime->mapPayload.vertices.size() / 16;
        for (std::size_t vi = 0; vi < vcount; vi++) {
            const rs::u8* base = vbytes + (vi * 16);
            const rs::u32 v1 = readU32LE(base + 4);
            const rs::u32 v2 = readU32LE(base + 8);
            const rs::u32 v3 = readU32LE(base + 12);
            const rs::u32 isTextured = (v1 >> 31u) & 0x1u;
            if (!isTextured) {
                continue;
            }
            const rs::u32 hsl = (v1 >> 15u) & 0xffffu;
            const rs::u32 idx0 =
                (hsl >> 7u) |
                (((v2 >> 5u) & 0x1u) << 9u) |
                (((v3 >> 19u) & 0x1u) << 10u);
            if (idx0 < textureIds.size()) {
                seen[idx0] = 1;
            }
            const rs::u32 hasBlend = (v3 >> 10u) & 0x1u;
            if (hasBlend) {
                const rs::u32 idx1 =
                    (v3 & 0x3ffu) |
                    (((v3 >> 20u) & 0x1u) << 10u);
                if (idx1 < textureIds.size()) {
                    seen[idx1] = 1;
                }
            }
        }

        for (std::size_t i = 0; i < seen.size(); i++) {
            if (!seen[i]) {
                continue;
            }
            runtime->mapPayload.usedTextureIds.push_back(textureIds[i]);
        }
    }
}
runtime->payloadGeneration++;
clearPacketHandlesForRuntime(runtimeHandle);
runtime->debugLastCacheScratchHeightHash = static_cast<rs::i32>(
    fnv1a32SpanI16(runtimeScratchHeightMap));
runtime->debugLastBuildFailureStage = kBuildFailNone;
runtime->debugLastBuildFailureStatus = 0;
runtime->debugLastBuildFailureDetail0 = 0;
runtime->debugLastBuildFailureDetail1 = 0;

return RS_MAP_RENDER_STATUS_OK;
