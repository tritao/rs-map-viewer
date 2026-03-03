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
// Keep the last successful full build intact across plan-only debug builds.
if (buildPayload) {
    runtime->lastBuiltCommandStreamFull.clear();
}
runtime->debugLastBuildFailureStage = kBuildFailNone;
runtime->debugLastBuildFailureStatus = 0;
runtime->debugLastBuildFailureDetail0 = 0;
runtime->debugLastBuildFailureDetail1 = 0;
runtime->debugLastBuildStageTimingsUs.fill(0);

using BuildClock = std::chrono::steady_clock;
const auto buildStart = BuildClock::now();
const auto elapsedUs = [](const BuildClock::time_point start) noexcept -> rs::i32 {
    const auto us = std::chrono::duration_cast<std::chrono::microseconds>(
        BuildClock::now() - start);
    if (us.count() > static_cast<long long>(std::numeric_limits<rs::i32>::max())) {
        return std::numeric_limits<rs::i32>::max();
    }
    if (us.count() < 0) {
        return 0;
    }
    return static_cast<rs::i32>(us.count());
};
const auto recordTotalTiming = [&]() noexcept {
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingTotalUs)] =
        elapsedUs(buildStart);
};
const auto failBuild = [&](const rs::i32 stage,
                           const rs::i32 status,
                           const rs::i32 detail0 = 0,
                           const rs::i32 detail1 = 0) noexcept -> rs::i32 {
    recordTotalTiming();
    return recordBuildFailure(runtime, stage, status, detail0, detail1);
};

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

const auto collectStart = BuildClock::now();
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCollectMapInputUs)] =
    elapsedUs(collectStart);
if (collectStatus != RS_MAP_RENDER_STATUS_OK &&
    !(collectStatus == RS_MAP_RENDER_STATUS_NOT_FOUND &&
      collectDebug.reason == kCollectMapInputReasonNoSquaresInWindow)) {
    return failBuild(
        kBuildFailCollectMapInput,
        collectStatus,
        collectDebug.reason,
        collectDebug.squaresWithAny);
}

rs::i32 cacheSeedHash = 0;
const auto seedHashStart = BuildClock::now();
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingSeedHashUs)] =
    elapsedUs(seedHashStart);

MapRenderCachedCommandStream commandStream{};
rs::SceneLocAnimatedTickInit locTickInit{};
rs::Status commandStreamStatus = rs::Status::Ok;
const auto commandStreamStart = BuildClock::now();
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
        &commandStreamStatus,
        buildPayload ? &locTickInit : nullptr);
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingBuildCommandStreamUs)] =
    elapsedUs(commandStreamStart);
if (nativeBuildResult != RuntimeCommandStreamBuildResult::Built || !commandStream.loaded) {
    runtime->lastBuiltCommandStream.clear();
    return failBuild(
        kBuildFailCommandStream,
        RS_MAP_RENDER_STATUS_STATE,
        static_cast<rs::i32>(commandStreamStatus),
        static_cast<rs::i32>(nativeBuildResult));
}
runtime->lastBuiltCommandStream = commandStream;
if (buildPayload) {
    runtime->lastBuiltCommandStreamFull = commandStream;
}

// If any resource lookups recorded missing blob keys (legacy model/seq files, type-entry bytes, etc),
// treat this as "not found" so the worker/parity loop can upload the missing blobs and retry.
// Otherwise we'll silently build an incomplete scene (skipping mergeNormals/geometry) and diverge
// from the TS path that has the bytes available.
if (!runtime->lastMissingBlobTriples.empty()) {
    runtime->lastBuiltCommandStream.clear();
    return failBuild(
        kBuildFailCommandStream,
        RS_MAP_RENDER_STATUS_NOT_FOUND,
        static_cast<rs::i32>(runtime->lastMissingBlobTriples.size() / 3U),
        0);
}

