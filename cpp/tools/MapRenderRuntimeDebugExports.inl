// Extracted from `cpp/tools/rs_map_render_backend.cpp` (no behavior changes).

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_collect_map_input_digest(
    const rs::i32 runtimeHandle,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < 8) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    std::vector<rs::i32> mapSquareIds;
    std::vector<rs::i32> terrainOffsets;
    std::vector<rs::i32> terrainLengths;
    std::vector<rs::u8> terrainBytes;
    std::vector<rs::i32> locOffsets;
    std::vector<rs::i32> locLengths;
    std::vector<rs::u8> locBytes;
    const rs::i32 status = collectRuntimeCachedMapInput(
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
    if (status != RS_MAP_RENDER_STATUS_OK) {
        return status;
    }

    outDigest[0] = static_cast<rs::i32>(mapSquareIds.size());
    outDigest[1] = static_cast<rs::i32>(terrainBytes.size());
    outDigest[2] = static_cast<rs::i32>(locBytes.size());
    outDigest[3] = static_cast<rs::i32>(fnv1a32SpanI32(mapSquareIds));
    outDigest[4] = static_cast<rs::i32>(fnv1a32SpanI32(terrainOffsets));
    outDigest[5] = static_cast<rs::i32>(fnv1a32SpanI32(terrainLengths));
    outDigest[6] = static_cast<rs::i32>(fnv1a32SpanU8(terrainBytes));
    outDigest[7] = static_cast<rs::i32>(fnv1a32SpanU8(locBytes));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_cache_config(
    const rs::i32 runtimeHandle,
    rs::i32* outConfig,
    const rs::i32 outConfigLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outConfig || outConfigLength < 4) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outConfig[0] = runtime->cache.cacheGame;
    outConfig[1] = runtime->cache.cacheRevision;
    outConfig[2] = runtime->cache.sceneLevels;
    outConfig[3] = runtime->cache.unitsTileHeightBasis;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_loaded_height_hash(
    const rs::i32 runtimeHandle,
    rs::i32* outHash) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outHash || !runtime->mapPayload.loaded) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    *outHash = static_cast<rs::i32>(fnv1a32SpanI16(runtime->mapPayload.heightMap));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_map_input_hashes(
    const rs::i32 runtimeHandle,
    rs::i32* outHashes,
    const rs::i32 outHashesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outHashes || outHashesLength < 3) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outHashes[0] = runtime->debugLastMapInputHashDirect;
    outHashes[1] = runtime->debugLastMapInputHashCache;
    outHashes[2] = runtime->debugLastCacheScratchHeightHash;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_build_failure(
    const rs::i32 runtimeHandle,
    rs::i32* outFailure,
    const rs::i32 outFailureLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outFailure || outFailureLength < 4) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outFailure[0] = runtime->debugLastBuildFailureStage;
    outFailure[1] = runtime->debugLastBuildFailureStatus;
    outFailure[2] = runtime->debugLastBuildFailureDetail0;
    outFailure[3] = runtime->debugLastBuildFailureDetail1;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_collect_map_input(
    const rs::i32 runtimeHandle,
    rs::i32* outState,
    const rs::i32 outStateLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outState || outStateLength < RS_MAP_RENDER_RUNTIME_COLLECT_MAP_INPUT_DEBUG_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outState[0] = runtime->debugLastCollectMapInputStatus;
    outState[1] = runtime->debugLastCollectMapInputReason;
    outState[2] = runtime->debugLastCollectMapInputMapStartX;
    outState[3] = runtime->debugLastCollectMapInputMapStartY;
    outState[4] = runtime->debugLastCollectMapInputMapEndX;
    outState[5] = runtime->debugLastCollectMapInputMapEndY;
    outState[6] = runtime->debugLastCollectMapInputExpectedSquares;
    outState[7] = runtime->debugLastCollectMapInputSquaresWithAny;
    outState[8] = runtime->debugLastCollectMapInputSquaresWithTerrain;
    outState[9] = runtime->debugLastCollectMapInputSquaresWithLoc;
    outState[10] = runtime->debugLastCollectMapInputFirstPresentMapSquareId;
    outState[11] = runtime->debugLastCollectMapInputFirstMissingMapSquareId;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_command_stream_status(
    const rs::i32 runtimeHandle,
    rs::i32* outStatus,
    const rs::i32 outStatusLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outStatus || outStatusLength < 1) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outStatus[0] = runtime->debugLastCommandStreamCoreStatus;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_legacy_model_load(
    const rs::i32 runtimeHandle,
    rs::i32* outState,
    const rs::i32 outStateLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outState || outStateLength < 3) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outState[0] = runtime->debugLastLegacyModelId;
    outState[1] = runtime->debugLastLegacyModelStatus;
    outState[2] = runtime->debugLastLegacyModelMissingFile;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_missing_type(
    const rs::i32 runtimeHandle,
    rs::i32* outState,
    const rs::i32 outStateLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outState || outStateLength < 2) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outState[0] = runtime->debugLastMissingTypeKind;
    outState[1] = runtime->debugLastMissingTypeId;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_npc_build_stats(
    const rs::i32 runtimeHandle,
    rs::i32* outState,
    const rs::i32 outStateLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outState || outStateLength < RS_MAP_RENDER_RUNTIME_NPC_BUILD_DEBUG_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outState[0] = runtime->debugLastNpcBuildStatus;
    outState[1] = runtime->debugLastNpcSpawnBytesLength;
    outState[2] = runtime->debugLastNpcSpawnsDecoded;
    outState[3] = runtime->debugLastNpcSpawnsInBounds;
    outState[4] = runtime->debugLastNpcResolvedType;
    outState[5] = runtime->debugLastNpcLoginPropRenderable;
    outState[6] = runtime->debugLastNpcModelDecodeOk;
    outState[7] = runtime->debugLastNpcModelDecodeFailed;
    outState[8] = runtime->debugLastNpcSpawnsWithGeometry;
    outState[9] = runtime->debugLastNpcDrawRangeCount;
    outState[10] = runtime->debugLastNpcVertexBytes;
    outState[11] = runtime->debugLastNpcIndexCount;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_cached_command_stream_digest(
    const rs::i32 runtimeHandle,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < RS_MAP_RENDER_RUNTIME_COMMAND_STREAM_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    std::array<rs::i32, kRuntimeDrawBucketCount> bucketCounts{};
    for (std::size_t i = 0; i < stream.cmdBucketIndices.size(); i++) {
        const rs::i32 bucket = stream.cmdBucketIndices[i];
        if (bucket < 0 || bucket >= kRuntimeDrawBucketCount) {
            return RS_MAP_RENDER_STATUS_STATE;
        }
        bucketCounts[static_cast<std::size_t>(bucket)]++;
    }

    // Hash geometry by *renderer-used* index ranges when a packet payload exists (drawRangesPacked),
    // so this digest matches TS `digestTsRuntimeCommandStream` behavior (hashVertexPrefixFromIndexRanges + hashIndicesInRanges).
    // This matters when the runtime emits additional geometry not referenced by the current draw ranges
    // (e.g. animated-loc precomputed frames, placeholders).
    rs::u32 verticesHashU32 = 0;
    rs::u32 indicesHashU32 = 0;
    if (runtime->mapPayload.loaded) {
        const rs::tooling::MapRenderLoadedPayloadState& payload = runtime->mapPayload;
        rs::i32 totalCmdCount = 0;
        for (rs::i32 i = 0; i < kRuntimeDrawBucketCount; i++) {
            const rs::i32 c = payload.bucketCmdCounts[static_cast<std::size_t>(i)];
            if (c < 0) {
                return RS_MAP_RENDER_STATUS_STATE;
            }
            totalCmdCount += c;
        }
        const std::size_t expectedDrawRangesInts = static_cast<std::size_t>(totalCmdCount) * 3u;
        if (payload.drawRangesPacked.size() == expectedDrawRangesInts) {
            // Collect and merge used index ranges (order-independent), then hash indices in increasing order
            // to match TS `hashIndicesInRanges`.
            std::vector<std::pair<rs::i32, rs::i32>> ranges;
            ranges.reserve(payload.drawRangesPacked.size() / 3u);
            for (std::size_t j = 0; j + 2 < payload.drawRangesPacked.size(); j += 3) {
                const rs::i32 offsetBytes = payload.drawRangesPacked[j];
                const rs::i32 elements = payload.drawRangesPacked[j + 1];
                if (offsetBytes < 0 || elements <= 0) continue;
                const rs::i32 start = offsetBytes >> 2;
                const rs::i32 end = start + elements;
                if (end > start) {
                    ranges.emplace_back(start, end);
                }
            }
            std::sort(ranges.begin(), ranges.end(), [](auto& a, auto& b) { return a.first < b.first; });
            std::vector<std::pair<rs::i32, rs::i32>> merged;
            merged.reserve(ranges.size());
            for (std::size_t i = 0; i < ranges.size(); i++) {
                const rs::i32 s = ranges[i].first;
                const rs::i32 e = ranges[i].second;
                if (merged.empty()) {
                    merged.emplace_back(s, e);
                    continue;
                }
                auto& last = merged.back();
                if (s <= last.second) {
                    if (e > last.second) last.second = e;
                    continue;
                }
                merged.emplace_back(s, e);
            }

            rs::u32 idxHash = 2166136261u;
            rs::i32 maxVertexIndex = -1;
            const std::size_t indicesLen = stream.indices.size();
            for (std::size_t r = 0; r < merged.size(); r++) {
                const rs::i32 start = merged[r].first;
                const rs::i32 end = merged[r].second;
                const std::size_t s = start < 0 ? 0u : static_cast<std::size_t>(start);
                const std::size_t e = end < 0 ? 0u : static_cast<std::size_t>(end);
                const std::size_t clampedEnd = e > indicesLen ? indicesLen : e;
                for (std::size_t ii = s; ii < clampedEnd; ii++) {
                    const rs::i32 v = stream.indices[ii];
                    idxHash = fnv1a32UpdateI32(idxHash, v);
                    if (v > maxVertexIndex) {
                        maxVertexIndex = v;
                    }
                }
            }
            indicesHashU32 = idxHash;

            rs::u32 vtxHash = 2166136261u;
            if (maxVertexIndex >= 0) {
                const std::size_t needBytes =
                    static_cast<std::size_t>(maxVertexIndex + 1) * static_cast<std::size_t>(16);
                const std::size_t clampBytes =
                    needBytes < stream.vertices.size() ? needBytes : stream.vertices.size();
                for (std::size_t i = 0; i < clampBytes; i++) {
                    vtxHash = fnv1a32UpdateByte(vtxHash, stream.vertices[i]);
                }
            }
            verticesHashU32 = vtxHash;
        }
    }
    if (verticesHashU32 == 0 && indicesHashU32 == 0) {
        verticesHashU32 = fnv1a32SpanU8(stream.vertices);
        indicesHashU32 = fnv1a32SpanI32(stream.indices);
    }

    outDigest[0] = static_cast<rs::i32>(stream.cmdOffsets.size());
    outDigest[1] = static_cast<rs::i32>(fnv1a32SpanI32(stream.cmdBucketIndices));
    outDigest[2] = static_cast<rs::i32>(fnv1a32SpanI32(stream.cmdOffsets));
    outDigest[3] = static_cast<rs::i32>(fnv1a32SpanI32(stream.cmdElements));
    outDigest[4] = static_cast<rs::i32>(fnv1a32SpanI32(stream.cmdInstanceCounts));
    outDigest[5] = static_cast<rs::i32>(fnv1a32SpanI32(stream.cmdPackedInstances));
    outDigest[6] = static_cast<rs::i32>(verticesHashU32);
    outDigest[7] = static_cast<rs::i32>(indicesHashU32);
    for (rs::i32 i = 0; i < kRuntimeDrawBucketCount; i++) {
        outDigest[8 + i] = bucketCounts[static_cast<std::size_t>(i)];
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_cached_command_stream_lengths(
    const rs::i32 runtimeHandle,
    rs::i32* outLengths,
    const rs::i32 outLengthsLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outLengths || outLengthsLength < 4) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outLengths[0] = static_cast<rs::i32>(stream.cmdOffsets.size());
    outLengths[1] = static_cast<rs::i32>(stream.cmdPackedInstances.size());
    outLengths[2] = static_cast<rs::i32>(stream.vertices.size());
    outLengths[3] = static_cast<rs::i32>(stream.indices.size());
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_cached_command_stream(
    const rs::i32 runtimeHandle,
    rs::i32* outCmdBucketIndices,
    const rs::i32 outCmdBucketIndicesLength,
    rs::i32* outCmdOffsets,
    const rs::i32 outCmdOffsetsLength,
    rs::i32* outCmdElements,
    const rs::i32 outCmdElementsLength,
    rs::i32* outCmdInstanceCounts,
    const rs::i32 outCmdInstanceCountsLength,
    rs::i32* outCmdPackedInstances,
    const rs::i32 outCmdPackedInstancesLength,
    rs::u8* outVertices,
    const rs::i32 outVerticesLength,
    rs::i32* outIndices,
    const rs::i32 outIndicesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 cmdCount = static_cast<rs::i32>(stream.cmdOffsets.size());
    const rs::i32 packedCount = static_cast<rs::i32>(stream.cmdPackedInstances.size());
    const rs::i32 verticesCount = static_cast<rs::i32>(stream.vertices.size());
    const rs::i32 indicesCount = static_cast<rs::i32>(stream.indices.size());

    if (!outCmdBucketIndices || !outCmdOffsets || !outCmdElements || !outCmdInstanceCounts ||
        !outCmdPackedInstances || !outVertices || !outIndices) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (outCmdBucketIndicesLength != cmdCount ||
        outCmdOffsetsLength != cmdCount ||
        outCmdElementsLength != cmdCount ||
        outCmdInstanceCountsLength != cmdCount ||
        outCmdPackedInstancesLength != packedCount ||
        outVerticesLength != verticesCount ||
        outIndicesLength != indicesCount) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    if (cmdCount > 0) {
        std::memcpy(
            outCmdBucketIndices,
            stream.cmdBucketIndices.data(),
            static_cast<std::size_t>(cmdCount) * sizeof(rs::i32));
        std::memcpy(
            outCmdOffsets,
            stream.cmdOffsets.data(),
            static_cast<std::size_t>(cmdCount) * sizeof(rs::i32));
        std::memcpy(
            outCmdElements,
            stream.cmdElements.data(),
            static_cast<std::size_t>(cmdCount) * sizeof(rs::i32));
        std::memcpy(
            outCmdInstanceCounts,
            stream.cmdInstanceCounts.data(),
            static_cast<std::size_t>(cmdCount) * sizeof(rs::i32));
    }
    if (packedCount > 0) {
        std::memcpy(
            outCmdPackedInstances,
            stream.cmdPackedInstances.data(),
            static_cast<std::size_t>(packedCount) * sizeof(rs::i32));
    }
    if (verticesCount > 0) {
        std::memcpy(
            outVertices,
            stream.vertices.data(),
            static_cast<std::size_t>(verticesCount) * sizeof(rs::u8));
    }
    if (indicesCount > 0) {
        std::memcpy(
            outIndices,
            stream.indices.data(),
            static_cast<std::size_t>(indicesCount) * sizeof(rs::i32));
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_terrain_tile_face_counts_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta || outMetaLength < RS_MAP_RENDER_RUNTIME_TERRAIN_TILE_FACE_COUNTS_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugTerrainTileFaceCounts.size());
    // Debug API: always return meta when a build exists, even if no grid was captured.
    outMeta[0] = stream.debugTerrainTileFaceCountsLevels;
    outMeta[1] = stream.debugTerrainTileFaceCountsWidth;
    outMeta[2] = stream.debugTerrainTileFaceCountsHeight;
    outMeta[3] = stream.debugTerrainTileFaceCountsBorder;
    outMeta[4] = len;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_terrain_tile_face_counts(
    const rs::i32 runtimeHandle,
    rs::u8* outBytes,
    const rs::i32 outBytesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugTerrainTileFaceCounts.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outBytes || outBytesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(outBytes, stream.debugTerrainTileFaceCounts.data(), static_cast<std::size_t>(len));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_terrain_digest(
    const rs::i32 runtimeHandle,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < RS_MAP_RENDER_RUNTIME_TERRAIN_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outDigest[0] = runtime->cache.sceneLevels;
    outDigest[1] = stream.debugTerrainDigestFacesTotal;
    outDigest[2] = stream.debugTerrainDigestVerticesTotal;
    outDigest[3] = stream.debugTerrainDigestHash;
    outDigest[4] = stream.debugTerrainDigestLevelFaces0;
    outDigest[5] = stream.debugTerrainDigestLevelFaces1;
    outDigest[6] = stream.debugTerrainDigestLevelFaces2;
    outDigest[7] = stream.debugTerrainDigestLevelFaces3;
    outDigest[8] = stream.debugTerrainDigestLevelVertices0;
    outDigest[9] = stream.debugTerrainDigestLevelVertices1;
    outDigest[10] = stream.debugTerrainDigestLevelVertices2;
    outDigest[11] = stream.debugTerrainDigestLevelVertices3;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_set_terrain_digest_sample_start_vertex(
    const rs::i32 runtimeHandle,
    const rs::i32 startVertex) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->debugTerrainDigestSampleStartVertex = startVertex > 0 ? startVertex : 0;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_set_terrain_probe(
    const rs::i32 runtimeHandle,
    const rs::i32 level,
    const rs::i32 tileX,
    const rs::i32 tileY) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->debugTerrainProbeLevel = level;
    runtime->debugTerrainProbeTileX = tileX;
    runtime->debugTerrainProbeTileY = tileY;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_set_world_height_probe(
    const rs::i32 runtimeHandle,
    const rs::i32 level,
    const rs::i32 worldX,
    const rs::i32 worldZ) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    runtime->debugWorldHeightProbeLevel = level;
    runtime->debugWorldHeightProbeWorldX = worldX;
    runtime->debugWorldHeightProbeWorldZ = worldZ;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_terrain_digest_samples_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_TERRAIN_DIGEST_SAMPLES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 count = stream.debugTerrainDigestSampleCount;
    const rs::i32 stride = stream.debugTerrainDigestSampleStrideInts;
    const rs::i32 capInts =
        rs::SceneCommandStream::kDebugTerrainDigestSampleVertexLimit *
        rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts;
    const rs::i32 lenInts = (count > 0 && stride > 0)
        ? ((count * stride) > capInts ? capInts : (count * stride))
        : 0;
    outMeta[0] = (count >= 0 ? count : 0);
    outMeta[1] = (stride > 0 ? stride : rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts);
    outMeta[2] = (lenInts >= 0 ? lenInts : 0);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_terrain_digest_samples_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outI32,
    const rs::i32 outI32Length) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 count = stream.debugTerrainDigestSampleCount;
    const rs::i32 stride = stream.debugTerrainDigestSampleStrideInts;
    const rs::i32 capInts =
        rs::SceneCommandStream::kDebugTerrainDigestSampleVertexLimit *
        rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts;
    const rs::i32 lenInts = (count > 0 && stride > 0)
        ? ((count * stride) > capInts ? capInts : (count * stride))
        : 0;
    if (lenInts <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outI32 || outI32Length != lenInts) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outI32,
        stream.debugTerrainDigestSamplesPacked,
        static_cast<std::size_t>(lenInts) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_terrain_probe(
    const rs::i32 runtimeHandle,
    rs::i32* outI32,
    const rs::i32 outI32Length) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outI32 || outI32Length < RS_MAP_RENDER_RUNTIME_TERRAIN_PROBE_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outI32[0] = stream.debugTerrainProbeHit;
    outI32[1] = stream.debugTerrainProbeLevel;
    outI32[2] = stream.debugTerrainProbeTileX;
    outI32[3] = stream.debugTerrainProbeTileY;
    for (rs::i32 i = 0; i < 64; i++) {
        outI32[4 + i] = stream.debugTerrainProbePacked[static_cast<std::size_t>(i)];
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_decode_cached_terrain_cell(
    const rs::i32 runtimeHandle,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::i32 level,
    const rs::i32 localX,
    const rs::i32 localY,
    rs::i32* outI32,
    const rs::i32 outI32Length) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outI32 || outI32Length < RS_MAP_RENDER_RUNTIME_CACHED_TERRAIN_CELL_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (level < 0 || level >= rs::TerrainConstants::MAX_LEVELS ||
        localX < 0 || localX >= rs::TerrainConstants::MAP_SQUARE_SIZE ||
        localY < 0 || localY >= rs::TerrainConstants::MAP_SQUARE_SIZE) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    const rs::i32 key = mapSquareId(mapX, mapY);
    const std::vector<rs::u8>* terrainBytes =
        tryGetRuntimeCacheBlobBytes(
            *runtime,
            RS_MAP_RENDER_BLOB_DOMAIN_MAP_SQUARE,
            key,
            RS_MAP_RENDER_BLOB_MAP_SQUARE_FILE_TERRAIN);
    if (!terrainBytes || terrainBytes->empty()) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    const bool newFormat = isRuntimeNewTerrainFormat(*runtime);
    rs::TerrainSquare scratch{};
    rs::Allocator& alloc = rs::defaultAllocator();
    const auto initStatus = scratch.init(alloc);
    if (!initStatus.isOk()) {
        if (initStatus.status() == rs::Status::SizeMismatch ||
            initStatus.status() == rs::Status::OutOfRange) {
            return -2;
        }
        return -1;
    }
    const rs::Status ds = rs::decodeTerrainSquareFromBytesInto(
        scratch,
        rs::Span<const rs::u8>(terrainBytes->data(), terrainBytes->size()),
        newFormat,
        mapX * rs::TerrainConstants::MAP_SQUARE_SIZE,
        mapY * rs::TerrainConstants::MAP_SQUARE_SIZE);
    if (!rs::ok(ds)) {
        if (ds == rs::Status::SizeMismatch || ds == rs::Status::OutOfRange) {
            return -2;
        }
        return -1;
    }

    // Layout (len=16):
    // [0]=ok(0/1) [1]=newFormat(0/1) [2]=terrainBytesLen
    // [3]=underlayRaw [4]=overlayRaw [5]=shape [6]=rotation [7]=renderFlags
    // [8]=height [9]=cacheGame [10]=cacheRevision [11]=mapX [12]=mapY [13..15]=reserved
    for (rs::i32 i = 0; i < RS_MAP_RENDER_RUNTIME_CACHED_TERRAIN_CELL_LENGTH; i++) {
        outI32[i] = 0;
    }
    outI32[0] = 1;
    outI32[1] = newFormat ? 1 : 0;
    outI32[2] = static_cast<rs::i32>(terrainBytes->size());
    outI32[3] = static_cast<rs::i32>(scratch.underlay(level, localX, localY));
    outI32[4] = static_cast<rs::i32>(scratch.overlay(level, localX, localY));
    outI32[5] = static_cast<rs::i32>(scratch.shape(level, localX, localY));
    outI32[6] = static_cast<rs::i32>(scratch.rotation(level, localX, localY));
    outI32[7] = static_cast<rs::i32>(scratch.renderFlags(level, localX, localY));
    outI32[8] = static_cast<rs::i32>(scratch.height(level, localX, localY));
    outI32[9] = runtime->cache.cacheGame;
    outI32[10] = runtime->cache.cacheRevision;
    outI32[11] = mapX;
    outI32[12] = mapY;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_world_height_probe(
    const rs::i32 runtimeHandle,
    rs::i32* outI32,
    const rs::i32 outI32Length) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outI32 || outI32Length < RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outI32[0] = stream.debugWorldHeightProbeHit;
    outI32[1] = stream.debugWorldHeightProbeLevel;
    outI32[2] = stream.debugWorldHeightProbeWorldX;
    outI32[3] = stream.debugWorldHeightProbeWorldZ;
    for (rs::i32 i = 0; i < RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_PACKED_LENGTH; i++) {
        outI32[4 + i] = stream.debugWorldHeightProbePacked[static_cast<std::size_t>(i)];
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_scene_command_plan_digest(
    const rs::i32 runtimeHandle,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest ||
        outDigestLength < RS_MAP_RENDER_RUNTIME_SCENE_COMMAND_PLAN_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outDigest[0] = stream.debugSceneCommandPlanOpCount;
    outDigest[1] = stream.debugSceneCommandPlanMergedGroupOpCount;
    outDigest[2] = stream.debugSceneCommandPlanInstancedOpCount;
    outDigest[3] = stream.debugSceneCommandPlanInstancedFacesTotal;
    outDigest[4] = stream.debugSceneCommandPlanInstancedInstancesTotal;
    outDigest[5] = stream.debugSceneCommandPlanInstancedLodInstancesTotal;
    outDigest[6] = stream.debugSceneCommandPlanSeqHash;
    outDigest[7] = stream.debugSceneCommandPlanMultisetHashSum;
    outDigest[8] = stream.debugSceneCommandPlanMultisetHashXor;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_scene_command_plan_ops_packed_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_SCENE_COMMAND_PLAN_OPS_PACKED_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugSceneCommandPlanOpsPacked.size());
    outMeta[0] = (len >= 0 ? len : 0);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_scene_command_plan_ops_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outI32,
    const rs::i32 outI32Length) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugSceneCommandPlanOpsPacked.size());
    if (len < 0) {
        return RS_MAP_RENDER_STATUS_STATE;
    }
    if (len == 0) {
        return RS_MAP_RENDER_STATUS_OK;
    }
    if (!outI32 || outI32Length != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outI32,
        stream.debugSceneCommandPlanOpsPacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_scene_command_plan_op_provenance_packed_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta || outMetaLength < 1) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugSceneCommandPlanOpProvenancePacked.size());
    outMeta[0] = (len >= 0 ? len : 0);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_scene_command_plan_op_provenance_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outI32,
    const rs::i32 outI32Length) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugSceneCommandPlanOpProvenancePacked.size());
    if (len < 0) {
        return RS_MAP_RENDER_STATUS_STATE;
    }
    if (len == 0) {
        return RS_MAP_RENDER_STATUS_OK;
    }
    if (!outI32 || outI32Length != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outI32,
        stream.debugSceneCommandPlanOpProvenancePacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_scene_buckets_digest(
    const rs::i32 runtimeHandle,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest ||
        outDigestLength < RS_MAP_RENDER_RUNTIME_SCENE_BUCKETS_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outDigest[0] = stream.debugSceneBucketsCmdTotal;
    outDigest[1] = stream.debugSceneBucketsInstanceTotal;
    outDigest[2] = stream.debugSceneBucketsHash;
    outDigest[3] = stream.debugSceneBucketsCmdCount0;
    outDigest[4] = stream.debugSceneBucketsCmdCount1;
    outDigest[5] = stream.debugSceneBucketsCmdCount2;
    outDigest[6] = stream.debugSceneBucketsCmdCount3;
    outDigest[7] = stream.debugSceneBucketsCmdCount4;
    outDigest[8] = stream.debugSceneBucketsCmdCount5;
    outDigest[9] = stream.debugSceneBucketsCmdCount6;
    outDigest[10] = stream.debugSceneBucketsCmdCount7;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_render_placement_digest(
    const rs::i32 runtimeHandle,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest ||
        outDigestLength < RS_MAP_RENDER_RUNTIME_LOC_RENDER_PLACEMENT_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outDigest[0] = stream.debugLocRenderPlacementCount;
    outDigest[1] = (stream.debugLocRenderPlacementCount > 0)
        ? stream.debugLocRenderPlacementDigestHash
        : 0;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_render_placement_entries_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_LOC_RENDER_PLACEMENT_ENTRIES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugLocRenderPlacementEntriesPacked.size());
    outMeta[1] = 13;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_loc_render_placement_entries_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outEntries,
    const rs::i32 outEntriesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugLocRenderPlacementEntriesPacked.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outEntries || outEntriesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outEntries,
        stream.debugLocRenderPlacementEntriesPacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

// Forward-declared: used by model/loc debug exports; defined later in this file.
static rs::Status decodeLocTypeFromTypeBlob(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 locTypeId,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    rs::LocType* outType);

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_model_faces_digest(
    const rs::i32 runtimeHandle,
    const rs::i32 modelId,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < RS_MAP_RENDER_RUNTIME_MODEL_FACES_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    rs::Span<const rs::u8> modelBytes{};
    const rs::Status ms = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
        modelId,
        &modelBytes);
    if (!rs::ok(ms)) {
        return ms == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    auto isTextureTransparent = [&](rs::i32 textureId) -> bool {
        if (textureId < 0) {
            return false;
        }
        // Texture transparent ids are stored as presence-only keys:
        // (domain=104, group=0, file=textureId).
        const MapRenderRuntimeCacheState::BlobKey key{
            RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_TRANSPARENT,
            0,
            textureId};
        return runtime->cache.blobEntries.find(key) != runtime->cache.blobEntries.end();
    };

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::ModelData model(alloc);
    const rs::Status ds = rs::decodeModelData(
        modelBytes,
        &model,
        alloc);
    if (!rs::ok(ds)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    rs::u32 h = 2166136261u;
    rs::i32 faceCount = 0;
    rs::i32 opaqueCount = 0;
    rs::i32 transparentCount = 0;

    const rs::i32 fc = model.faceCount;
    for (rs::i32 i = 0; i < fc; i++) {
        rs::i32 type = 0;
        if (model.hasFaceRenderTypes && i >= 0 && i < static_cast<rs::i32>(model.faceRenderTypes.size())) {
            type = static_cast<rs::i32>(model.faceRenderTypes[static_cast<std::size_t>(i)]) & 0xff;
        }

        rs::i32 rawAlphaSigned = 0;
        if (model.hasFaceAlphas && i >= 0 && i < static_cast<rs::i32>(model.faceAlphas.size())) {
            rawAlphaSigned = static_cast<rs::i32>(model.faceAlphas[static_cast<std::size_t>(i)]);
        }
        if (rawAlphaSigned == -2) {
            type = 3;
        } else if (rawAlphaSigned == -1) {
            type = 2;
        }

        rs::i32 textureId = -1;
        if (model.hasFaceTextures && i >= 0 && i < static_cast<rs::i32>(model.faceTextures.size())) {
            textureId = static_cast<rs::i32>(model.faceTextures[static_cast<std::size_t>(i)]);
        }

        // Match TS `ModelData.light` drawability filter:
        // faces with invalid type/texture combos are marked as faceColors3 = -2 and skipped by `getModelFaces`.
        bool drawable = false;
        if (textureId == -1) {
            drawable = (type == 0 || type == 1 || type == 3);
        } else {
            drawable = (type == 0 || type == 1);
        }
        if (!drawable) {
            continue;
        }

        rs::i32 alpha = 0xff;
        if (textureId == -1 && model.hasFaceAlphas && i < static_cast<rs::i32>(model.faceAlphas.size())) {
            alpha = 0xff - (rawAlphaSigned & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        rs::i32 priority = 0;
        if (model.hasFaceRenderPriorities && i < static_cast<rs::i32>(model.faceRenderPriorities.size())) {
            priority = static_cast<rs::i32>(model.faceRenderPriorities[static_cast<std::size_t>(i)]);
        }

        const bool isTrans = alpha < 0xff || (textureId != -1 && isTextureTransparent(textureId));
        if (isTrans) {
            transparentCount++;
        } else {
            opaqueCount++;
        }
        faceCount++;

        h = fnv1a32UpdateI32(h, i);
        h = fnv1a32UpdateI32(h, alpha);
        h = fnv1a32UpdateI32(h, priority);
        h = fnv1a32UpdateI32(h, textureId);
        h = fnv1a32UpdateI32(h, isTrans ? 1 : 0);
    }

    outDigest[0] = faceCount;
    outDigest[1] = opaqueCount;
    outDigest[2] = transparentCount;
    outDigest[3] = static_cast<rs::i32>(h);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_loc_classic_anim_frame_faces_digest(
    const rs::i32 runtimeHandle,
    const rs::i32 locTypeId,
    const rs::i32 placementType,
    const rs::i32 rotation,
    const rs::i32 frameId,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < RS_MAP_RENDER_RUNTIME_MODEL_FACES_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    // Build a minimal SceneCommandBuildInput matching runtime build semantics so we can reuse
    // loc-model decode helpers and texture id presence lists.
    std::vector<rs::i32> textureTransparentIds{};
    std::vector<rs::i32> textureIds{};
    collectBlobDomainGroup0IdsSortedUnique(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_TRANSPARENT,
        &textureTransparentIds);
    collectBlobDomainGroup0IdsSortedUnique(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS,
        &textureIds);

    rs::SceneCommandBuildInput input{};
    input.cacheGame = runtime->cache.cacheGame;
    input.cacheRevision = runtime->cache.cacheRevision;
    input.unitsTileHeightBasis = runtime->cache.unitsTileHeightBasis;
    input.typeEntryBytesCtx = runtime;
    input.tryGetTypeEntryBytes = runtimeTryGetTypeEntryBytesFromRuntimeCtx;
    input.textureTransparentIds = rs::Span<const rs::i32>(
        !textureTransparentIds.empty() ? textureTransparentIds.data() : nullptr,
        textureTransparentIds.size());
    input.textureIds =
        rs::Span<const rs::i32>(!textureIds.empty() ? textureIds.data() : nullptr, textureIds.size());

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
    if (cacheType == rs::CacheType::Dat) {
        input.datSeqFrameCtx = runtime;
        input.tryLoadDatSeqFrame = runtimeTryLoadDatSeqFrameFromRuntimeCtx;
    } else if (cacheType == rs::CacheType::Legacy) {
        input.legacySeqFrameCtx = runtime;
        input.tryLoadLegacySeqFrame = runtimeTryLoadLegacySeqFrameFromRuntimeCtx;
        input.modelDataCtx = runtime;
        input.tryLoadModelData = runtimeTryLoadLegacyModelFromRuntimeCtx;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::StringArena strings(alloc);
    rs::LocType locType{};
    const rs::Status lts = decodeLocTypeFromTypeBlob(
        runtime,
        cacheInfo,
        locTypeId,
        &strings,
        alloc,
        &locType);
    if (!rs::ok(lts)) {
        return lts == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    // Collect and merge all models for this loc placement variant.
    rs::Vec<rs::i32> modelIds(alloc);
    if (!rs::scb::collectLocTypeModelIdsForVariant(locType, placementType, &modelIds) ||
        modelIds.empty()) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    rs::ModelData model(alloc);
    bool haveModel = true;
    if (modelIds.size() == 1) {
        const rs::Status ms = rs::scb::decodeLocModelFromBlobForPlacement(
            input,
            locType,
            placementType,
            rotation,
            modelIds[0],
            &model,
            /*applyDiagonalNormalVariantRotation=*/false,
            alloc);
        haveModel = rs::ok(ms);
    } else {
        rs::Vec<rs::ModelData> parts(alloc);
        auto rrReserve = parts.reserve(modelIds.size());
        if (!rrReserve.isOk()) {
            return RS_MAP_RENDER_STATUS_STATE;
        }
        for (std::size_t mi = 0; mi < modelIds.size(); mi++) {
            rs::ModelData part(alloc);
            const rs::Status ms = rs::scb::decodeLocModelFromBlobForPlacement(
                input,
                locType,
                placementType,
                rotation,
                modelIds[mi],
                &part,
                /*applyDiagonalNormalVariantRotation=*/false,
                alloc);
            if (!rs::ok(ms)) {
                haveModel = false;
                break;
            }
            auto rrPush = parts.pushBack(rs::move(part));
            if (!rrPush.isOk()) {
                return RS_MAP_RENDER_STATUS_STATE;
            }
        }
        if (haveModel) {
            const rs::Status ms = rs::mergeModelDataTS(
                rs::Span<const rs::ModelData>(parts.data(), parts.size()),
                static_cast<rs::i32>(parts.size()),
                &model,
                alloc);
            if (!rs::ok(ms)) {
                haveModel = false;
            }
        }
    }
    if (!haveModel) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    // Decode and apply the classic frame.
    rs::SeqBase frameBase(-1, alloc);
    rs::SeqFrame frame(alloc);
    const rs::Status fs = rs::scb::tryDecodeBridgeSeqFrameFromBlob(
        input,
        frameId,
        &frameBase,
        &frame,
        alloc);
    if (!rs::ok(fs)) {
        return fs == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    // TS behavior: alpha transforms apply even if vertex labels are absent; allocate faceAlphas
    // when needed (Model.copyAnimated(..., shallowTransparencies=false)).
    if (frame.hasAlphaTransform) {
        const rs::i32 rawFaceCount = model.faceCount;
        if (rawFaceCount > 0) {
            const std::size_t faceCount = static_cast<std::size_t>(rawFaceCount);
            const std::size_t oldSize = model.faceAlphas.size();
            if (oldSize < faceCount) {
                auto rr = model.faceAlphas.resize(faceCount);
                if (!rr.isOk()) {
                    return RS_MAP_RENDER_STATUS_STATE;
                }
                for (std::size_t i = oldSize; i < faceCount; i++) {
                    model.faceAlphas[i] = 0;
                }
            }
        }
        model.hasFaceAlphas = true;
    }

    // TS transformModel: unrotate -> animate -> rotate back.
    const rs::i32 rot = rotation & 3;
    if (rot == 1) model.rotate270();
    else if (rot == 2) model.rotate180();
    else if (rot == 3) model.rotate90();

    const rs::Status as = rs::scb::applyClassicSeqFrameToModelDataTS(&model, frameBase, frame, alloc);
    if (!rs::ok(as)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    if (rot == 1) model.rotate90();
    else if (rot == 2) model.rotate180();
    else if (rot == 3) model.rotate270();

    // TS getModelAnimated: apply diagonal rotation after animation transforms.
    if (placementType == 10 && rotation > 3) {
        model.rotate(256);
    }

    auto isTextureTransparent = [&](rs::i32 textureId) -> bool {
        if (textureId < 0) return false;
        return rs::scb::findTypeBlobIndex(input.textureTransparentIds, textureId) >= 0;
    };
    auto isTextureSd = [&](rs::i32 textureId) -> bool {
        if (textureId < 0) return false;
        return rs::scb::findTypeBlobIndex(input.textureIds, textureId) >= 0;
    };

    rs::u32 h = 2166136261u;
    rs::i32 faceCount = 0;
    rs::i32 opaqueCount = 0;
    rs::i32 transparentCount = 0;

    const rs::i32 fc = model.faceCount;
    for (rs::i32 i = 0; i < fc; i++) {
        rs::i32 type = 0;
        if (model.hasFaceRenderTypes && i >= 0 &&
            i < static_cast<rs::i32>(model.faceRenderTypes.size())) {
            type = static_cast<rs::i32>(model.faceRenderTypes[static_cast<std::size_t>(i)]) & 0xff;
        }
        rs::i32 rawAlphaSigned = 0;
        if (model.hasFaceAlphas && i >= 0 && i < static_cast<rs::i32>(model.faceAlphas.size())) {
            rawAlphaSigned = static_cast<rs::i32>(model.faceAlphas[static_cast<std::size_t>(i)]);
        }
        rs::i32 rawTextureId = -1;
        if (model.hasFaceTextures && i >= 0 && i < static_cast<rs::i32>(model.faceTextures.size())) {
            rawTextureId = static_cast<rs::i32>(model.faceTextures[static_cast<std::size_t>(i)]);
        }
        if (rawAlphaSigned == -2) type = 3;
        else if (rawAlphaSigned == -1) type = 2;

        // TS `ModelData.light`: non-SD textures are rewritten to -1 on the render Model.
        const bool sdTex = isTextureSd(rawTextureId);
        const rs::i32 textureId = sdTex ? rawTextureId : -1;

        bool drawable = false;
        if (textureId == -1) {
            drawable = (type == 0 || type == 1 || type == 3);
        } else {
            drawable = (type == 0 || type == 1);
        }
        if (!drawable) continue;

        rs::i32 alpha = 0xff;
        if (textureId == -1 && model.hasFaceAlphas && i >= 0 &&
            i < static_cast<rs::i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<rs::i32>(model.faceAlphas[static_cast<std::size_t>(i)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) continue;

        rs::i32 priority = 0;
        if (model.hasFaceRenderPriorities && i >= 0 &&
            i < static_cast<rs::i32>(model.faceRenderPriorities.size())) {
            priority = static_cast<rs::i32>(model.faceRenderPriorities[static_cast<std::size_t>(i)]);
        }

        const bool isTrans = alpha < 0xff || (textureId != -1 && isTextureTransparent(textureId));
        if (isTrans) transparentCount++;
        else opaqueCount++;
        faceCount++;

        h = fnv1a32UpdateI32(h, i);
        h = fnv1a32UpdateI32(h, alpha);
        h = fnv1a32UpdateI32(h, priority);
        h = fnv1a32UpdateI32(h, textureId);
        h = fnv1a32UpdateI32(h, isTrans ? 1 : 0);
    }

    outDigest[0] = faceCount;
    outDigest[1] = opaqueCount;
    outDigest[2] = transparentCount;
    outDigest[3] = static_cast<rs::i32>(h);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_model_vertices_digest(
    const rs::i32 runtimeHandle,
    const rs::i32 modelId,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_DIGEST_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    rs::Span<const rs::u8> modelBytes{};
    const rs::Status ms = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
        modelId,
        &modelBytes);
    if (!rs::ok(ms)) {
        return ms == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::ModelData model(alloc);
    const rs::Status ds = rs::decodeModelData(
        modelBytes,
        &model,
        alloc);
    if (!rs::ok(ds)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    // TS parity: match scripts/cache/map-render-runtime-cache-v2-parity.ts `fnv1a32UpdateInt` by
    // updating per-byte (not whole-i32 XOR) so digests are directly comparable.
    auto fnvMixI32 = [](rs::u32 h, rs::i32 v) noexcept -> rs::u32 {
        rs::u32 x = h;
        const rs::u32 uv = static_cast<rs::u32>(v);
        x ^= (uv & 0xffu);
        x *= 16777619u;
        x ^= ((uv >> 8) & 0xffu);
        x *= 16777619u;
        x ^= ((uv >> 16) & 0xffu);
        x *= 16777619u;
        x ^= ((uv >> 24) & 0xffu);
        x *= 16777619u;
        return x;
    };

    rs::u32 h = 2166136261u;
    h = fnvMixI32(h, model.version);
    h = fnvMixI32(h, model.verticesCount);
    h = fnvMixI32(h, model.usedVertexCount);
    h = fnvMixI32(h, model.faceCount);
    h = fnvMixI32(h, model.textureFaceCount);

    std::size_t n = model.verticesX.size();
    if (model.verticesY.size() < n) n = model.verticesY.size();
    if (model.verticesZ.size() < n) n = model.verticesZ.size();
    for (std::size_t i = 0; i < n; i++) {
        h = fnvMixI32(h, model.verticesX[i]);
        h = fnvMixI32(h, model.verticesY[i]);
        h = fnvMixI32(h, model.verticesZ[i]);
    }

    outDigest[0] = model.verticesCount;
    outDigest[1] = model.usedVertexCount;
    outDigest[2] = model.faceCount;
    outDigest[3] = static_cast<rs::i32>(h);
    if (outDigestLength >= 5) {
        outDigest[4] = model.textureFaceCount;
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_model_vertices_sample(
    const rs::i32 runtimeHandle,
    const rs::i32 modelId,
    rs::i32* outSample,
    const rs::i32 outSampleLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outSample || outSampleLength < RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    rs::Span<const rs::u8> modelBytes{};
    const rs::Status ms = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
        modelId,
        &modelBytes);
    if (!rs::ok(ms)) {
        return ms == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::ModelData model(alloc);
    const rs::Status ds = rs::decodeModelData(
        modelBytes,
        &model,
        alloc);
    if (!rs::ok(ds)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    std::size_t n = model.verticesX.size();
    if (model.verticesY.size() < n) n = model.verticesY.size();
    if (model.verticesZ.size() < n) n = model.verticesZ.size();
    if (n > static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS)) {
        n = static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS);
    }

    outSample[0] = model.version;
    outSample[1] = model.verticesCount;
    outSample[2] = model.usedVertexCount;
    outSample[3] = model.faceCount;
    outSample[4] = static_cast<rs::i32>(n);
    rs::i32 cursor = RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_META_LENGTH;
    for (std::size_t i = 0; i < n; i++) {
        outSample[cursor++] = model.verticesX[i];
        outSample[cursor++] = model.verticesY[i];
        outSample[cursor++] = model.verticesZ[i];
    }
    // Zero-fill remaining entries for stable debugging.
    for (; cursor < outSampleLength; cursor++) {
        outSample[cursor] = 0;
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_model_vertices_sample_range(
    const rs::i32 runtimeHandle,
    const rs::i32 modelId,
    const rs::i32 startVertex,
    rs::i32* outSample,
    const rs::i32 outSampleLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outSample || outSampleLength < RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    rs::Span<const rs::u8> modelBytes{};
    const rs::Status ms = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
        modelId,
        &modelBytes);
    if (!rs::ok(ms)) {
        return ms == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::ModelData model(alloc);
    const rs::Status ds = rs::decodeModelData(
        modelBytes,
        &model,
        alloc);
    if (!rs::ok(ds)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    std::size_t total = model.verticesX.size();
    if (model.verticesY.size() < total) total = model.verticesY.size();
    if (model.verticesZ.size() < total) total = model.verticesZ.size();

    std::size_t start = 0;
    if (startVertex > 0) {
        start = static_cast<std::size_t>(startVertex);
        if (start > total) start = total;
    }
    std::size_t n = (total > start) ? (total - start) : 0;
    if (n > static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS)) {
        n = static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS);
    }

    outSample[0] = model.version;
    outSample[1] = model.verticesCount;
    outSample[2] = model.usedVertexCount;
    outSample[3] = model.faceCount;
    outSample[4] = static_cast<rs::i32>(n);
    rs::i32 cursor = RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_META_LENGTH;
    for (std::size_t i = 0; i < n; i++) {
        const std::size_t vi = start + i;
        outSample[cursor++] = model.verticesX[vi];
        outSample[cursor++] = model.verticesY[vi];
        outSample[cursor++] = model.verticesZ[vi];
    }
    // Zero-fill remaining entries for stable debugging.
    for (; cursor < outSampleLength; cursor++) {
        outSample[cursor] = 0;
    }
    return RS_MAP_RENDER_STATUS_OK;
}

// [version, textureFaceCount, texFaceIndex, renderType, mapP, mapM, mapN,
//  scaleX, scaleY, scaleZ, rotation, direction, speed, transU, transV, reserved]
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MODEL_TEX_FACE_PARAMS_LENGTH = 16;

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_model_texture_face_params(
    const rs::i32 runtimeHandle,
    const rs::i32 modelId,
    const rs::i32 texFaceIndex,
    rs::i32* outParams,
    const rs::i32 outParamsLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outParams || outParamsLength < RS_MAP_RENDER_RUNTIME_MODEL_TEX_FACE_PARAMS_LENGTH ||
        modelId < 0 || texFaceIndex < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    rs::Span<const rs::u8> modelBytes{};
    const rs::Status ms = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
        modelId,
        &modelBytes);
    if (!rs::ok(ms)) {
        return ms == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::ModelData model(alloc);
    const rs::Status ds = rs::decodeModelData(
        modelBytes,
        &model,
        alloc);
    if (!rs::ok(ds)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    const rs::i32 tfc = model.textureFaceCount;
    if (texFaceIndex < 0 || texFaceIndex >= tfc) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    const std::size_t ti = static_cast<std::size_t>(texFaceIndex);

    const auto getI32 = [&](const rs::Vec<rs::i32>& v) -> rs::i32 {
        return ti < v.size() ? v[ti] : 0;
    };
    const auto getI16 = [&](const rs::Vec<rs::i16>& v) -> rs::i32 {
        return ti < v.size() ? static_cast<rs::i32>(v[ti]) : 0;
    };
    const auto getI8 = [&](const rs::Vec<rs::i8>& v) -> rs::i32 {
        return ti < v.size() ? static_cast<rs::i32>(v[ti]) : 0;
    };

    outParams[0] = model.version;
    outParams[1] = tfc;
    outParams[2] = texFaceIndex;
    outParams[3] = getI8(model.textureRenderTypes) & 0xff;
    outParams[4] = static_cast<rs::i32>(static_cast<rs::u16>(getI16(model.textureMappingP)));
    outParams[5] = static_cast<rs::i32>(static_cast<rs::u16>(getI16(model.textureMappingM)));
    outParams[6] = static_cast<rs::i32>(static_cast<rs::u16>(getI16(model.textureMappingN)));
    outParams[7] = getI32(model.textureScaleX);
    outParams[8] = getI32(model.textureScaleY);
    outParams[9] = getI32(model.textureScaleZ);
    outParams[10] = getI8(model.textureRotation) & 0xff;
    outParams[11] = getI8(model.textureDirection);
    outParams[12] = getI32(model.textureSpeed);
    outParams[13] = getI32(model.textureTransU);
    outParams[14] = getI32(model.textureTransV);
    outParams[15] = 0;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_loc_model_vertices_sample(
    const rs::i32 runtimeHandle,
    const rs::i32 locTypeId,
    const rs::i32 placementType,
    const rs::i32 rotation,
    const rs::i32 modelId,
    rs::i32* outSample,
    const rs::i32 outSampleLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outSample || outSampleLength < RS_MAP_RENDER_RUNTIME_LOC_MODEL_VERTICES_SAMPLE_LENGTH ||
        locTypeId < 0 || modelId < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::StringArena strings(alloc, 4096);

    rs::LocType base;
    const rs::Status baseStatus = decodeLocTypeFromTypeBlob(
        runtime,
        cacheInfo,
        locTypeId,
        &strings,
        alloc,
        &base);
    if (baseStatus == rs::Status::NotFound) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!rs::ok(baseStatus)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    auto getVarpValue = [&runtime](const rs::i32 varpId) -> rs::i32 {
        if (varpId < 0 || static_cast<std::size_t>(varpId) >= runtime->cache.varps.size()) {
            return 0;
        }
        return runtime->cache.varps[static_cast<std::size_t>(varpId)];
    };
    auto getVarbitValue = [&runtime, &cacheInfo, &getVarpValue](const rs::i32 varbitId) -> rs::i32 {
        if (varbitId < 0) {
            return 0;
        }
        rs::Span<const rs::u8> bytes{};
        const rs::Status ss = getTypeEntrySpanForDeps(
            runtime,
            RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_VARBIT,
            varbitId,
            &bytes);
        if (!rs::ok(ss)) {
            return 0;
        }
        rs::VarBitType varbit(varbitId, cacheInfo);
        rs::Uint8ArrayReader reader(
            bytes,
            0);
        rs::TypeDecodeError err{};
        const rs::Status ds = rs::decodeType(varbit, reader, &err, nullptr);
        if (!rs::ok(ds)) {
            return 0;
        }
        const rs::i32 value = getVarpValue(varbit.baseVar);
        const rs::i32 bitCount = varbit.endBit - varbit.startBit + 1;
        if (bitCount <= 0 || bitCount > 31) {
            return 0;
        }
        const rs::i32 mask = (1 << bitCount) - 1;
        return (value >> varbit.startBit) & mask;
    };

    rs::i32 transformIndex = -1;
    if (base.transformVarbit != -1) {
        transformIndex = getVarbitValue(base.transformVarbit);
    } else if (base.transformVarp != -1) {
        transformIndex = getVarpValue(base.transformVarp);
    }
    const rs::i32 transformId = base.resolveTransformId(transformIndex);

    const rs::LocType* resolved = &base;
    rs::LocType transformed;
    if (transformId != -1 && transformId != base.id) {
        const rs::Status transformedStatus = decodeLocTypeFromTypeBlob(
            runtime,
            cacheInfo,
            transformId,
            &strings,
            alloc,
            &transformed);
        if (rs::ok(transformedStatus)) {
            resolved = &transformed;
        }
    }

    // Decode raw model bytes.
    rs::ModelData model(alloc);
    {
        rs::Span<const rs::u8> modelBytes{};
        const rs::Status ms = getTypeEntrySpanForDeps(
            runtime,
            RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
            modelId,
            &modelBytes);
        if (rs::ok(ms)) {
            const rs::Status ds = rs::decodeModelData(modelBytes, &model, alloc);
            if (!rs::ok(ds)) {
                return RS_MAP_RENDER_STATUS_STATE;
            }
        } else {
            const rs::Status ls = runtimeTryLoadLegacyModelFromRuntimeCtx(runtime, modelId, &model, alloc);
            if (!rs::ok(ls)) {
                return RS_MAP_RENDER_STATUS_NOT_FOUND;
            }
        }
    }

    // Apply the same TS-style loc model mutations used by the runtime path.
    const bool mirrored =
        resolved->isRotated ||
        (placementType == 2 && rotation > 3); // WALL_CORNER
    if (mirrored) {
        model.mirror();
    }

    if (placementType == 4 && rotation > 3) { // WALL_DECORATION_INSIDE
        model.rotate(256);
        model.translate(45, 0, -45);
    }

    const rs::i32 sceneRot = rotation & 3;
    if (sceneRot == 1) {
        model.rotate90();
    } else if (sceneRot == 2) {
        model.rotate180();
    } else if (sceneRot == 3) {
        model.rotate270();
    }

    for (std::size_t i = 0; i < resolved->recolorFrom.size(); i++) {
        const rs::i32 from = resolved->recolorFrom[i];
        const rs::i32 to = i < resolved->recolorTo.size() ? resolved->recolorTo[i] : from;
        model.recolor(from, to);
        const bool recolorAsRetexture =
            resolved->cacheInfo.game == rs::GameType::Runescape && resolved->cacheInfo.revision <= 377;
        if (recolorAsRetexture) {
            model.retexture(from, to);
        }
    }
    for (std::size_t i = 0; i < resolved->retextureFrom.size(); i++) {
        const rs::i32 from = resolved->retextureFrom[i];
        const rs::i32 to = i < resolved->retextureTo.size() ? resolved->retextureTo[i] : from;
        model.retexture(from, to);
    }
    if (resolved->modelSizeX != 128 ||
        resolved->modelSizeHeight != 128 ||
        resolved->modelSizeY != 128) {
        model.resize(resolved->modelSizeX, resolved->modelSizeHeight, resolved->modelSizeY);
    }
    if (resolved->offsetX != 0 || resolved->offsetHeight != 0 || resolved->offsetY != 0) {
        model.translate(resolved->offsetX, resolved->offsetHeight, resolved->offsetY);
    }
    if (placementType == 10 && rotation > 3) { // NORMAL diagonal variant
        model.rotate(256);
    }

    std::size_t n = model.verticesX.size();
    if (model.verticesY.size() < n) n = model.verticesY.size();
    if (model.verticesZ.size() < n) n = model.verticesZ.size();
    if (n > static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS)) {
        n = static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS);
    }

    outSample[0] = model.version;
    outSample[1] = model.verticesCount;
    outSample[2] = model.usedVertexCount;
    outSample[3] = model.faceCount;
    outSample[4] = static_cast<rs::i32>(n);
    rs::i32 cursor = RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_META_LENGTH;
    for (std::size_t i = 0; i < n; i++) {
        outSample[cursor++] = model.verticesX[i];
        outSample[cursor++] = model.verticesY[i];
        outSample[cursor++] = model.verticesZ[i];
    }
    for (; cursor < outSampleLength; cursor++) {
        outSample[cursor] = 0;
    }
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_loc_variant_model_vertices_digest(
    const rs::i32 runtimeHandle,
    const rs::i32 locTypeId,
    const rs::i32 placementType,
    const rs::i32 rotation,
    rs::i32* outDigest,
    const rs::i32 outDigestLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outDigest || outDigestLength < RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_DIGEST_LENGTH ||
        locTypeId < 0 || placementType < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::StringArena strings(alloc, 4096);

    rs::LocType base;
    const rs::Status baseStatus = decodeLocTypeFromTypeBlob(
        runtime,
        cacheInfo,
        locTypeId,
        &strings,
        alloc,
        &base);
    if (baseStatus == rs::Status::NotFound) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!rs::ok(baseStatus)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    auto getVarpValue = [&runtime](const rs::i32 varpId) -> rs::i32 {
        if (varpId < 0 || static_cast<std::size_t>(varpId) >= runtime->cache.varps.size()) {
            return 0;
        }
        return runtime->cache.varps[static_cast<std::size_t>(varpId)];
    };
    auto getVarbitValue = [&runtime, &cacheInfo, &getVarpValue](const rs::i32 varbitId) -> rs::i32 {
        if (varbitId < 0) {
            return 0;
        }
        rs::Span<const rs::u8> bytes{};
        const rs::Status ss = getTypeEntrySpanForDeps(
            runtime,
            RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_VARBIT,
            varbitId,
            &bytes);
        if (!rs::ok(ss)) {
            return 0;
        }
        rs::VarBitType varbit(varbitId, cacheInfo);
        rs::Uint8ArrayReader reader(bytes, 0);
        rs::TypeDecodeError err{};
        const rs::Status ds = rs::decodeType(varbit, reader, &err, nullptr);
        if (!rs::ok(ds)) {
            return 0;
        }
        const rs::i32 value = getVarpValue(varbit.baseVar);
        const rs::i32 bitCount = varbit.endBit - varbit.startBit + 1;
        if (bitCount <= 0 || bitCount > 31) {
            return 0;
        }
        const rs::i32 mask = (1 << bitCount) - 1;
        return (value >> varbit.startBit) & mask;
    };

    rs::i32 transformIndex = -1;
    if (base.transformVarbit != -1) {
        transformIndex = getVarbitValue(base.transformVarbit);
    } else if (base.transformVarp != -1) {
        transformIndex = getVarpValue(base.transformVarp);
    }
    const rs::i32 transformId = base.resolveTransformId(transformIndex);

    const rs::LocType* resolved = &base;
    rs::LocType transformed;
    if (transformId != -1 && transformId != base.id) {
        const rs::Status transformedStatus = decodeLocTypeFromTypeBlob(
            runtime,
            cacheInfo,
            transformId,
            &strings,
            alloc,
            &transformed);
        if (rs::ok(transformedStatus)) {
            resolved = &transformed;
        }
    }

    // Resolve the model-id group for this placement type (matches TS LocModelLoader.getLocModelData).
    const rs::Vec<rs::i32>* group = nullptr;
    if (resolved->models.empty()) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (resolved->types.empty()) {
        if (placementType != 10) { // NORMAL
            return RS_MAP_RENDER_STATUS_NOT_FOUND;
        }
        group = &resolved->models[0];
    } else {
        for (std::size_t i = 0; i < resolved->types.size(); i++) {
            if (resolved->types[i] == placementType) {
                if (i < resolved->models.size()) {
                    group = &resolved->models[i];
                }
                break;
            }
        }
    }
    if (!group || group->empty()) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }

    // Decode + mirror per source model before merge.
    rs::Vec<rs::ModelData> parts(alloc);
    auto rrReserve = parts.reserve(group->size());
    if (!rrReserve.isOk()) {
        return RS_MAP_RENDER_STATUS_STATE;
    }
    const bool mirrored =
        resolved->isRotated ||
        (placementType == 2 && rotation > 3); // WALL_CORNER
    for (std::size_t i = 0; i < group->size(); i++) {
        const rs::i32 modelId = (*group)[i];
        rs::ModelData model(alloc);
        rs::Span<const rs::u8> modelBytes{};
        const rs::Status ms = getTypeEntrySpanForDeps(
            runtime,
            RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
            modelId,
            &modelBytes);
        if (rs::ok(ms)) {
            const rs::Status ds = rs::decodeModelData(modelBytes, &model, alloc);
            if (!rs::ok(ds)) {
                return RS_MAP_RENDER_STATUS_STATE;
            }
        } else {
            const rs::Status ls = runtimeTryLoadLegacyModelFromRuntimeCtx(runtime, modelId, &model, alloc);
            if (!rs::ok(ls)) {
                return RS_MAP_RENDER_STATUS_NOT_FOUND;
            }
        }
        if (mirrored) {
            model.mirror();
        }
        auto rr = parts.pushBack(rs::move(model));
        if (!rr.isOk()) {
            return RS_MAP_RENDER_STATUS_STATE;
        }
    }

    rs::ModelData merged(alloc);
    if (parts.size() == 1) {
        merged = rs::move(parts[0]);
    } else {
        const rs::Status ms = rs::mergeModelDataTS(
            rs::Span<const rs::ModelData>(parts.data(), parts.size()),
            static_cast<rs::i32>(parts.size()),
            &merged,
            alloc);
        if (!rs::ok(ms)) {
            return RS_MAP_RENDER_STATUS_STATE;
        }
    }

    // Post-merge mutations.
    if (placementType == 4 && rotation > 3) { // WALL_DECORATION_INSIDE
        merged.rotate(256);
        merged.translate(45, 0, -45);
    }
    const rs::i32 sceneRot = rotation & 3;
    if (sceneRot == 1) {
        merged.rotate90();
    } else if (sceneRot == 2) {
        merged.rotate180();
    } else if (sceneRot == 3) {
        merged.rotate270();
    }
    for (std::size_t i = 0; i < resolved->recolorFrom.size(); i++) {
        const rs::i32 from = resolved->recolorFrom[i];
        const rs::i32 to = i < resolved->recolorTo.size() ? resolved->recolorTo[i] : from;
        merged.recolor(from, to);
        const bool recolorAsRetexture =
            resolved->cacheInfo.game == rs::GameType::Runescape && resolved->cacheInfo.revision <= 377;
        if (recolorAsRetexture) {
            merged.retexture(from, to);
        }
    }
    for (std::size_t i = 0; i < resolved->retextureFrom.size(); i++) {
        const rs::i32 from = resolved->retextureFrom[i];
        const rs::i32 to = i < resolved->retextureTo.size() ? resolved->retextureTo[i] : from;
        merged.retexture(from, to);
    }
    if (resolved->modelSizeX != 128 ||
        resolved->modelSizeHeight != 128 ||
        resolved->modelSizeY != 128) {
        merged.resize(resolved->modelSizeX, resolved->modelSizeHeight, resolved->modelSizeY);
    }
    if (resolved->offsetX != 0 || resolved->offsetHeight != 0 || resolved->offsetY != 0) {
        merged.translate(resolved->offsetX, resolved->offsetHeight, resolved->offsetY);
    }
    if (placementType == 10 && rotation > 3) { // NORMAL diagonal variant
        merged.rotate(256);
    }

    // TS-parity digest of merged model vertices (byte-wise FNV-1a over i32s).
    auto fnv1aMixI32 = [](rs::u32 h, rs::i32 v) noexcept -> rs::u32 {
        rs::u32 x = h;
        const rs::u32 uv = static_cast<rs::u32>(v);
        x ^= (uv & 0xffu);
        x *= 16777619u;
        x ^= ((uv >> 8) & 0xffu);
        x *= 16777619u;
        x ^= ((uv >> 16) & 0xffu);
        x *= 16777619u;
        x ^= ((uv >> 24) & 0xffu);
        x *= 16777619u;
        return x;
    };

    rs::u32 h = 2166136261u;
    h = fnv1aMixI32(h, merged.version);
    h = fnv1aMixI32(h, merged.verticesCount);
    h = fnv1aMixI32(h, merged.usedVertexCount);
    h = fnv1aMixI32(h, merged.faceCount);
    h = fnv1aMixI32(h, merged.textureFaceCount);
    std::size_t n = merged.verticesX.size();
    if (merged.verticesY.size() < n) n = merged.verticesY.size();
    if (merged.verticesZ.size() < n) n = merged.verticesZ.size();
    std::size_t target = n;
    if (merged.tsVerticesAllocCount > 0) {
        const std::size_t t = static_cast<std::size_t>(merged.tsVerticesAllocCount);
        if (t > target) target = t;
    }
    for (std::size_t i = 0; i < target; i++) {
        const rs::i32 x = i < n ? merged.verticesX[i] : 0;
        const rs::i32 y = i < n ? merged.verticesY[i] : 0;
        const rs::i32 z = i < n ? merged.verticesZ[i] : 0;
        h = fnv1aMixI32(h, x);
        h = fnv1aMixI32(h, y);
        h = fnv1aMixI32(h, z);
    }

    outDigest[0] = merged.verticesCount;
    outDigest[1] = merged.usedVertexCount;
    outDigest[2] = merged.faceCount;
    outDigest[3] = static_cast<rs::i32>(h);
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_pre_merge_group_key_signatures_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_LOC_PRE_MERGE_KEY_SIGNATURES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugLocPreMergeGroupKeySignatures.size());
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_loc_pre_merge_group_key_signatures(
    const rs::i32 runtimeHandle,
    rs::i32* outSignatures,
    const rs::i32 outSignaturesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugLocPreMergeGroupKeySignatures.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outSignatures || outSignaturesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outSignatures,
        stream.debugLocPreMergeGroupKeySignatures.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_pre_merge_group_key_entries_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_LOC_PRE_MERGE_KEY_ENTRIES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugLocPreMergeGroupKeyEntriesPacked.size());
    outMeta[1] = 17;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_loc_pre_merge_group_key_entries_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outEntries,
    const rs::i32 outEntriesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugLocPreMergeGroupKeyEntriesPacked.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outEntries || outEntriesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outEntries,
        stream.debugLocPreMergeGroupKeyEntriesPacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_merge_decision_entries_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_LOC_MERGE_DECISION_ENTRIES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugLocMergeDecisionEntriesPacked.size());
    outMeta[1] = 26;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_loc_merge_decision_entries_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outEntries,
    const rs::i32 outEntriesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugLocMergeDecisionEntriesPacked.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outEntries || outEntriesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outEntries,
        stream.debugLocMergeDecisionEntriesPacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_merge_emit_entries_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_LOC_MERGE_EMIT_ENTRIES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugLocMergeEmitEntriesPacked.size());
    outMeta[1] = 13;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_loc_merge_emit_entries_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outEntries,
    const rs::i32 outEntriesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugLocMergeEmitEntriesPacked.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outEntries || outEntriesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outEntries,
        stream.debugLocMergeEmitEntriesPacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_loc_merge_normals_trace_entries_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_LOC_MERGE_NORMALS_TRACE_ENTRIES_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugLocMergeNormalsTraceEntriesPacked.size());
    outMeta[1] = 22;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_loc_merge_normals_trace_entries_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outEntries,
    const rs::i32 outEntriesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugLocMergeNormalsTraceEntriesPacked.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outEntries || outEntriesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outEntries,
        stream.debugLocMergeNormalsTraceEntriesPacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_command_provenance_meta(
    const rs::i32 runtimeHandle,
    rs::i32* outMeta,
    const rs::i32 outMetaLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outMeta ||
        outMetaLength < RS_MAP_RENDER_RUNTIME_COMMAND_PROVENANCE_META_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    outMeta[0] = static_cast<rs::i32>(stream.debugCommandProvenancePacked.size());
    outMeta[1] = 12;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_copy_last_command_provenance_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outEntries,
    const rs::i32 outEntriesLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stream = runtime->lastBuiltCommandStream;
    const rs::i32 len = static_cast<rs::i32>(stream.debugCommandProvenancePacked.size());
    if (len <= 0) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!outEntries || outEntriesLength != len) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    std::memcpy(
        outEntries,
        stream.debugCommandProvenancePacked.data(),
        static_cast<std::size_t>(len) * sizeof(rs::i32));
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_get_last_build_stats(
    const rs::i32 runtimeHandle,
    rs::i32* outStats,
    const rs::i32 outStatsLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outStats || outStatsLength < RS_MAP_RENDER_RUNTIME_BUILD_DEBUG_STATS_LENGTH) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->lastBuiltCommandStream.loaded) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    const MapRenderCachedCommandStream& stats = runtime->lastBuiltCommandStream;
    outStats[0] = stats.debugTerrainTilesConsidered;
    outStats[1] = stats.debugTerrainTilesEmitted;
    outStats[2] = stats.debugTerrainFacesEmitted;
    outStats[3] = stats.debugLocPlacementsDecoded;
    outStats[4] = stats.debugLocPlacementsInBounds;
    outStats[5] = stats.debugLocPlacementsResolved;
    outStats[6] = stats.debugLocResolveNotFound;
    outStats[7] = stats.debugLocNoModelsForPlacement;
    outStats[8] = stats.debugLocModelCandidates;
    outStats[9] = stats.debugLocModelStatsDecodeFailed;
    outStats[10] = stats.debugLocModelStatsNotFound;
    outStats[11] = stats.debugLocModelStatsOtherError;
    outStats[12] = stats.debugLocMissingModelSampleCount;
    outStats[13] = stats.debugLocMissingModelSample0;
    outStats[14] = stats.debugLocMissingModelSample1;
    outStats[15] = stats.debugLocMissingModelSample2;
    outStats[16] = stats.debugLocMissingModelSample3;
    outStats[17] = stats.debugLocMissingModelLocTypeId;
    outStats[18] = stats.debugLocMissingModelPlacementType;
    outStats[19] = stats.debugLocMissingModelRotation;
    outStats[20] = stats.debugLocModelStatsZeroFaces;
    outStats[21] = stats.debugLocGroupStatsMismatch;
    outStats[22] = stats.debugLocPlacementsQueuedAnyModel;
    outStats[23] = stats.debugLocInstancesQueued;
    outStats[24] = stats.debugLocAnimatedNoFaces;
    outStats[25] = stats.debugLocAnimatedQueued;
    outStats[26] = stats.debugObjSpawnsDecoded;
    outStats[27] = stats.debugObjSpawnsInBounds;
    outStats[28] = stats.debugObjModelCandidates;
    outStats[29] = stats.debugObjInstancesQueued;
    outStats[30] = stats.debugLocMergeByPlacementCount;
    outStats[31] = stats.debugLocInstancedGroupCount;
    outStats[32] = stats.debugLocVariantGroupsQueued;
    outStats[33] = stats.debugLocVariantGroupsHash;
    outStats[34] = stats.debugLocVariantType9Queued;
    outStats[35] = stats.debugLocVariantType0Queued;
    outStats[36] = stats.debugLocVariantId1651Type9Queued;
    outStats[37] = stats.debugLocVariantId1651Type0Queued;
    outStats[38] = stats.debugObjMergeByPlacementCount;
    outStats[39] = stats.debugObjInstancedGroupCount;
    outStats[40] = stats.debugTerrainFacesUnderlayLevel0;
    outStats[41] = stats.debugTerrainFacesUnderlayLevel1;
    outStats[42] = stats.debugTerrainFacesUnderlayLevel2;
    outStats[43] = stats.debugTerrainFacesUnderlayLevel3;
    outStats[44] = stats.debugTerrainFacesOverlayLevel0;
    outStats[45] = stats.debugTerrainFacesOverlayLevel1;
    outStats[46] = stats.debugTerrainFacesOverlayLevel2;
    outStats[47] = stats.debugTerrainFacesOverlayLevel3;
    outStats[48] = stats.debugLocMergedDummyCommandCount;
    outStats[49] = stats.debugLocMergedDummyElementsTotal;
    outStats[50] = stats.debugLocMergedDummyHash;
    outStats[51] = stats.debugLocMergedDummyBaseCount;
    outStats[52] = stats.debugLocMergedDummyAlphaCount;
    outStats[53] = stats.debugLocMergedDummyLodCount;
    outStats[54] = stats.debugLocMergedDummyLodAlphaCount;
    outStats[55] = stats.debugGeometryElementMismatchCount;
    outStats[56] = stats.debugGeometryElementMismatchTotalDelta;
    outStats[57] = stats.debugGeometryElementMismatchMaxDelta;
    outStats[58] = stats.debugGeometryElementMismatchSampleTypeId;
    outStats[59] = stats.debugGeometryElementMismatchSamplePlacementType;
    outStats[60] = stats.debugGeometryElementMismatchSampleRotation;
    outStats[61] = stats.debugLocPreMergeGroupKeysQueued;
    outStats[62] = stats.debugLocPreMergeGroupKeysHash;
    outStats[63] = stats.debugLocVariantCandidatesExpanded;
    outStats[64] = stats.debugLocVariantDecodeFailed;
    return RS_MAP_RENDER_STATUS_OK;
}

static constexpr rs::i32 RS_MAP_RENDER_DEBUG_OVERLAY_TYPE_FIELDS = 12;
static constexpr rs::i32 RS_MAP_RENDER_DEBUG_LOC_TYPE_FIELDS = 56;

static rs::Status decodeLocTypeFromTypeBlob(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 locTypeId,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    rs::LocType* outType) {
    if (!strings || !outType || locTypeId < 0) {
        return rs::Status::InvalidArgument;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_LOC,
        locTypeId,
        &bytes);
    if (!rs::ok(ss)) {
        return ss;
    }

    *outType = rs::LocType(locTypeId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    rs::TypeDecodeContext ctx{cacheInfo, strings, &alloc};
    const rs::Status ds = rs::decodeType(*outType, reader, &err, &ctx);
    if (!rs::ok(ds)) {
        return ds;
    }
    outType->post();
    return rs::Status::Ok;
}

static rs::i32 countLocTypeModelIds(const rs::LocType& locType) {
    rs::i32 total = 0;
    for (std::size_t i = 0; i < locType.models.size(); i++) {
        total += static_cast<rs::i32>(locType.models[i].size());
    }
    return total;
}

static rs::i32 firstLocTypeModelId(const rs::LocType& locType) {
    for (std::size_t i = 0; i < locType.models.size(); i++) {
        if (!locType.models[i].empty()) {
            return locType.models[i][0];
        }
    }
    return -1;
}

static rs::i32 firstLocTypePlacementType(const rs::LocType& locType) {
    if (!locType.hasTypes || locType.types.empty()) {
        return -1;
    }
    return locType.types[0];
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_decode_overlay_type(
    const rs::i32 runtimeHandle,
    const rs::i32 overlayId,
    rs::i32* outFields,
    const rs::i32 outFieldsLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outFields || outFieldsLength < RS_MAP_RENDER_DEBUG_OVERLAY_TYPE_FIELDS || overlayId < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY,
        overlayId,
        &bytes);
    if (!rs::ok(ss)) {
        return ss == rs::Status::NotFound ? RS_MAP_RENDER_STATUS_NOT_FOUND : RS_MAP_RENDER_STATUS_STATE;
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;

    rs::OverlayFloorType type(overlayId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::TypeDecodeContext ctx{cacheInfo, nullptr, &alloc};
    const rs::Status ds = rs::decodeType(type, reader, &err, &ctx);
    if (!rs::ok(ds)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }
    type.post();

    outFields[0] = type.primaryRgb;
    outFields[1] = type.primaryHsl;
    outFields[2] = type.textureId;
    outFields[3] = type.secondaryTextureId;
    outFields[4] = type.blendRgb;
    outFields[5] = type.blendHsl;
    outFields[6] = type.blendable ? 1 : 0;
    outFields[7] = type.blendPriority;
    outFields[8] = type.hideUnderlay ? 1 : 0;
    outFields[9] = type.occludes ? 1 : 0;
    outFields[10] = type.textureSize;
    outFields[11] = type.blockShadow ? 1 : 0;
    return RS_MAP_RENDER_STATUS_OK;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_debug_decode_loc_type(
    const rs::i32 runtimeHandle,
    const rs::i32 locTypeId,
    rs::i32* outFields,
    const rs::i32 outFieldsLength) {
    const MapRenderRuntimeState* runtime = getMapRenderRuntimeConst(runtimeHandle);
    if (!runtime || !outFields || outFieldsLength < RS_MAP_RENDER_DEBUG_LOC_TYPE_FIELDS || locTypeId < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::StringArena strings(alloc, 4096);

    rs::LocType base;
    const rs::Status baseStatus = decodeLocTypeFromTypeBlob(
        runtime,
        cacheInfo,
        locTypeId,
        &strings,
        alloc,
        &base);
    if (baseStatus == rs::Status::NotFound) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    if (!rs::ok(baseStatus)) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    auto getVarpValue = [&runtime](const rs::i32 varpId) -> rs::i32 {
        if (varpId < 0 || static_cast<std::size_t>(varpId) >= runtime->cache.varps.size()) {
            return 0;
        }
        return runtime->cache.varps[static_cast<std::size_t>(varpId)];
    };
    auto getVarbitValue = [&runtime, &cacheInfo, &getVarpValue](const rs::i32 varbitId) -> rs::i32 {
        if (varbitId < 0) {
            return 0;
        }
        rs::Span<const rs::u8> bytes{};
        const rs::Status ss = getTypeEntrySpanForDeps(
            runtime,
            RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_VARBIT,
            varbitId,
            &bytes);
        if (!rs::ok(ss)) {
            return 0;
        }
        rs::VarBitType varbit(varbitId, cacheInfo);
        rs::Uint8ArrayReader reader(
            bytes,
            0);
        rs::TypeDecodeError err{};
        const rs::Status ds = rs::decodeType(varbit, reader, &err, nullptr);
        if (!rs::ok(ds)) {
            return 0;
        }
        const rs::i32 value = getVarpValue(varbit.baseVar);
        const rs::i32 bitCount = varbit.endBit - varbit.startBit + 1;
        if (bitCount <= 0 || bitCount > 31) {
            return 0;
        }
        const rs::i32 mask = (1 << bitCount) - 1;
        return (value >> varbit.startBit) & mask;
    };

    rs::i32 transformIndex = -1;
    if (base.transformVarbit != -1) {
        transformIndex = getVarbitValue(base.transformVarbit);
    } else if (base.transformVarp != -1) {
        transformIndex = getVarpValue(base.transformVarp);
    }
    const rs::i32 transformId = base.resolveTransformId(transformIndex);

    const rs::LocType* resolved = &base;
    rs::LocType transformed;
    bool resolvedFromTransform = false;
    if (transformId != -1 && transformId != base.id) {
        const rs::Status transformedStatus = decodeLocTypeFromTypeBlob(
            runtime,
            cacheInfo,
            transformId,
            &strings,
            alloc,
            &transformed);
        if (rs::ok(transformedStatus)) {
            resolved = &transformed;
            resolvedFromTransform = true;
        }
    }

    outFields[0] = base.id;
    outFields[1] = resolved->id;
    outFields[2] = base.mergeNormals ? 1 : 0;
    outFields[3] = resolved->mergeNormals ? 1 : 0;
    outFields[4] = base.contourGroundType;
    outFields[5] = resolved->contourGroundType;
    outFields[6] = base.contouredGround;
    outFields[7] = resolved->contouredGround;
    outFields[8] = base.contourGroundParam;
    outFields[9] = resolved->contourGroundParam;
    outFields[10] = base.hasTypes ? 1 : 0;
    outFields[11] = resolved->hasTypes ? 1 : 0;
    outFields[12] = static_cast<rs::i32>(base.types.size());
    outFields[13] = static_cast<rs::i32>(resolved->types.size());
    outFields[14] = static_cast<rs::i32>(base.models.size());
    outFields[15] = static_cast<rs::i32>(resolved->models.size());
    outFields[16] = countLocTypeModelIds(base);
    outFields[17] = countLocTypeModelIds(*resolved);
    outFields[18] = firstLocTypePlacementType(base);
    outFields[19] = firstLocTypePlacementType(*resolved);
    outFields[20] = firstLocTypeModelId(base);
    outFields[21] = firstLocTypeModelId(*resolved);
    outFields[22] = static_cast<rs::i32>(base.transforms.size());
    outFields[23] = base.transformVarbit;
    outFields[24] = base.transformVarp;
    outFields[25] = transformIndex;
    outFields[26] = transformId;
    outFields[27] = resolvedFromTransform ? 1 : 0;
    outFields[28] = base.decorDisplacement;
    outFields[29] = resolved->decorDisplacement;
    outFields[30] = base.ambient;
    outFields[31] = base.contrast;
    outFields[32] = resolved->ambient;
    outFields[33] = resolved->contrast;
    // Additional structural/model mutation fields for debugging TS parity.
    outFields[34] = base.isRotated ? 1 : 0;
    outFields[35] = resolved->isRotated ? 1 : 0;
    outFields[36] = base.clipped ? 1 : 0;
    outFields[37] = resolved->clipped ? 1 : 0;
    outFields[38] = base.sizeX;
    outFields[39] = base.sizeY;
    outFields[40] = resolved->sizeX;
    outFields[41] = resolved->sizeY;
    outFields[42] = base.modelSizeX;
    outFields[43] = base.modelSizeHeight;
    outFields[44] = base.modelSizeY;
    outFields[45] = resolved->modelSizeX;
    outFields[46] = resolved->modelSizeHeight;
    outFields[47] = resolved->modelSizeY;
    outFields[48] = base.offsetX;
    outFields[49] = base.offsetHeight;
    outFields[50] = base.offsetY;
    outFields[51] = resolved->offsetX;
    outFields[52] = resolved->offsetHeight;
    outFields[53] = resolved->offsetY;
    outFields[54] = base.seqId;
    outFields[55] = resolved->seqId;
    return RS_MAP_RENDER_STATUS_OK;
}
