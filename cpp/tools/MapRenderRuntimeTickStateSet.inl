// Extracted from `cpp/tools/rs_map_render_backend.cpp` (no behavior changes).

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_clear_tick_state(
    const rs::i32 runtimeHandle,
    const rs::i32 stateKey) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || stateKey < 0) {
        return 0;
    }
    return runtime->tickStates.erase(stateKey) > 0 ? 1 : 0;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_set_tick_state_packed(
    const rs::i32 runtimeHandle,
    const rs::i32 stateKey,
    const rs::i32* packed,
    const rs::i32 packedLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || stateKey < 0 || packedLength <= 0 || !packed) {
        return -1;
    }
    if (packedLength < 3) {
        return -1;
    }
    const rs::i32 packedVersion = packed[0];
    const rs::i32 packedFieldCount = packed[1];
    const bool isCompactV2 = packedVersion == RS_TICK_STATE_PACKED_VERSION_V2_COMPACT;
    const rs::i32 expectedFieldCount = isCompactV2 ? RS_TICK_STATE_PACKED_FIELD_COUNT_V2 : TICK_FIELD_COUNT;
    if ((packedVersion != RS_TICK_STATE_PACKED_VERSION && !isCompactV2) ||
        packedFieldCount != expectedFieldCount) {
        return -1;
    }
    const rs::i32 headerInts = 3 + packedFieldCount;
    if (packedLength < headerInts) {
        return -1;
    }

    const rs::i32 npcNullAlphaFrameOffset = packed[2];
    const rs::i32* lengths = packed + 3;
    rs::i32 totalDataLength = 0;
    for (rs::i32 i = 0; i < packedFieldCount; i++) {
        const rs::i32 len = lengths[i];
        if (len < 0) {
            return -1;
        }
        totalDataLength += len;
        if (totalDataLength < 0) {
            return -1;
        }
    }
    if (headerInts + totalDataLength != packedLength) {
        return -2;
    }

    MapRenderTickState tickState{};
    tickState.npcNullAlphaFrameOffset = npcNullAlphaFrameOffset;
    rs::i32 cursor = headerInts;
    for (rs::i32 i = 0; i < TICK_FIELD_COUNT; i++) {
        const rs::i32 len = lengths[i];
        auto& dst = tickState.fields[static_cast<std::size_t>(i)];
        if (len > 0) {
            dst.assign(
                packed + cursor,
                packed + cursor + len);
        } else {
            dst.clear();
        }
        cursor += len;
    }
    std::vector<rs::i32> compactLocSeqIds{};
    if (isCompactV2) {
        const rs::i32 compactLen = lengths[TICK_FIELD_COUNT];
        if (compactLen < 0 || cursor + compactLen > packedLength) {
            return -1;
        }
        compactLocSeqIds.assign(
            packed + cursor,
            packed + cursor + compactLen);
        cursor += compactLen;
    }
    if (cursor != packedLength) {
        return -2;
    }
    const rs::i32 locCount = lengths[TICK_FIELD_LOC_FRAME_IDS];
    const rs::i32 npcCount = lengths[TICK_FIELD_NPC_X];
    if (locCount < 0 || npcCount < 0) {
        return -1;
    }
    if (isCompactV2 && static_cast<rs::i32>(compactLocSeqIds.size()) != locCount) {
        return -2;
    }

    if (isCompactV2) {
        const bool needsDerivedLocMeta =
            lengths[TICK_FIELD_LOC_FRAME_STEPS] == 0 &&
            lengths[TICK_FIELD_LOC_HAS_ANIM_MAYA] == 0 &&
            lengths[TICK_FIELD_LOC_ANIM_MAYA_DURATIONS] == 0 &&
            lengths[TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS] == 0 &&
            lengths[TICK_FIELD_LOC_FRAME_LENGTH_COUNTS] == 0 &&
            lengths[TICK_FIELD_LOC_FRAME_LENGTHS_PACKED] == 0;
        if (needsDerivedLocMeta) {
            std::vector<rs::i32> frameSteps{};
            std::vector<rs::i32> hasAnimMaya{};
            std::vector<rs::i32> animMayaDurations{};
            std::vector<rs::i32> frameLengthOffsets{};
            std::vector<rs::i32> frameLengthCounts{};
            std::vector<rs::i32> frameLengthsPacked{};
            const rs::i32 ds = deriveLocSeqMetadataFromCompactIds(
                runtime,
                compactLocSeqIds,
                &frameSteps,
                &hasAnimMaya,
                &animMayaDurations,
                &frameLengthOffsets,
                &frameLengthCounts,
                &frameLengthsPacked);
            if (ds != 1) {
                return -2;
            }
            tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_STEPS)] =
                std::move(frameSteps);
            tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_HAS_ANIM_MAYA)] =
                std::move(hasAnimMaya);
            tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_ANIM_MAYA_DURATIONS)] =
                std::move(animMayaDurations);
            tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS)] =
                std::move(frameLengthOffsets);
            tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_LENGTH_COUNTS)] =
                std::move(frameLengthCounts);
            tickState.fields[static_cast<std::size_t>(TICK_FIELD_LOC_FRAME_LENGTHS_PACKED)] =
                std::move(frameLengthsPacked);
        }
    }

    const auto fieldLen = [&](const TickStateFieldIndex index) -> rs::i32 {
        return static_cast<rs::i32>(tickState.fields[static_cast<std::size_t>(index)].size());
    };
    if (fieldLen(TICK_FIELD_LOC_CYCLE_STARTS_FIXED) != locCount ||
        fieldLen(TICK_FIELD_LOC_FRAME_STEPS) != locCount ||
        fieldLen(TICK_FIELD_LOC_HAS_ANIM_MAYA) != locCount ||
        fieldLen(TICK_FIELD_LOC_ANIM_MAYA_DURATIONS) != locCount ||
        fieldLen(TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS) != locCount ||
        fieldLen(TICK_FIELD_LOC_FRAME_LENGTH_COUNTS) != locCount ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_BASE, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_BASE, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_ANIM_FRAME_COUNTS_BASE, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_ALPHA, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD_ALPHA, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_ALPHA, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD_ALPHA, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_ALPHA, locCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_LOC_ANIM_FRAME_COUNTS_ALPHA, locCount)) {
        return -2;
    }

    if (!requireFieldLengthEquals(lengths, TICK_FIELD_NPC_Y, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_ORIENTATION, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_ROTATION, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_PATH_LENGTH, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_MOVEMENT_SEQ_ID, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_SIZE, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IS_CLICKABLE, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_ROTATION_SPEED, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_ID, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_ID, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_HAS_WALK_ANIM, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_FRAME_IDS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_FRAME_TICKS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_MOVEMENT_LOOPS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_VALID, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_HAS_ANIM_MAYA, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_ANIM_MAYA_DURATIONS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_FRAME_STEPS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_LOOPING, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_MAX_LOOPS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_FRAME_ID_COUNTS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_OFFSETS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_COUNTS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_VALID, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_HAS_ANIM_MAYA, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_ANIM_MAYA_DURATIONS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_FRAME_STEPS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_LOOPING, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_MAX_LOOPS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_FRAME_ID_COUNTS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_OFFSETS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_COUNTS, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_DRAW_RANGE_INDICES, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_BASE, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_BASE, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_BASE, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_BASE, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_ALPHA, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_ALPHA, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_ALPHA, npcCount) ||
        !requireFieldLengthEquals(lengths, TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_ALPHA, npcCount)) {
        return -2;
    }

    const rs::i32 expectedPathPackedLength = npcCount * RS_NPC_PATH_QUEUE_LEN_PACKED;
    if (lengths[TICK_FIELD_NPC_PATH_X_PACKED] != expectedPathPackedLength ||
        lengths[TICK_FIELD_NPC_PATH_Y_PACKED] != expectedPathPackedLength ||
        lengths[TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED] != expectedPathPackedLength) {
        return -2;
    }

    tickState.locCount = locCount;
    tickState.npcCount = npcCount;
    runtime->tickStates[stateKey] = std::move(tickState);
    return 1;
}