// If loc-animation tick init data was captured, register per-map tick state directly in the
// runtime so TS does not need to pre-pack tick state fields.
const auto registerTickStart = BuildClock::now();
{
	    const rs::i32 mapId = (((mapX | 0) & 0xff) << 8) | ((mapY | 0) & 0xff);
	    const std::size_t locCount = locTickInit.locSeqIds.size();
	    MapRenderTickState tickState{};
	    tickState.locCount = static_cast<rs::i32>(locCount);
	    tickState.npcCount = 0;
	    tickState.npcNullAlphaFrameOffset = 0;

	    // Copy loc seq ids into a compact std::vector for metadata derivation.
	    std::vector<rs::i32> locSeqIds{};
	    locSeqIds.reserve(locCount);
	    for (std::size_t i = 0; i < locCount; i++) {
	        locSeqIds.push_back(locTickInit.locSeqIds[i]);
	    }

	    std::vector<rs::i32> locFrameSteps{};
	    std::vector<rs::i32> locHasAnimMaya{};
	    std::vector<rs::i32> locAnimMayaDurations{};
	    std::vector<rs::i32> locFrameLengthOffsets{};
	    std::vector<rs::i32> locFrameLengthCounts{};
	    std::vector<rs::i32> locFrameLengthsPacked{};
	    const rs::i32 metaStatus = deriveLocSeqMetadataFromCompactIds(
	        runtime,
	        locSeqIds,
	        &locFrameSteps,
	        &locHasAnimMaya,
	        &locAnimMayaDurations,
	        &locFrameLengthOffsets,
	        &locFrameLengthCounts,
	        &locFrameLengthsPacked);
	    if (metaStatus < 0) {
	        // Defensive: keep the map renderable even if tick metadata can't be derived.
	        locFrameSteps.assign(locCount, 0);
	        locHasAnimMaya.assign(locCount, 0);
	        locAnimMayaDurations.assign(locCount, 0);
	        locFrameLengthOffsets.assign(locCount, -1);
	        locFrameLengthCounts.assign(locCount, 0);
	        locFrameLengthsPacked.clear();
	    }

	    std::vector<rs::i32> locFrameIds(locCount, 0);
	    std::vector<rs::i32> locCycleStartsFixed(locCount, -RS_LOC_CYCLE_SCALE);
	    for (std::size_t i = 0; i < locCount; i++) {
	        const rs::i32 frameStep = i < locFrameSteps.size() ? locFrameSteps[i] : -1;
	        const bool randomStart = i < locTickInit.locRandomStart.size() && locTickInit.locRandomStart[i] != 0;
	        const rs::i32 sortKey = i < locTickInit.locSortKeys.size() ? locTickInit.locSortKeys[i] : static_cast<rs::i32>(i);

	        rs::u32 h0 = 2166136261u;
	        h0 = fnv1a32UpdateI32(h0, mapId);
	        h0 = fnv1a32UpdateI32(h0, locSeqIds.size() > i ? locSeqIds[i] : -1);
	        h0 = fnv1a32UpdateI32(h0, sortKey);
	        const rs::u32 h1 = fnv1a32UpdateI32(h0, 0x9e3779b9u);

	        rs::i32 frame = 0;
	        rs::i32 cycleStartFixed = -RS_LOC_CYCLE_SCALE;
	        if (randomStart && frameStep != -1) {
	            const bool isMaya = i < locHasAnimMaya.size() && locHasAnimMaya[i] != 0;
	            if (isMaya) {
	                const rs::i32 duration = i < locAnimMayaDurations.size() ? locAnimMayaDurations[i] : 0;
	                if (duration > 0) {
	                    frame = static_cast<rs::i32>(h0 % static_cast<rs::u32>(duration));
	                }
	            } else {
	                const rs::i32 frameCount =
	                    (i < locTickInit.locAnimFrameCountsBase.size()) ? locTickInit.locAnimFrameCountsBase[i] : 0;
	                if (frameCount > 0) {
	                    frame = static_cast<rs::i32>(h0 % static_cast<rs::u32>(frameCount));
	                    // Randomize initial cycle start within the frame length (TS LocAnimated constructor).
	                    rs::i32 frameLen = 1;
	                    const rs::i32 off = i < locFrameLengthOffsets.size() ? locFrameLengthOffsets[i] : -1;
	                    const rs::i32 cnt = i < locFrameLengthCounts.size() ? locFrameLengthCounts[i] : 0;
	                    if (off >= 0 && cnt > 0 && frame >= 0 && frame < cnt) {
	                        const std::size_t at = static_cast<std::size_t>(off + frame);
	                        if (at < locFrameLengthsPacked.size()) {
	                            const rs::i32 v = locFrameLengthsPacked[at];
	                            frameLen = v > 0 ? v : 1;
	                        }
	                    }
	                    const rs::i32 jitter = frameLen > 0 ? static_cast<rs::i32>(h1 % static_cast<rs::u32>(frameLen)) : 0;
	                    cycleStartFixed -= jitter * RS_LOC_CYCLE_SCALE;
	                }
	            }
	        }
	        locFrameIds[i] = frame;
	        locCycleStartsFixed[i] = cycleStartFixed;
	    }

	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_IDS)] = std::move(locFrameIds);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_CYCLE_STARTS_FIXED)] = std::move(locCycleStartsFixed);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_STEPS)] = std::move(locFrameSteps);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_HAS_ANIM_MAYA)] = std::move(locHasAnimMaya);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_MAYA_DURATIONS)] = std::move(locAnimMayaDurations);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS)] = std::move(locFrameLengthOffsets);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_LENGTH_COUNTS)] = std::move(locFrameLengthCounts);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_LENGTHS_PACKED)] = std::move(locFrameLengthsPacked);

	    auto copyRsVec = [](const rs::Vec<rs::i32>& src) -> std::vector<rs::i32> {
	        std::vector<rs::i32> out{};
	        out.reserve(src.size());
	        for (std::size_t i = 0; i < src.size(); i++) {
	            out.push_back(src[i]);
	        }
	        return out;
	    };

	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_BASE)] = copyRsVec(locTickInit.locDrawRangeIndicesBase);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_BASE)] = copyRsVec(locTickInit.locAnimFrameOffsetsBase);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_FRAME_COUNTS_BASE)] = copyRsVec(locTickInit.locAnimFrameCountsBase);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_FRAMES_BASE_PACKED)] = copyRsVec(locTickInit.locAnimFramesBasePacked);

	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_ALPHA)] = copyRsVec(locTickInit.locDrawRangeIndicesAlpha);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD)] = copyRsVec(locTickInit.locDrawRangeIndicesLod);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD_ALPHA)] = copyRsVec(locTickInit.locDrawRangeIndicesLodAlpha);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT)] = copyRsVec(locTickInit.locDrawRangeIndicesInteract);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_ALPHA)] = copyRsVec(locTickInit.locDrawRangeIndicesInteractAlpha);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD)] = copyRsVec(locTickInit.locDrawRangeIndicesInteractLod);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD_ALPHA)] = copyRsVec(locTickInit.locDrawRangeIndicesInteractLodAlpha);

	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_ALPHA)] = copyRsVec(locTickInit.locAnimFrameOffsetsAlpha);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_FRAME_COUNTS_ALPHA)] = copyRsVec(locTickInit.locAnimFrameCountsAlpha);
	    tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_FRAMES_ALPHA_PACKED)] = copyRsVec(locTickInit.locAnimFramesAlphaPacked);

    runtime->tickStates[mapId] = std::move(tickState);
}
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingRegisterTickStateUs)] =
    elapsedUs(registerTickStart);

