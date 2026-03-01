// Extracted from `cpp/tools/rs_map_render_backend.cpp` (no behavior changes).

RS_WASM_KEEPALIVE rs::i32 rs_tick_advance_and_emit_base_patches(
    rs::i32* inOutLocFrameIds,
    rs::i32* inOutLocCycleStartsFixed,
    const rs::i32* locFrameSteps,
    const rs::i32* locHasAnimMaya,
    const rs::i32* locAnimMayaDurations,
    const rs::i32* locFrameLengthOffsets,
    const rs::i32* locFrameLengthCounts,
    rs::i32 locCount,
    rs::i32 cycleNowFixed,
    const rs::i32* locFrameLengthsPacked,
    rs::i32 locFrameLengthsPackedLength,
    rs::i32* outLocActiveFlags,
    const rs::i32* locDrawRangeIndicesBase,
    const rs::i32* locAnimFrameOffsetsBase,
    const rs::i32* locAnimFrameCountsBase,
    const rs::i32* locAnimFramesBasePacked,
    rs::i32 locAnimFramesBasePackedLength,
    rs::i32* outLocPatchesPacked,
    rs::i32 outLocPatchesPackedLength,
    rs::i32* outLocBasePatchCount,
    const rs::i32* locDrawRangeIndicesAlpha,
    const rs::i32* locDrawRangeIndicesLod,
    const rs::i32* locDrawRangeIndicesLodAlpha,
    const rs::i32* locDrawRangeIndicesInteract,
    const rs::i32* locDrawRangeIndicesInteractAlpha,
    const rs::i32* locDrawRangeIndicesInteractLod,
    const rs::i32* locDrawRangeIndicesInteractLodAlpha,
    const rs::i32* locAnimFrameOffsetsAlpha,
    const rs::i32* locAnimFrameCountsAlpha,
    const rs::i32* locAnimFramesAlphaPacked,
    rs::i32 locAnimFramesAlphaPackedLength,
    rs::i32* outLocAlphaPatchesPacked,
    rs::i32 outLocAlphaPatchesPackedLength,
    rs::i32* outLocAlphaPatchCount,
    rs::i32* outLocLodPatchesPacked,
    rs::i32 outLocLodPatchesPackedLength,
    rs::i32* outLocLodPatchCount,
    rs::i32* outLocLodAlphaPatchesPacked,
    rs::i32 outLocLodAlphaPatchesPackedLength,
    rs::i32* outLocLodAlphaPatchCount,
    rs::i32* outLocInteractPatchesPacked,
    rs::i32 outLocInteractPatchesPackedLength,
    rs::i32* outLocInteractPatchCount,
    rs::i32* outLocInteractAlphaPatchesPacked,
    rs::i32 outLocInteractAlphaPatchesPackedLength,
    rs::i32* outLocInteractAlphaPatchCount,
    rs::i32* outLocInteractLodPatchesPacked,
    rs::i32 outLocInteractLodPatchesPackedLength,
    rs::i32* outLocInteractLodPatchCount,
    rs::i32* outLocInteractLodAlphaPatchesPacked,
    rs::i32 outLocInteractLodAlphaPatchesPackedLength,
    rs::i32* outLocInteractLodAlphaPatchCount,

    rs::i32* inOutNpcX,
    rs::i32* inOutNpcY,
    rs::i32* inOutNpcOrientation,
    rs::i32* inOutNpcRotation,
    rs::i32* inOutNpcPathLength,
    rs::i32* inOutNpcMovementSeqId,
    const rs::i32* npcPathXPacked,
    rs::i32 npcPathXPackedLength,
    const rs::i32* npcPathYPacked,
    rs::i32 npcPathYPackedLength,
    const rs::i32* npcPathMovementTypePacked,
    rs::i32 npcPathMovementTypePackedLength,
    const rs::i32* npcSize,
    const rs::i32* npcIsClickable,
    const rs::i32* npcRotationSpeed,
    const rs::i32* npcIdleSeqId,
    const rs::i32* npcWalkSeqId,
    const rs::i32* npcHasWalkAnim,
    rs::i32* inOutNpcFrameIds,
    rs::i32* inOutNpcFrameTicks,
    rs::i32* inOutNpcMovementLoops,
    rs::i32 npcCount,
    rs::i32 clientTickCount,
    const rs::i32* npcIdleSeqValid,
    const rs::i32* npcIdleSeqHasAnimMaya,
    const rs::i32* npcIdleSeqAnimMayaDurations,
    const rs::i32* npcIdleSeqFrameSteps,
    const rs::i32* npcIdleSeqLooping,
    const rs::i32* npcIdleSeqMaxLoops,
    const rs::i32* npcIdleSeqFrameIdCounts,
    const rs::i32* npcIdleSeqFrameLengthOffsets,
    const rs::i32* npcIdleSeqFrameLengthCounts,
    const rs::i32* npcWalkSeqValid,
    const rs::i32* npcWalkSeqHasAnimMaya,
    const rs::i32* npcWalkSeqAnimMayaDurations,
    const rs::i32* npcWalkSeqFrameSteps,
    const rs::i32* npcWalkSeqLooping,
    const rs::i32* npcWalkSeqMaxLoops,
    const rs::i32* npcWalkSeqFrameIdCounts,
    const rs::i32* npcWalkSeqFrameLengthOffsets,
    const rs::i32* npcWalkSeqFrameLengthCounts,
    const rs::i32* npcSeqFrameLengthsPacked,
    rs::i32 npcSeqFrameLengthsPackedLength,
    const rs::i32* npcDrawRangeIndices,
    const rs::i32* npcIdleAnimFrameOffsetsBase,
    const rs::i32* npcIdleAnimFrameCountsBase,
    const rs::i32* npcWalkAnimFrameOffsetsBase,
    const rs::i32* npcWalkAnimFrameCountsBase,
    const rs::i32* npcAnimFramesBasePacked,
    rs::i32 npcAnimFramesBasePackedLength,
    rs::i32* outNpcPatchesPacked,
    rs::i32 outNpcPatchesPackedLength,
    rs::i32* outNpcBasePatchCount,
    const rs::i32* npcIdleAnimFrameOffsetsAlpha,
    const rs::i32* npcIdleAnimFrameCountsAlpha,
    const rs::i32* npcWalkAnimFrameOffsetsAlpha,
    const rs::i32* npcWalkAnimFrameCountsAlpha,
    const rs::i32* npcAnimFramesAlphaPacked,
    rs::i32 npcAnimFramesAlphaPackedLength,
    rs::i32 npcNullAlphaFrameOffset,
    rs::i32* outNpcAlphaPatchesPacked,
    rs::i32 outNpcAlphaPatchesPackedLength,
    rs::i32* outNpcAlphaPatchCount) {
    if (!outLocBasePatchCount || !outLocAlphaPatchCount || !outLocLodPatchCount ||
        !outLocLodAlphaPatchCount || !outLocInteractPatchCount || !outLocInteractAlphaPatchCount ||
        !outLocInteractLodPatchCount || !outLocInteractLodAlphaPatchCount ||
        !outNpcBasePatchCount || !outNpcAlphaPatchCount) {
        return -1;
    }
    if (locCount < 0 || npcCount < 0 || clientTickCount < 0) {
        return -1;
    }

    *outLocBasePatchCount = 0;
    *outLocAlphaPatchCount = 0;
    *outLocLodPatchCount = 0;
    *outLocLodAlphaPatchCount = 0;
    *outLocInteractPatchCount = 0;
    *outLocInteractAlphaPatchCount = 0;
    *outLocInteractLodPatchCount = 0;
    *outLocInteractLodAlphaPatchCount = 0;
    *outNpcBasePatchCount = 0;
    *outNpcAlphaPatchCount = 0;

    if (locCount > 0) {
        if (!inOutLocFrameIds || !inOutLocCycleStartsFixed || !locFrameSteps || !locHasAnimMaya ||
            !locAnimMayaDurations || !locFrameLengthOffsets || !locFrameLengthCounts ||
            !outLocActiveFlags || !locDrawRangeIndicesBase || !locAnimFrameOffsetsBase ||
            !locAnimFrameCountsBase || !outLocPatchesPacked ||
            !locDrawRangeIndicesAlpha || !locDrawRangeIndicesLod || !locDrawRangeIndicesLodAlpha ||
            !locDrawRangeIndicesInteract || !locDrawRangeIndicesInteractAlpha ||
            !locDrawRangeIndicesInteractLod || !locDrawRangeIndicesInteractLodAlpha ||
            !locAnimFrameOffsetsAlpha || !locAnimFrameCountsAlpha ||
            !outLocAlphaPatchesPacked || !outLocLodPatchesPacked ||
            !outLocLodAlphaPatchesPacked || !outLocInteractPatchesPacked ||
            !outLocInteractAlphaPatchesPacked || !outLocInteractLodPatchesPacked ||
            !outLocInteractLodAlphaPatchesPacked) {
            return -1;
        }
        const rs::i32 locAdvanceStatus = rs_advance_loc_frames_fixed(
            inOutLocFrameIds,
            inOutLocCycleStartsFixed,
            locFrameSteps,
            locHasAnimMaya,
            locAnimMayaDurations,
            locFrameLengthOffsets,
            locFrameLengthCounts,
            locCount,
            cycleNowFixed,
            locFrameLengthsPacked,
            locFrameLengthsPackedLength,
            outLocActiveFlags);
        if (locAdvanceStatus != 1) {
            return locAdvanceStatus;
        }

        const rs::i32 locPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesBase,
            inOutLocFrameIds,
            locAnimFrameOffsetsBase,
            locAnimFrameCountsBase,
            locCount,
            locAnimFramesBasePacked,
            locAnimFramesBasePackedLength,
            outLocPatchesPacked,
            outLocPatchesPackedLength);
        if (locPatchCount < 0) {
            return locPatchCount;
        }
        *outLocBasePatchCount = locPatchCount;

        const rs::i32 locAlphaPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesAlpha,
            inOutLocFrameIds,
            locAnimFrameOffsetsAlpha,
            locAnimFrameCountsAlpha,
            locCount,
            locAnimFramesAlphaPacked,
            locAnimFramesAlphaPackedLength,
            outLocAlphaPatchesPacked,
            outLocAlphaPatchesPackedLength);
        if (locAlphaPatchCount < 0) {
            return locAlphaPatchCount;
        }
        *outLocAlphaPatchCount = locAlphaPatchCount;

        const rs::i32 locLodPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesLod,
            inOutLocFrameIds,
            locAnimFrameOffsetsBase,
            locAnimFrameCountsBase,
            locCount,
            locAnimFramesBasePacked,
            locAnimFramesBasePackedLength,
            outLocLodPatchesPacked,
            outLocLodPatchesPackedLength);
        if (locLodPatchCount < 0) {
            return locLodPatchCount;
        }
        *outLocLodPatchCount = locLodPatchCount;

        const rs::i32 locLodAlphaPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesLodAlpha,
            inOutLocFrameIds,
            locAnimFrameOffsetsAlpha,
            locAnimFrameCountsAlpha,
            locCount,
            locAnimFramesAlphaPacked,
            locAnimFramesAlphaPackedLength,
            outLocLodAlphaPatchesPacked,
            outLocLodAlphaPatchesPackedLength);
        if (locLodAlphaPatchCount < 0) {
            return locLodAlphaPatchCount;
        }
        *outLocLodAlphaPatchCount = locLodAlphaPatchCount;

        const rs::i32 locInteractPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesInteract,
            inOutLocFrameIds,
            locAnimFrameOffsetsBase,
            locAnimFrameCountsBase,
            locCount,
            locAnimFramesBasePacked,
            locAnimFramesBasePackedLength,
            outLocInteractPatchesPacked,
            outLocInteractPatchesPackedLength);
        if (locInteractPatchCount < 0) {
            return locInteractPatchCount;
        }
        *outLocInteractPatchCount = locInteractPatchCount;

        const rs::i32 locInteractAlphaPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesInteractAlpha,
            inOutLocFrameIds,
            locAnimFrameOffsetsAlpha,
            locAnimFrameCountsAlpha,
            locCount,
            locAnimFramesAlphaPacked,
            locAnimFramesAlphaPackedLength,
            outLocInteractAlphaPatchesPacked,
            outLocInteractAlphaPatchesPackedLength);
        if (locInteractAlphaPatchCount < 0) {
            return locInteractAlphaPatchCount;
        }
        *outLocInteractAlphaPatchCount = locInteractAlphaPatchCount;

        const rs::i32 locInteractLodPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesInteractLod,
            inOutLocFrameIds,
            locAnimFrameOffsetsBase,
            locAnimFrameCountsBase,
            locCount,
            locAnimFramesBasePacked,
            locAnimFramesBasePackedLength,
            outLocInteractLodPatchesPacked,
            outLocInteractLodPatchesPackedLength);
        if (locInteractLodPatchCount < 0) {
            return locInteractLodPatchCount;
        }
        *outLocInteractLodPatchCount = locInteractLodPatchCount;

        const rs::i32 locInteractLodAlphaPatchCount = rs_emit_draw_range_patches_from_frames(
            locDrawRangeIndicesInteractLodAlpha,
            inOutLocFrameIds,
            locAnimFrameOffsetsAlpha,
            locAnimFrameCountsAlpha,
            locCount,
            locAnimFramesAlphaPacked,
            locAnimFramesAlphaPackedLength,
            outLocInteractLodAlphaPatchesPacked,
            outLocInteractLodAlphaPatchesPackedLength);
        if (locInteractLodAlphaPatchCount < 0) {
            return locInteractLodAlphaPatchCount;
        }
        *outLocInteractLodAlphaPatchCount = locInteractLodAlphaPatchCount;
    }

    if (npcCount <= 0) {
        return 1;
    }

    const rs::i32 npcMovementStatus = rs_advance_npc_movement_transforms(
        inOutNpcX,
        inOutNpcY,
        inOutNpcOrientation,
        inOutNpcRotation,
        inOutNpcPathLength,
        inOutNpcMovementSeqId,
        npcPathXPacked,
        npcPathXPackedLength,
        npcPathYPacked,
        npcPathYPackedLength,
        npcPathMovementTypePacked,
        npcPathMovementTypePackedLength,
        npcSize,
        npcIsClickable,
        npcRotationSpeed,
        npcIdleSeqId,
        npcWalkSeqId,
        npcCount,
        clientTickCount);
    if (npcMovementStatus != 1) {
        return npcMovementStatus;
    }

    if (!inOutNpcFrameIds || !inOutNpcFrameTicks || !inOutNpcMovementLoops ||
        !npcHasWalkAnim ||
        !npcIdleSeqValid || !npcIdleSeqHasAnimMaya || !npcIdleSeqAnimMayaDurations ||
        !npcIdleSeqFrameSteps || !npcIdleSeqLooping || !npcIdleSeqMaxLoops ||
        !npcIdleSeqFrameIdCounts || !npcIdleSeqFrameLengthOffsets || !npcIdleSeqFrameLengthCounts ||
        !npcWalkSeqValid || !npcWalkSeqHasAnimMaya || !npcWalkSeqAnimMayaDurations ||
        !npcWalkSeqFrameSteps || !npcWalkSeqLooping || !npcWalkSeqMaxLoops ||
        !npcWalkSeqFrameIdCounts || !npcWalkSeqFrameLengthOffsets || !npcWalkSeqFrameLengthCounts ||
        !npcDrawRangeIndices || !npcIdleAnimFrameOffsetsBase || !npcIdleAnimFrameCountsBase ||
        !npcWalkAnimFrameOffsetsBase || !npcWalkAnimFrameCountsBase || !outNpcPatchesPacked ||
        !npcIdleAnimFrameOffsetsAlpha || !npcIdleAnimFrameCountsAlpha ||
        !npcWalkAnimFrameOffsetsAlpha || !npcWalkAnimFrameCountsAlpha ||
        !outNpcAlphaPatchesPacked || outNpcPatchesPackedLength < npcCount * 4 ||
        outNpcAlphaPatchesPackedLength < npcCount * 4) {
        return -1;
    }
    if ((npcSeqFrameLengthsPackedLength > 0 && !npcSeqFrameLengthsPacked) ||
        (npcAnimFramesBasePackedLength > 0 && !npcAnimFramesBasePacked) ||
        (npcAnimFramesAlphaPackedLength > 0 && !npcAnimFramesAlphaPacked)) {
        return -1;
    }

    for (rs::i32 i = 0; i < npcCount; i++) {
        rs::i32 frame = inOutNpcFrameIds[i];
        rs::i32 frameTick = inOutNpcFrameTicks[i];
        rs::i32 movementLoop = inOutNpcMovementLoops[i];
        const bool useWalk = npcHasWalkAnim[i] != 0 && inOutNpcMovementSeqId[i] == npcWalkSeqId[i];

        const bool seqValid = useWalk ? (npcWalkSeqValid[i] != 0) : (npcIdleSeqValid[i] != 0);
        const bool hasAnimMaya = useWalk
            ? (npcWalkSeqHasAnimMaya[i] != 0)
            : (npcIdleSeqHasAnimMaya[i] != 0);
        const rs::i32 animMayaDuration = useWalk
            ? npcWalkSeqAnimMayaDurations[i]
            : npcIdleSeqAnimMayaDurations[i];
        const rs::i32 frameStep = useWalk ? npcWalkSeqFrameSteps[i] : npcIdleSeqFrameSteps[i];
        const bool looping = useWalk ? (npcWalkSeqLooping[i] != 0) : (npcIdleSeqLooping[i] != 0);
        const rs::i32 maxLoops = useWalk ? npcWalkSeqMaxLoops[i] : npcIdleSeqMaxLoops[i];
        const rs::i32 frameIdCount = useWalk ? npcWalkSeqFrameIdCounts[i] : npcIdleSeqFrameIdCounts[i];
        const rs::i32 frameLengthOffset = useWalk
            ? npcWalkSeqFrameLengthOffsets[i]
            : npcIdleSeqFrameLengthOffsets[i];
        const rs::i32 frameLengthCount = useWalk
            ? npcWalkSeqFrameLengthCounts[i]
            : npcIdleSeqFrameLengthCounts[i];

        for (rs::i32 t = 0; t < clientTickCount; t++) {
            advanceNpcSeqOneTick(
                frame,
                frameTick,
                movementLoop,
                seqValid,
                hasAnimMaya,
                animMayaDuration,
                frameStep,
                looping,
                maxLoops,
                frameIdCount,
                frameLengthOffset,
                frameLengthCount,
                npcSeqFrameLengthsPacked,
                npcSeqFrameLengthsPackedLength);
        }

        inOutNpcFrameIds[i] = frame;
        inOutNpcFrameTicks[i] = frameTick;
        inOutNpcMovementLoops[i] = movementLoop;
    }

    const rs::i32 npcBasePatchCount = emitNpcPatchesFromSelectedFrames(
        inOutNpcFrameIds,
        inOutNpcMovementSeqId,
        npcHasWalkAnim,
        npcWalkSeqId,
        npcDrawRangeIndices,
        npcIdleAnimFrameOffsetsBase,
        npcIdleAnimFrameCountsBase,
        npcWalkAnimFrameOffsetsBase,
        npcWalkAnimFrameCountsBase,
        npcAnimFramesBasePacked,
        npcAnimFramesBasePackedLength,
        false,
        0,
        0,
        npcCount,
        outNpcPatchesPacked,
        outNpcPatchesPackedLength);
    if (npcBasePatchCount < 0) {
        return npcBasePatchCount;
    }
    *outNpcBasePatchCount = npcBasePatchCount;

    const rs::i32 npcAlphaPatchCount = emitNpcPatchesFromSelectedFrames(
        inOutNpcFrameIds,
        inOutNpcMovementSeqId,
        npcHasWalkAnim,
        npcWalkSeqId,
        npcDrawRangeIndices,
        npcIdleAnimFrameOffsetsAlpha,
        npcIdleAnimFrameCountsAlpha,
        npcWalkAnimFrameOffsetsAlpha,
        npcWalkAnimFrameCountsAlpha,
        npcAnimFramesAlphaPacked,
        npcAnimFramesAlphaPackedLength,
        true,
        npcNullAlphaFrameOffset,
        1,
        npcCount,
        outNpcAlphaPatchesPacked,
        outNpcAlphaPatchesPackedLength);
    if (npcAlphaPatchCount < 0) {
        return npcAlphaPatchCount;
    }
    *outNpcAlphaPatchCount = npcAlphaPatchCount;

    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_tick_advance_and_emit_base_patches_for_state_packed(
    const rs::i32 runtimeHandle,
    const rs::i32 stateKey,
    const rs::i32 cycleNowFixed,
    const rs::i32 clientTickCount,
    rs::i32* outPacked,
    const rs::i32 outPackedLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || stateKey < 0 || outPackedLength < 0) {
        return -1;
    }
    auto it = runtime->tickStates.find(stateKey);
    if (it == runtime->tickStates.end()) {
        return -1;
    }
    MapRenderTickState& tickState = it->second;
    const rs::i32 locCount = tickState.locCount;
    const rs::i32 npcCount = tickState.npcCount;
    if (locCount < 0 || npcCount < 0) {
        return -1;
    }

    auto getConst = [&](const TickStateFieldIndex index) -> const rs::i32* {
        const auto& v = tickState.fields[static_cast<std::size_t>(index)];
        return v.empty() ? nullptr : v.data();
    };
    auto getMut = [&](const TickStateFieldIndex index) -> rs::i32* {
        auto& v = tickState.fields[static_cast<std::size_t>(index)];
        return v.empty() ? nullptr : v.data();
    };
    auto getLen = [&](const TickStateFieldIndex index) -> rs::i32 {
        return static_cast<rs::i32>(tickState.fields[static_cast<std::size_t>(index)].size());
    };

    std::vector<rs::i32> locActiveFlags(static_cast<std::size_t>(locCount));
    std::vector<rs::i32> locPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locLodPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locLodAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locInteractPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locInteractAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locInteractLodPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> locInteractLodAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
    std::vector<rs::i32> npcPatches(static_cast<std::size_t>(npcCount) * 4u);
    std::vector<rs::i32> npcAlphaPatches(static_cast<std::size_t>(npcCount) * 4u);

    rs::i32 locBasePatchCount = 0;
    rs::i32 locAlphaPatchCount = 0;
    rs::i32 locLodPatchCount = 0;
    rs::i32 locLodAlphaPatchCount = 0;
    rs::i32 locInteractPatchCount = 0;
    rs::i32 locInteractAlphaPatchCount = 0;
    rs::i32 locInteractLodPatchCount = 0;
    rs::i32 locInteractLodAlphaPatchCount = 0;
    rs::i32 npcBasePatchCount = 0;
    rs::i32 npcAlphaPatchCount = 0;

    const rs::i32 status = rs_tick_advance_and_emit_base_patches(
        getMut(TICK_FIELD_LOC_FRAME_IDS),
        getMut(TICK_FIELD_LOC_CYCLE_STARTS_FIXED),
        getConst(TICK_FIELD_LOC_FRAME_STEPS),
        getConst(TICK_FIELD_LOC_HAS_ANIM_MAYA),
        getConst(TICK_FIELD_LOC_ANIM_MAYA_DURATIONS),
        getConst(TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS),
        getConst(TICK_FIELD_LOC_FRAME_LENGTH_COUNTS),
        locCount,
        cycleNowFixed,
        getConst(TICK_FIELD_LOC_FRAME_LENGTHS_PACKED),
        getLen(TICK_FIELD_LOC_FRAME_LENGTHS_PACKED),
        locActiveFlags.empty() ? nullptr : locActiveFlags.data(),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_BASE),
        getConst(TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_BASE),
        getConst(TICK_FIELD_LOC_ANIM_FRAME_COUNTS_BASE),
        getConst(TICK_FIELD_LOC_ANIM_FRAMES_BASE_PACKED),
        getLen(TICK_FIELD_LOC_ANIM_FRAMES_BASE_PACKED),
        locPatches.empty() ? nullptr : locPatches.data(),
        static_cast<rs::i32>(locPatches.size()),
        &locBasePatchCount,
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_ALPHA),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD_ALPHA),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_ALPHA),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD),
        getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD_ALPHA),
        getConst(TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_ALPHA),
        getConst(TICK_FIELD_LOC_ANIM_FRAME_COUNTS_ALPHA),
        getConst(TICK_FIELD_LOC_ANIM_FRAMES_ALPHA_PACKED),
        getLen(TICK_FIELD_LOC_ANIM_FRAMES_ALPHA_PACKED),
        locAlphaPatches.empty() ? nullptr : locAlphaPatches.data(),
        static_cast<rs::i32>(locAlphaPatches.size()),
        &locAlphaPatchCount,
        locLodPatches.empty() ? nullptr : locLodPatches.data(),
        static_cast<rs::i32>(locLodPatches.size()),
        &locLodPatchCount,
        locLodAlphaPatches.empty() ? nullptr : locLodAlphaPatches.data(),
        static_cast<rs::i32>(locLodAlphaPatches.size()),
        &locLodAlphaPatchCount,
        locInteractPatches.empty() ? nullptr : locInteractPatches.data(),
        static_cast<rs::i32>(locInteractPatches.size()),
        &locInteractPatchCount,
        locInteractAlphaPatches.empty() ? nullptr : locInteractAlphaPatches.data(),
        static_cast<rs::i32>(locInteractAlphaPatches.size()),
        &locInteractAlphaPatchCount,
        locInteractLodPatches.empty() ? nullptr : locInteractLodPatches.data(),
        static_cast<rs::i32>(locInteractLodPatches.size()),
        &locInteractLodPatchCount,
        locInteractLodAlphaPatches.empty() ? nullptr : locInteractLodAlphaPatches.data(),
        static_cast<rs::i32>(locInteractLodAlphaPatches.size()),
        &locInteractLodAlphaPatchCount,
        getMut(TICK_FIELD_NPC_X),
        getMut(TICK_FIELD_NPC_Y),
        getMut(TICK_FIELD_NPC_ORIENTATION),
        getMut(TICK_FIELD_NPC_ROTATION),
        getMut(TICK_FIELD_NPC_PATH_LENGTH),
        getMut(TICK_FIELD_NPC_MOVEMENT_SEQ_ID),
        getConst(TICK_FIELD_NPC_PATH_X_PACKED),
        getLen(TICK_FIELD_NPC_PATH_X_PACKED),
        getConst(TICK_FIELD_NPC_PATH_Y_PACKED),
        getLen(TICK_FIELD_NPC_PATH_Y_PACKED),
        getConst(TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED),
        getLen(TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED),
        getConst(TICK_FIELD_NPC_SIZE),
        getConst(TICK_FIELD_NPC_IS_CLICKABLE),
        getConst(TICK_FIELD_NPC_ROTATION_SPEED),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_ID),
        getConst(TICK_FIELD_NPC_WALK_SEQ_ID),
        getConst(TICK_FIELD_NPC_HAS_WALK_ANIM),
        getMut(TICK_FIELD_NPC_FRAME_IDS),
        getMut(TICK_FIELD_NPC_FRAME_TICKS),
        getMut(TICK_FIELD_NPC_MOVEMENT_LOOPS),
        npcCount,
        clientTickCount,
        getConst(TICK_FIELD_NPC_IDLE_SEQ_VALID),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_HAS_ANIM_MAYA),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_ANIM_MAYA_DURATIONS),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_STEPS),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_LOOPING),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_MAX_LOOPS),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_ID_COUNTS),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_OFFSETS),
        getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_COUNTS),
        getConst(TICK_FIELD_NPC_WALK_SEQ_VALID),
        getConst(TICK_FIELD_NPC_WALK_SEQ_HAS_ANIM_MAYA),
        getConst(TICK_FIELD_NPC_WALK_SEQ_ANIM_MAYA_DURATIONS),
        getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_STEPS),
        getConst(TICK_FIELD_NPC_WALK_SEQ_LOOPING),
        getConst(TICK_FIELD_NPC_WALK_SEQ_MAX_LOOPS),
        getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_ID_COUNTS),
        getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_OFFSETS),
        getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_COUNTS),
        getConst(TICK_FIELD_NPC_SEQ_FRAME_LENGTHS_PACKED),
        getLen(TICK_FIELD_NPC_SEQ_FRAME_LENGTHS_PACKED),
        getConst(TICK_FIELD_NPC_DRAW_RANGE_INDICES),
        getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_BASE),
        getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_BASE),
        getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_BASE),
        getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_BASE),
        getConst(TICK_FIELD_NPC_ANIM_FRAMES_BASE_PACKED),
        getLen(TICK_FIELD_NPC_ANIM_FRAMES_BASE_PACKED),
        npcPatches.empty() ? nullptr : npcPatches.data(),
        static_cast<rs::i32>(npcPatches.size()),
        &npcBasePatchCount,
        getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_ALPHA),
        getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_ALPHA),
        getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_ALPHA),
        getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_ALPHA),
        getConst(TICK_FIELD_NPC_ANIM_FRAMES_ALPHA_PACKED),
        getLen(TICK_FIELD_NPC_ANIM_FRAMES_ALPHA_PACKED),
        tickState.npcNullAlphaFrameOffset,
        npcAlphaPatches.empty() ? nullptr : npcAlphaPatches.data(),
        static_cast<rs::i32>(npcAlphaPatches.size()),
        &npcAlphaPatchCount);
    if (status != 1) {
        return status;
    }

    if (locBasePatchCount < 0 || locBasePatchCount > locCount ||
        locAlphaPatchCount < 0 || locAlphaPatchCount > locCount ||
        locLodPatchCount < 0 || locLodPatchCount > locCount ||
        locLodAlphaPatchCount < 0 || locLodAlphaPatchCount > locCount ||
        locInteractPatchCount < 0 || locInteractPatchCount > locCount ||
        locInteractAlphaPatchCount < 0 || locInteractAlphaPatchCount > locCount ||
        locInteractLodPatchCount < 0 || locInteractLodPatchCount > locCount ||
        locInteractLodAlphaPatchCount < 0 || locInteractLodAlphaPatchCount > locCount ||
        npcBasePatchCount < 0 || npcBasePatchCount > npcCount ||
        npcAlphaPatchCount < 0 || npcAlphaPatchCount > npcCount) {
        return -2;
    }

    const rs::i32 headerLength = 13;
    const rs::i32 patchInts =
        (locBasePatchCount + locAlphaPatchCount + locLodPatchCount + locLodAlphaPatchCount +
         locInteractPatchCount + locInteractAlphaPatchCount + locInteractLodPatchCount +
         locInteractLodAlphaPatchCount + npcBasePatchCount + npcAlphaPatchCount) *
        4;
    const rs::i32 requiredLength =
        headerLength +
        locCount * 3 +
        npcCount * 9 +
        patchInts;
    if (!outPacked) {
        return requiredLength;
    }
    if (outPackedLength < requiredLength) {
        return -2;
    }

    rs::i32 cursor = 0;
    outPacked[cursor++] = RS_TICK_STATE_OUTPUT_PACKED_VERSION;
    outPacked[cursor++] = locBasePatchCount;
    outPacked[cursor++] = locAlphaPatchCount;
    outPacked[cursor++] = locLodPatchCount;
    outPacked[cursor++] = locLodAlphaPatchCount;
    outPacked[cursor++] = locInteractPatchCount;
    outPacked[cursor++] = locInteractAlphaPatchCount;
    outPacked[cursor++] = locInteractLodPatchCount;
    outPacked[cursor++] = locInteractLodAlphaPatchCount;
    outPacked[cursor++] = npcBasePatchCount;
    outPacked[cursor++] = npcAlphaPatchCount;
    outPacked[cursor++] = locCount;
    outPacked[cursor++] = npcCount;

    auto appendFull = [&](const std::vector<rs::i32>& src) -> bool {
        const rs::i32 n = static_cast<rs::i32>(src.size());
        if (n > 0) {
            std::memcpy(
                outPacked + cursor,
                src.data(),
                static_cast<std::size_t>(n) * sizeof(rs::i32));
        }
        cursor += n;
        return true;
    };
    auto appendPrefix = [&](const std::vector<rs::i32>& src, const rs::i32 n) -> bool {
        if (n < 0 || static_cast<std::size_t>(n) > src.size()) {
            return false;
        }
        if (n > 0) {
            std::memcpy(
                outPacked + cursor,
                src.data(),
                static_cast<std::size_t>(n) * sizeof(rs::i32));
        }
        cursor += n;
        return true;
    };

    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_IDS)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_CYCLE_STARTS_FIXED)]);
    appendFull(locActiveFlags);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_X)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_Y)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_ORIENTATION)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_ROTATION)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_PATH_LENGTH)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_MOVEMENT_SEQ_ID)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_FRAME_IDS)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_FRAME_TICKS)]);
    appendFull(tickState.fields[static_cast<std::size_t>(TICK_FIELD_NPC_MOVEMENT_LOOPS)]);

    if (!appendPrefix(locPatches, locBasePatchCount * 4) ||
        !appendPrefix(locAlphaPatches, locAlphaPatchCount * 4) ||
        !appendPrefix(locLodPatches, locLodPatchCount * 4) ||
        !appendPrefix(locLodAlphaPatches, locLodAlphaPatchCount * 4) ||
        !appendPrefix(locInteractPatches, locInteractPatchCount * 4) ||
        !appendPrefix(locInteractAlphaPatches, locInteractAlphaPatchCount * 4) ||
        !appendPrefix(locInteractLodPatches, locInteractLodPatchCount * 4) ||
        !appendPrefix(locInteractLodAlphaPatches, locInteractLodAlphaPatchCount * 4) ||
        !appendPrefix(npcPatches, npcBasePatchCount * 4) ||
        !appendPrefix(npcAlphaPatches, npcAlphaPatchCount * 4)) {
        return -2;
    }

    return cursor == requiredLength ? cursor : -2;
}