// Update only the NPC path-decision inputs for an existing tick state.
RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_update_tick_state_npc_path_packed(
    const rs::i32 runtimeHandle,
    const rs::i32 stateKey,
    const rs::i32* packed,
    const rs::i32 packedLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || stateKey < 0 || !packed || packedLength < 2) {
        return 0;
    }

    static constexpr rs::i32 RS_NPC_PATH_PACKED_VERSION = 1;
    const rs::i32 version = packed[0] | 0;
    const rs::i32 npcCount = packed[1] | 0;
    if (version != RS_NPC_PATH_PACKED_VERSION || npcCount < 0) {
        return 0;
    }

    auto it = runtime->tickStates.find(stateKey);
    if (it == runtime->tickStates.end()) {
        return 0;
    }
    MapRenderTickState& tickState = it->second;
    if (tickState.npcCount != npcCount) {
        return 0;
    }

    const rs::i32 expectedPathPacked = npcCount * RS_NPC_PATH_QUEUE_LEN;

    auto copyIntoField = [&](const TickStateFieldIndex index, const rs::i32 len, rs::i32& cursor) {
        auto& dst = tickState.fields[static_cast<std::size_t>(index)];
        if (static_cast<rs::i32>(dst.size()) != len) {
            return false;
        }
        if (len > 0) {
            std::memcpy(dst.data(), packed + cursor, static_cast<std::size_t>(len) * sizeof(rs::i32));
        }
        cursor += len;
        return true;
    };

    rs::i32 cursor = 2;
    const rs::i32 expectedLength = 2 + npcCount + expectedPathPacked * 3;
    if (packedLength != expectedLength) {
        return 0;
    }
    if (!copyIntoField(TICK_FIELD_NPC_PATH_LENGTH, npcCount, cursor) ||
        !copyIntoField(TICK_FIELD_NPC_PATH_X_PACKED, expectedPathPacked, cursor) ||
        !copyIntoField(TICK_FIELD_NPC_PATH_Y_PACKED, expectedPathPacked, cursor) ||
        !copyIntoField(TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED, expectedPathPacked, cursor)) {
        return 0;
    }
    return cursor == packedLength ? 1 : 0;
}