if (!buildPayload) {
    const auto finalizeStart = BuildClock::now();
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    runtime->debugLastBuildFailureStage = kBuildFailNone;
    runtime->debugLastBuildFailureStatus = 0;
    runtime->debugLastBuildFailureDetail0 = 0;
    runtime->debugLastBuildFailureDetail1 = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingFinalizePayloadUs)] =
        elapsedUs(finalizeStart);
    recordTotalTiming();
    return RS_MAP_RENDER_STATUS_OK;
}

const auto planPayloadStart = BuildClock::now();
const rs::i32 totalCmdCount = static_cast<rs::i32>(commandStream.cmdOffsets.size());
if (commandStream.cmdBucketIndices.size() != commandStream.cmdOffsets.size() ||
    commandStream.cmdElements.size() != commandStream.cmdOffsets.size() ||
    commandStream.cmdInstanceCounts.size() != commandStream.cmdOffsets.size()) {
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingPlanPayloadUs)] =
        elapsedUs(planPayloadStart);
    return failBuild(kBuildFailPlanPayload, RS_MAP_RENDER_STATUS_STATE);
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
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingPlanPayloadUs)] =
        elapsedUs(planPayloadStart);
    return failBuild(
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingPlanPayloadUs)] =
    elapsedUs(planPayloadStart);