// Tick multiple registered states and emit a FramePacket-compatible patch stream.
//
// Inputs:
// - stateKeys: list of runtime tick-state keys to advance (we use mapId as the key on TS side).
//
// Output (written into outMeta[0..3]):
// - outMeta[0] = countsPtr (i32*)
// - outMeta[1] = countsLen (i32 count)
// - outMeta[2] = patchesPtr (i32*)
// - outMeta[3] = patchesLen (i32 count)
//
// The returned pointers refer to runtime-owned scratch buffers and are valid until the next call.
static constexpr rs::i32 RS_FRAME_TICK_STREAM_COUNT = 10;
static constexpr rs::i32 RS_FRAME_TICK_COUNTS_STRIDE = 1 + RS_FRAME_TICK_STREAM_COUNT; // [mapId, 10 counts]

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_tick_maps_emit_patch_streams_meta(
    const rs::i32 runtimeHandle,
    const rs::i32* stateKeys,
    const rs::i32 stateKeyCount,
    const rs::i32 cycleNowFixed,
    const rs::i32 clientTickCount,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || stateKeyCount < 0 || clientTickCount < 0 || outMetaLength < 4 || !outMeta) {
        return -1;
    }
    if (stateKeyCount > 0 && !stateKeys) {
        return -1;
    }

    auto& outCounts = runtime->tickPatchCountsByMapIdScratch;
    auto& outPacked = runtime->tickPatchPackedScratch;
    outCounts.clear();
    outPacked.clear();

    // Reserve pessimistically: each map writes a fixed counts tuple and up to (locCount+npcCount) patches
    // per stream, but we don't know locCount ahead of time. Reserve counts only.
    outCounts.reserve(static_cast<std::size_t>(stateKeyCount) * static_cast<std::size_t>(RS_FRAME_TICK_COUNTS_STRIDE));

    for (rs::i32 i = 0; i < stateKeyCount; i++) {
        const rs::i32 key = stateKeys[i];

        // Always write a counts entry for each requested key to keep ordering stable for JS.
        outCounts.push_back(key);
        for (rs::i32 s = 0; s < RS_FRAME_TICK_STREAM_COUNT; s++) {
            outCounts.push_back(0);
        }
        const std::size_t countsBase = outCounts.size() - static_cast<std::size_t>(RS_FRAME_TICK_STREAM_COUNT);

        auto it = runtime->tickStates.find(key);
        if (it == runtime->tickStates.end()) {
            continue;
        }
        MapRenderTickState& tickState = it->second;
        const rs::i32 locCount = tickState.locCount;
        const rs::i32 npcCount = tickState.npcCount;
        if (locCount < 0 || npcCount < 0) {
            continue;
        }

        auto getConst = [&](const TickStateFieldIndex index) -> const rs::i32* {
            const auto& v = tickState.fields[static_cast<std::size_t>(index)];
            return v.empty() ? nullptr : v.data();
        };
        auto getMut = [&](const TickStateFieldIndex index) -> rs::i32* {
            auto& v = tickState.fields[static_cast<std::size_t>(index)];
            return v.empty() ? nullptr : v.data();
        };
        auto getLen = [&](const TickStateFieldIndex index) -> rs::i32 {
            return static_cast<rs::i32>(tickState.fields[static_cast<std::size_t>(index)].size());
        };

        std::vector<rs::i32> locActiveFlags(static_cast<std::size_t>(locCount));
        std::vector<rs::i32> locPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locLodPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locLodAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locInteractPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locInteractAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locInteractLodPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> locInteractLodAlphaPatches(static_cast<std::size_t>(locCount) * 4u);
        std::vector<rs::i32> npcPatches(static_cast<std::size_t>(npcCount) * 4u);
        std::vector<rs::i32> npcAlphaPatches(static_cast<std::size_t>(npcCount) * 4u);

        rs::i32 locBasePatchCount = 0;
        rs::i32 locAlphaPatchCount = 0;
        rs::i32 locLodPatchCount = 0;
        rs::i32 locLodAlphaPatchCount = 0;
        rs::i32 locInteractPatchCount = 0;
        rs::i32 locInteractAlphaPatchCount = 0;
        rs::i32 locInteractLodPatchCount = 0;
        rs::i32 locInteractLodAlphaPatchCount = 0;
        rs::i32 npcBasePatchCount = 0;
        rs::i32 npcAlphaPatchCount = 0;

        const rs::i32 status = rs_tick_advance_and_emit_base_patches(
            getMut(TICK_FIELD_LOC_FRAME_IDS),
            getMut(TICK_FIELD_LOC_CYCLE_STARTS_FIXED),
            getConst(TICK_FIELD_LOC_FRAME_STEPS),
            getConst(TICK_FIELD_LOC_HAS_ANIM_MAYA),
            getConst(TICK_FIELD_LOC_ANIM_MAYA_DURATIONS),
            getConst(TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS),
            getConst(TICK_FIELD_LOC_FRAME_LENGTH_COUNTS),
            locCount,
            cycleNowFixed,
            getConst(TICK_FIELD_LOC_FRAME_LENGTHS_PACKED),
            getLen(TICK_FIELD_LOC_FRAME_LENGTHS_PACKED),
            locActiveFlags.empty() ? nullptr : locActiveFlags.data(),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_BASE),
            getConst(TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_BASE),
            getConst(TICK_FIELD_LOC_ANIM_FRAME_COUNTS_BASE),
            getConst(TICK_FIELD_LOC_ANIM_FRAMES_BASE_PACKED),
            getLen(TICK_FIELD_LOC_ANIM_FRAMES_BASE_PACKED),
            locPatches.empty() ? nullptr : locPatches.data(),
            static_cast<rs::i32>(locPatches.size()),
            &locBasePatchCount,
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_ALPHA),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD_ALPHA),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_ALPHA),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD),
            getConst(TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD_ALPHA),
            getConst(TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_ALPHA),
            getConst(TICK_FIELD_LOC_ANIM_FRAME_COUNTS_ALPHA),
            getConst(TICK_FIELD_LOC_ANIM_FRAMES_ALPHA_PACKED),
            getLen(TICK_FIELD_LOC_ANIM_FRAMES_ALPHA_PACKED),
            locAlphaPatches.empty() ? nullptr : locAlphaPatches.data(),
            static_cast<rs::i32>(locAlphaPatches.size()),
            &locAlphaPatchCount,
            locLodPatches.empty() ? nullptr : locLodPatches.data(),
            static_cast<rs::i32>(locLodPatches.size()),
            &locLodPatchCount,
            locLodAlphaPatches.empty() ? nullptr : locLodAlphaPatches.data(),
            static_cast<rs::i32>(locLodAlphaPatches.size()),
            &locLodAlphaPatchCount,
            locInteractPatches.empty() ? nullptr : locInteractPatches.data(),
            static_cast<rs::i32>(locInteractPatches.size()),
            &locInteractPatchCount,
            locInteractAlphaPatches.empty() ? nullptr : locInteractAlphaPatches.data(),
            static_cast<rs::i32>(locInteractAlphaPatches.size()),
            &locInteractAlphaPatchCount,
            locInteractLodPatches.empty() ? nullptr : locInteractLodPatches.data(),
            static_cast<rs::i32>(locInteractLodPatches.size()),
            &locInteractLodPatchCount,
            locInteractLodAlphaPatches.empty() ? nullptr : locInteractLodAlphaPatches.data(),
            static_cast<rs::i32>(locInteractLodAlphaPatches.size()),
            &locInteractLodAlphaPatchCount,

            getMut(TICK_FIELD_NPC_X),
            getMut(TICK_FIELD_NPC_Y),
            getMut(TICK_FIELD_NPC_ORIENTATION),
            getMut(TICK_FIELD_NPC_ROTATION),
            getMut(TICK_FIELD_NPC_PATH_LENGTH),
            getMut(TICK_FIELD_NPC_MOVEMENT_SEQ_ID),
            getConst(TICK_FIELD_NPC_PATH_X_PACKED),
            getLen(TICK_FIELD_NPC_PATH_X_PACKED),
            getConst(TICK_FIELD_NPC_PATH_Y_PACKED),
            getLen(TICK_FIELD_NPC_PATH_Y_PACKED),
            getConst(TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED),
            getLen(TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED),
            getConst(TICK_FIELD_NPC_SIZE),
            getConst(TICK_FIELD_NPC_IS_CLICKABLE),
            getConst(TICK_FIELD_NPC_ROTATION_SPEED),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_ID),
            getConst(TICK_FIELD_NPC_WALK_SEQ_ID),
            getConst(TICK_FIELD_NPC_HAS_WALK_ANIM),
            getMut(TICK_FIELD_NPC_FRAME_IDS),
            getMut(TICK_FIELD_NPC_FRAME_TICKS),
            getMut(TICK_FIELD_NPC_MOVEMENT_LOOPS),
            npcCount,
            clientTickCount,
            getConst(TICK_FIELD_NPC_IDLE_SEQ_VALID),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_HAS_ANIM_MAYA),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_ANIM_MAYA_DURATIONS),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_STEPS),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_LOOPING),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_MAX_LOOPS),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_ID_COUNTS),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_OFFSETS),
            getConst(TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_COUNTS),
            getConst(TICK_FIELD_NPC_WALK_SEQ_VALID),
            getConst(TICK_FIELD_NPC_WALK_SEQ_HAS_ANIM_MAYA),
            getConst(TICK_FIELD_NPC_WALK_SEQ_ANIM_MAYA_DURATIONS),
            getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_STEPS),
            getConst(TICK_FIELD_NPC_WALK_SEQ_LOOPING),
            getConst(TICK_FIELD_NPC_WALK_SEQ_MAX_LOOPS),
            getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_ID_COUNTS),
            getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_OFFSETS),
            getConst(TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_COUNTS),
            getConst(TICK_FIELD_NPC_SEQ_FRAME_LENGTHS_PACKED),
            getLen(TICK_FIELD_NPC_SEQ_FRAME_LENGTHS_PACKED),
            getConst(TICK_FIELD_NPC_DRAW_RANGE_INDICES),
            getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_BASE),
            getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_BASE),
            getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_BASE),
            getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_BASE),
            getConst(TICK_FIELD_NPC_ANIM_FRAMES_BASE_PACKED),
            getLen(TICK_FIELD_NPC_ANIM_FRAMES_BASE_PACKED),
            npcPatches.empty() ? nullptr : npcPatches.data(),
            static_cast<rs::i32>(npcPatches.size()),
            &npcBasePatchCount,
            getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_ALPHA),
            getConst(TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_ALPHA),
            getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_ALPHA),
            getConst(TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_ALPHA),
            getConst(TICK_FIELD_NPC_ANIM_FRAMES_ALPHA_PACKED),
            getLen(TICK_FIELD_NPC_ANIM_FRAMES_ALPHA_PACKED),
            tickState.npcNullAlphaFrameOffset,
            npcAlphaPatches.empty() ? nullptr : npcAlphaPatches.data(),
            static_cast<rs::i32>(npcAlphaPatches.size()),
            &npcAlphaPatchCount);

        if (status != 1) {
            // Keep the counts tuple as zeros; skip emitting any patches.
            continue;
        }

        // Write stream counts for this map, in the standard order.
        outCounts[countsBase + 0] = locBasePatchCount;
        outCounts[countsBase + 1] = locAlphaPatchCount;
        outCounts[countsBase + 2] = locLodPatchCount;
        outCounts[countsBase + 3] = locLodAlphaPatchCount;
        outCounts[countsBase + 4] = locInteractPatchCount;
        outCounts[countsBase + 5] = locInteractAlphaPatchCount;
        outCounts[countsBase + 6] = locInteractLodPatchCount;
        outCounts[countsBase + 7] = locInteractLodAlphaPatchCount;
        outCounts[countsBase + 8] = npcBasePatchCount;
        outCounts[countsBase + 9] = npcAlphaPatchCount;

        auto appendPatchPrefix = [&](const std::vector<rs::i32>& src, rs::i32 patchCount) {
            if (patchCount <= 0) return;
            const std::size_t n = static_cast<std::size_t>(patchCount) * 4u;
            if (n > src.size()) return;
            outPacked.insert(outPacked.end(), src.begin(), src.begin() + static_cast<std::ptrdiff_t>(n));
        };

        appendPatchPrefix(locPatches, locBasePatchCount);
        appendPatchPrefix(locAlphaPatches, locAlphaPatchCount);
        appendPatchPrefix(locLodPatches, locLodPatchCount);
        appendPatchPrefix(locLodAlphaPatches, locLodAlphaPatchCount);
        appendPatchPrefix(locInteractPatches, locInteractPatchCount);
        appendPatchPrefix(locInteractAlphaPatches, locInteractAlphaPatchCount);
        appendPatchPrefix(locInteractLodPatches, locInteractLodPatchCount);
        appendPatchPrefix(locInteractLodAlphaPatches, locInteractLodAlphaPatchCount);
        appendPatchPrefix(npcPatches, npcBasePatchCount);
        appendPatchPrefix(npcAlphaPatches, npcAlphaPatchCount);
    }

    outMeta[0] = outCounts.empty()
        ? 0
        : static_cast<rs::i32>(reinterpret_cast<std::uintptr_t>(outCounts.data()));
    outMeta[1] = static_cast<rs::i32>(outCounts.size());
    outMeta[2] = outPacked.empty()
        ? 0
        : static_cast<rs::i32>(reinterpret_cast<std::uintptr_t>(outPacked.data()));
    outMeta[3] = static_cast<rs::i32>(outPacked.size());
    return 1;
}