const auto buildPayloadStart = BuildClock::now();
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingBuildPayloadUs)] =
    elapsedUs(buildPayloadStart);
if (buildStatus != RS_MAP_RENDER_STATUS_OK) {
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    return failBuild(kBuildFailBuildPayload, buildStatus);
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

const auto storePayloadStart = BuildClock::now();
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingStorePayloadUs)] =
    elapsedUs(storePayloadStart);
if (storeStatus != 1) {
    runtime->mapPayload.clear();
    runtime->payloadGeneration++;
    clearPacketHandlesForRuntime(runtimeHandle);
    return failBuild(kBuildFailStorePayload, RS_MAP_RENDER_STATUS_STATE, storeStatus, 0);
}

runtime->debugLastNpcBuildStatus = 0;
runtime->debugLastNpcSpawnBytesLength = 0;
runtime->debugLastNpcSpawnsDecoded = 0;
runtime->debugLastNpcSpawnsInBounds = 0;
runtime->debugLastNpcResolvedType = 0;
runtime->debugLastNpcLoginPropRenderable = 0;
runtime->debugLastNpcModelDecodeOk = 0;
runtime->debugLastNpcModelDecodeFailed = 0;
runtime->debugLastNpcSpawnsWithGeometry = 0;
runtime->debugLastNpcDrawRangeCount = 0;
runtime->debugLastNpcVertexBytes = 0;
runtime->debugLastNpcIndexCount = 0;
const auto buildNpcStart = BuildClock::now();
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingBuildNpcUs)] =
    elapsedUs(buildNpcStart);

// Derive used texture ids from packed vertices so TS can drive texture residency without
// building a full TS SceneBuffer scaffold.
//
// Vertex format stores 0-based indices into the runtime `textureIds` list; shader adds +1.
// Decode both primary and blended texture ids and map back to raw texture ids using the
// uploaded SD texture id list (domain=109).
const auto deriveTexturesStart = BuildClock::now();
{
    std::vector<rs::i32> textureIds{};
    collectBlobDomainTypeListPreferPayloadOrKeys(runtime, RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS, &textureIds);
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
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingDeriveUsedTextureIdsUs)] =
    elapsedUs(deriveTexturesStart);
const auto finalizeStart = BuildClock::now();
runtime->payloadGeneration++;
clearPacketHandlesForRuntime(runtimeHandle);
runtime->debugLastCacheScratchHeightHash = static_cast<rs::i32>(
    fnv1a32SpanI16(runtimeScratchHeightMap));
runtime->debugLastBuildFailureStage = kBuildFailNone;
runtime->debugLastBuildFailureStatus = 0;
runtime->debugLastBuildFailureDetail0 = 0;
runtime->debugLastBuildFailureDetail1 = 0;
runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingFinalizePayloadUs)] =
    elapsedUs(finalizeStart);
recordTotalTiming();

return RS_MAP_RENDER_STATUS_OK;
