// Debug/parity helpers for the map-render wasm backend.
//
// This module intentionally contains the debug-only JS glue so runtime imports do not
// pull debug code into the app bundle.

import { tryLoadBackendModule } from "./rs_map_render_backend_bridge.mjs";

export { tryLoadBackendModule };

const RUNTIME_STATUS_OK = 1;
const RUNTIME_BUILD_DEBUG_STATS_LENGTH = 65;

function mallocI32(backendModule, length) {
    const count = length | 0;
    if (count <= 0) {
        return 0;
    }
    const ptr = backendModule._malloc(count * 4);
    if (!ptr) {
        return 0;
    }
    return ptr;
}

function getRuntimeDebugCollectMapInputDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_collect_map_input_digest;
}

function getRuntimeDebugGetCacheConfigExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_cache_config;
}

function getRuntimeDebugGetLoadedHeightHashExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_loaded_height_hash;
}

function getRuntimeDebugGetLastMapInputHashesExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_map_input_hashes;
}

function getRuntimeDebugGetLastBuildStatsExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_build_stats;
}

function getRuntimeDebugDecodeOverlayTypeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_decode_overlay_type;
}

function getRuntimeDebugDecodeLocTypeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_decode_loc_type;
}

function getRuntimeDebugGetLastTerrainTileFaceCountsMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_terrain_tile_face_counts_meta;
}

function getRuntimeDebugCopyLastTerrainTileFaceCountsExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_terrain_tile_face_counts;
}

function getRuntimeDebugGetLastTerrainDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_terrain_digest;
}

function getRuntimeDebugSetTerrainDigestSampleStartVertexExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_set_terrain_digest_sample_start_vertex;
}

function getRuntimeDebugSetTerrainProbeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_set_terrain_probe;
}

function getRuntimeDebugGetLastTerrainProbeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_terrain_probe;
}

function getRuntimeDebugDecodeCachedTerrainCellExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_decode_cached_terrain_cell;
}

function getRuntimeDebugSetWorldHeightProbeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_set_world_height_probe;
}

function getRuntimeDebugGetLastWorldHeightProbeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_world_height_probe;
}

function getRuntimeDebugGetLastTerrainDigestSamplesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_terrain_digest_samples_meta;
}

function getRuntimeDebugCopyLastTerrainDigestSamplesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_terrain_digest_samples_packed;
}

function getRuntimeDebugGetLastSceneCommandPlanDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_scene_command_plan_digest;
}

function getRuntimeDebugGetLastSceneCommandPlanOpsPackedMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_scene_command_plan_ops_packed_meta;
}

function getRuntimeDebugCopyLastSceneCommandPlanOpsPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_scene_command_plan_ops_packed;
}

function getRuntimeDebugGetLastSceneCommandPlanOpProvenancePackedMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_scene_command_plan_op_provenance_packed_meta;
}

function getRuntimeDebugCopyLastSceneCommandPlanOpProvenancePackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_scene_command_plan_op_provenance_packed;
}

function getRuntimeDebugGetLastSceneBucketsDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_scene_buckets_digest;
}

function getRuntimeDebugGetLastLocRenderPlacementDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_render_placement_digest;
}

function getRuntimeDebugGetLastLocRenderPlacementEntriesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_render_placement_entries_meta;
}

function getRuntimeDebugCopyLastLocRenderPlacementEntriesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_loc_render_placement_entries_packed;
}

function getRuntimeDebugGetModelFacesDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_model_faces_digest;
}

function getRuntimeDebugGetModelVerticesDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_model_vertices_digest;
}

function getRuntimeDebugGetModelVerticesSampleExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_model_vertices_sample;
}

function getRuntimeDebugGetModelVerticesSampleRangeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_model_vertices_sample_range;
}

function getRuntimeDebugGetLocModelVerticesSampleExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_loc_model_vertices_sample;
}

function getRuntimeDebugGetLastLocPreMergeGroupKeySignaturesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_pre_merge_group_key_signatures_meta;
}

function getRuntimeDebugCopyLastLocPreMergeGroupKeySignaturesExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_loc_pre_merge_group_key_signatures;
}

function getRuntimeDebugGetLastLocPreMergeGroupKeyEntriesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_pre_merge_group_key_entries_meta;
}

function getRuntimeDebugCopyLastLocPreMergeGroupKeyEntriesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_loc_pre_merge_group_key_entries_packed;
}

function getRuntimeDebugGetLastLocMergeDecisionEntriesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_merge_decision_entries_meta;
}

function getRuntimeDebugCopyLastLocMergeDecisionEntriesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_loc_merge_decision_entries_packed;
}

function getRuntimeDebugGetLastLocMergeEmitEntriesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_merge_emit_entries_meta;
}

function getRuntimeDebugCopyLastLocMergeEmitEntriesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_loc_merge_emit_entries_packed;
}

function getRuntimeDebugGetLastLocMergeNormalsTraceEntriesMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_loc_merge_normals_trace_entries_meta;
}

function getRuntimeDebugCopyLastLocMergeNormalsTraceEntriesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_loc_merge_normals_trace_entries_packed;
}

function getRuntimeDebugGetLastCommandProvenanceMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_command_provenance_meta;
}

function getRuntimeDebugCopyLastCommandProvenancePackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_command_provenance_packed;
}

function getRuntimeDebugGetCachedCommandStreamDigestExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_cached_command_stream_digest;
}
function getRuntimeDebugGetCachedCommandStreamLengthsExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_cached_command_stream_lengths;
}

function getRuntimeDebugCopyCachedCommandStreamExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_cached_command_stream;
}

function getRuntimeDebugBuildMapPlanFromCacheExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_build_map_plan_from_cache;
}


export function runtimeDebugCollectMapInputDigestWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    const collectDigest = getRuntimeDebugCollectMapInputDigestExport(backendModule);
    if (typeof collectDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 8);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = collectDigest(
            runtimeHandle | 0,
            sceneBuildInput?.baseX | 0,
            sceneBuildInput?.baseY | 0,
            sceneBuildInput?.sizeX | 0,
            sceneBuildInput?.sizeY | 0,
            outPtr,
            8,
        ) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const digest = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 8);
        return {
            mapCount: digest[0] | 0,
            terrainBytesLength: digest[1] | 0,
            locBytesLength: digest[2] | 0,
            mapSquareIdsHash: digest[3] | 0,
            terrainOffsetsHash: digest[4] | 0,
            terrainLengthsHash: digest[5] | 0,
            terrainBytesHash: digest[6] | 0,
            locBytesHash: digest[7] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetCacheConfigWithWasm(backendModule, runtimeHandle) {
    const getCacheConfig = getRuntimeDebugGetCacheConfigExport(backendModule);
    if (typeof getCacheConfig !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 4);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getCacheConfig(runtimeHandle | 0, outPtr, 4) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const config = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 4);
        return {
            cacheGame: config[0] | 0,
            cacheRevision: config[1] | 0,
            sceneLevels: config[2] | 0,
            unitsTileHeightBasis: config[3] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLoadedHeightHashWithWasm(backendModule, runtimeHandle) {
    const getLoadedHeightHash = getRuntimeDebugGetLoadedHeightHashExport(backendModule);
    if (typeof getLoadedHeightHash !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 1);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getLoadedHeightHash(runtimeHandle | 0, outPtr) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        return backendModule.HEAP32[outPtr >> 2] | 0;
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastMapInputHashesWithWasm(backendModule, runtimeHandle) {
    const getLastMapInputHashes = getRuntimeDebugGetLastMapInputHashesExport(backendModule);
    if (typeof getLastMapInputHashes !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 3);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getLastMapInputHashes(runtimeHandle | 0, outPtr, 3) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const hashes = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 3);
        return {
            direct: hashes[0] | 0,
            cache: hashes[1] | 0,
            cacheScratchHeight: hashes[2] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetCachedCommandStreamArraysWithWasm(backendModule, runtimeHandle) {
    const getLengths = getRuntimeDebugGetCachedCommandStreamLengthsExport(backendModule);
    const copyStream = getRuntimeDebugCopyCachedCommandStreamExport(backendModule);
    if (typeof getLengths !== "function" || typeof copyStream !== "function") {
        return undefined;
    }

    const lengthsPtr = mallocI32(backendModule, 4);
    if (!lengthsPtr) {
        return undefined;
    }
    let cmdBucketPtr = 0;
    let cmdOffsetsPtr = 0;
    let cmdElementsPtr = 0;
    let cmdInstanceCountsPtr = 0;
    let cmdPackedInstancesPtr = 0;
    let verticesPtr = 0;
    let indicesPtr = 0;
    try {
        const lengthsStatus = getLengths(runtimeHandle | 0, lengthsPtr, 4) | 0;
        if (lengthsStatus !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const lengths = backendModule.HEAP32.slice(lengthsPtr >> 2, (lengthsPtr >> 2) + 4);
        const cmdCount = lengths[0] | 0;
        const packedCount = lengths[1] | 0;
        const verticesCount = lengths[2] | 0;
        const indicesCount = lengths[3] | 0;
        if (cmdCount < 0 || packedCount < 0 || verticesCount < 0 || indicesCount < 0) {
            return undefined;
        }

        cmdBucketPtr = mallocI32(backendModule, cmdCount) || 0;
        cmdOffsetsPtr = mallocI32(backendModule, cmdCount) || 0;
        cmdElementsPtr = mallocI32(backendModule, cmdCount) || 0;
        cmdInstanceCountsPtr = mallocI32(backendModule, cmdCount) || 0;
        cmdPackedInstancesPtr = mallocI32(backendModule, packedCount) || 0;
        verticesPtr = verticesCount > 0 ? backendModule._malloc(verticesCount) : 0;
        indicesPtr = mallocI32(backendModule, indicesCount) || 0;

        if ((cmdCount > 0 && (!cmdBucketPtr || !cmdOffsetsPtr || !cmdElementsPtr || !cmdInstanceCountsPtr)) ||
            (packedCount > 0 && !cmdPackedInstancesPtr) ||
            (verticesCount > 0 && !verticesPtr) ||
            (indicesCount > 0 && !indicesPtr)) {
            return undefined;
        }

        const copyStatus = copyStream(
            runtimeHandle | 0,
            cmdBucketPtr,
            cmdCount,
            cmdOffsetsPtr,
            cmdCount,
            cmdElementsPtr,
            cmdCount,
            cmdInstanceCountsPtr,
            cmdCount,
            cmdPackedInstancesPtr,
            packedCount,
            verticesPtr,
            verticesCount,
            indicesPtr,
            indicesCount,
        ) | 0;
        if (copyStatus !== RUNTIME_STATUS_OK) {
            return undefined;
        }

        const cmdBucketIndices =
            cmdCount > 0
                ? backendModule.HEAP32.slice(cmdBucketPtr >> 2, (cmdBucketPtr >> 2) + cmdCount)
                : new Int32Array(0);
        const cmdOffsets =
            cmdCount > 0
                ? backendModule.HEAP32.slice(cmdOffsetsPtr >> 2, (cmdOffsetsPtr >> 2) + cmdCount)
                : new Int32Array(0);
        const cmdElements =
            cmdCount > 0
                ? backendModule.HEAP32.slice(cmdElementsPtr >> 2, (cmdElementsPtr >> 2) + cmdCount)
                : new Int32Array(0);
        const cmdInstanceCounts =
            cmdCount > 0
                ? backendModule.HEAP32.slice(
                      cmdInstanceCountsPtr >> 2,
                      (cmdInstanceCountsPtr >> 2) + cmdCount,
                  )
                : new Int32Array(0);
        const cmdPackedInstances =
            packedCount > 0
                ? backendModule.HEAP32.slice(
                      cmdPackedInstancesPtr >> 2,
                      (cmdPackedInstancesPtr >> 2) + packedCount,
                  )
                : new Int32Array(0);
        const vertices =
            verticesCount > 0
                ? backendModule.HEAPU8.slice(verticesPtr, verticesPtr + verticesCount)
                : new Uint8Array(0);
        const indices =
            indicesCount > 0
                ? backendModule.HEAP32.slice(indicesPtr >> 2, (indicesPtr >> 2) + indicesCount)
                : new Int32Array(0);

        return {
            cmdBucketIndices,
            cmdOffsets,
            cmdElements,
            cmdInstanceCounts,
            cmdPackedInstances,
            vertices,
            indices,
        };
    } finally {
        if (lengthsPtr) backendModule._free(lengthsPtr);
        if (cmdBucketPtr) backendModule._free(cmdBucketPtr);
        if (cmdOffsetsPtr) backendModule._free(cmdOffsetsPtr);
        if (cmdElementsPtr) backendModule._free(cmdElementsPtr);
        if (cmdInstanceCountsPtr) backendModule._free(cmdInstanceCountsPtr);
        if (cmdPackedInstancesPtr) backendModule._free(cmdPackedInstancesPtr);
        if (verticesPtr) backendModule._free(verticesPtr);
        if (indicesPtr) backendModule._free(indicesPtr);
    }
}

export function runtimeDebugGetCachedCommandStreamDigestWithWasm(backendModule, runtimeHandle) {
    const getDigest = getRuntimeDebugGetCachedCommandStreamDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 16);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, outPtr, 16) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const digest = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 16);
        return {
            totalCmdCount: digest[0] | 0,
            cmdBucketIndicesHash: digest[1] | 0,
            cmdOffsetsHash: digest[2] | 0,
            cmdElementsHash: digest[3] | 0,
            cmdInstanceCountsHash: digest[4] | 0,
            cmdPackedInstancesHash: digest[5] | 0,
            verticesHash: digest[6] | 0,
            indicesHash: digest[7] | 0,
            bucketCmdCounts: Array.from(digest.slice(8, 16), (v) => v | 0),
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastBuildStatsWithWasm(backendModule, runtimeHandle) {
    const getLastBuildStats = getRuntimeDebugGetLastBuildStatsExport(backendModule);
    if (typeof getLastBuildStats !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, RUNTIME_BUILD_DEBUG_STATS_LENGTH);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getLastBuildStats(
            runtimeHandle | 0,
            outPtr,
            RUNTIME_BUILD_DEBUG_STATS_LENGTH,
        ) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const stats = backendModule.HEAP32.slice(
            outPtr >> 2,
            (outPtr >> 2) + RUNTIME_BUILD_DEBUG_STATS_LENGTH,
        );
        return {
            terrainTilesConsidered: stats[0] | 0,
            terrainTilesEmitted: stats[1] | 0,
            terrainFacesEmitted: stats[2] | 0,
            locPlacementsDecoded: stats[3] | 0,
            locPlacementsInBounds: stats[4] | 0,
            locPlacementsResolved: stats[5] | 0,
            locResolveNotFound: stats[6] | 0,
            locNoModelsForPlacement: stats[7] | 0,
            locModelCandidates: stats[8] | 0,
            locModelStatsDecodeFailed: stats[9] | 0,
            locModelStatsNotFound: stats[10] | 0,
            locModelStatsOtherError: stats[11] | 0,
            locMissingModelSampleCount: stats[12] | 0,
            locMissingModelSample0: stats[13] | 0,
            locMissingModelSample1: stats[14] | 0,
            locMissingModelSample2: stats[15] | 0,
            locMissingModelSample3: stats[16] | 0,
            locMissingModelLocTypeId: stats[17] | 0,
            locMissingModelPlacementType: stats[18] | 0,
            locMissingModelRotation: stats[19] | 0,
            locModelStatsZeroFaces: stats[20] | 0,
            locGroupStatsMismatch: stats[21] | 0,
            locPlacementsQueuedAnyModel: stats[22] | 0,
            locInstancesQueued: stats[23] | 0,
            locAnimatedNoFaces: stats[24] | 0,
            locAnimatedQueued: stats[25] | 0,
            objSpawnsDecoded: stats[26] | 0,
            objSpawnsInBounds: stats[27] | 0,
            objModelCandidates: stats[28] | 0,
            objInstancesQueued: stats[29] | 0,
            locMergeByPlacementCount: stats[30] | 0,
            locInstancedGroupCount: stats[31] | 0,
            locVariantGroupsQueued: stats[32] | 0,
            locVariantGroupsHash: stats[33] | 0,
            locVariantType9Queued: stats[34] | 0,
            locVariantType0Queued: stats[35] | 0,
            locVariantId1651Type9Queued: stats[36] | 0,
            locVariantId1651Type0Queued: stats[37] | 0,
            objMergeByPlacementCount: stats[38] | 0,
            objInstancedGroupCount: stats[39] | 0,
            terrainFacesUnderlayLevel0: stats[40] | 0,
            terrainFacesUnderlayLevel1: stats[41] | 0,
            terrainFacesUnderlayLevel2: stats[42] | 0,
            terrainFacesUnderlayLevel3: stats[43] | 0,
            terrainFacesOverlayLevel0: stats[44] | 0,
            terrainFacesOverlayLevel1: stats[45] | 0,
            terrainFacesOverlayLevel2: stats[46] | 0,
            terrainFacesOverlayLevel3: stats[47] | 0,
            locMergedDummyCommandCount: stats[48] | 0,
            locMergedDummyElementsTotal: stats[49] | 0,
            locMergedDummyHash: stats[50] | 0,
            locMergedDummyBaseCount: stats[51] | 0,
            locMergedDummyAlphaCount: stats[52] | 0,
            locMergedDummyLodCount: stats[53] | 0,
            locMergedDummyLodAlphaCount: stats[54] | 0,
            geometryElementMismatchCount: stats[55] | 0,
            geometryElementMismatchTotalDelta: stats[56] | 0,
            geometryElementMismatchMaxDelta: stats[57] | 0,
            geometryElementMismatchSampleTypeId: stats[58] | 0,
            geometryElementMismatchSamplePlacementType: stats[59] | 0,
            geometryElementMismatchSampleRotation: stats[60] | 0,
            locPreMergeGroupKeysQueued: stats[61] | 0,
            locPreMergeGroupKeysHash: stats[62] | 0,
            locVariantCandidatesExpanded: stats[63] | 0,
            locVariantDecodeFailed: stats[64] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugDecodeOverlayTypeWithWasm(backendModule, runtimeHandle, overlayId) {
    const decode = getRuntimeDebugDecodeOverlayTypeExport(backendModule);
    if (typeof decode !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 12);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = decode(runtimeHandle | 0, overlayId | 0, outPtr, 12) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 12);
        return {
            primaryRgb: a[0] | 0,
            primaryHsl: a[1] | 0,
            textureId: a[2] | 0,
            secondaryTextureId: a[3] | 0,
            blendRgb: a[4] | 0,
            blendHsl: a[5] | 0,
            blendable: (a[6] | 0) !== 0,
            blendPriority: a[7] | 0,
            hideUnderlay: (a[8] | 0) !== 0,
            occludes: (a[9] | 0) !== 0,
            textureSize: a[10] | 0,
            blockShadow: (a[11] | 0) !== 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugDecodeLocTypeWithWasm(backendModule, runtimeHandle, locTypeId) {
    const decode = getRuntimeDebugDecodeLocTypeExport(backendModule);
    if (typeof decode !== "function") {
        return undefined;
    }
    // Keep in sync with RS_MAP_RENDER_DEBUG_LOC_TYPE_FIELDS in cpp/tools/rs_map_render_backend.cpp
    const outPtr = mallocI32(backendModule, 34);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = decode(runtimeHandle | 0, locTypeId | 0, outPtr, 34) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 34);
        return {
            id: a[0] | 0,
            resolvedId: a[1] | 0,
            mergeNormals: (a[2] | 0) !== 0,
            resolvedMergeNormals: (a[3] | 0) !== 0,
            contourGroundType: a[4] | 0,
            resolvedContourGroundType: a[5] | 0,
            contouredGround: a[6] | 0,
            resolvedContouredGround: a[7] | 0,
            contourGroundParam: a[8] | 0,
            resolvedContourGroundParam: a[9] | 0,
            hasTypes: (a[10] | 0) !== 0,
            resolvedHasTypes: (a[11] | 0) !== 0,
            typeCount: a[12] | 0,
            resolvedTypeCount: a[13] | 0,
            modelGroupCount: a[14] | 0,
            resolvedModelGroupCount: a[15] | 0,
            modelIdCount: a[16] | 0,
            resolvedModelIdCount: a[17] | 0,
            firstType: a[18] | 0,
            resolvedFirstType: a[19] | 0,
            firstModelId: a[20] | 0,
            resolvedFirstModelId: a[21] | 0,
            transformsCount: a[22] | 0,
            transformVarbit: a[23] | 0,
            transformVarp: a[24] | 0,
            transformIndex: a[25] | 0,
            transformId: a[26] | 0,
            resolvedFromTransform: (a[27] | 0) !== 0,
            decorDisplacement: a[28] | 0,
            resolvedDecorDisplacement: a[29] | 0,
            ambient: a[30] | 0,
            contrast: a[31] | 0,
            resolvedAmbient: a[32] | 0,
            resolvedContrast: a[33] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastTerrainTileFaceCountsWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastTerrainTileFaceCountsMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastTerrainTileFaceCountsExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 5);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 5) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const meta = backendModule.HEAP32.slice(metaPtr >> 2, (metaPtr >> 2) + 5);
        const levels = meta[0] | 0;
        const width = meta[1] | 0;
        const height = meta[2] | 0;
        const border = meta[3] | 0;
        const len = meta[4] | 0;
        if (len <= 0) {
            return { levels, width, height, border, counts: new Uint8Array(0) };
        }
        const bytesPtr = backendModule._malloc(len);
        if (!bytesPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, bytesPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            const counts = backendModule.HEAPU8.slice(bytesPtr >>> 0, (bytesPtr >>> 0) + len);
            return { levels, width, height, border, counts };
        } finally {
            backendModule._free(bytesPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastTerrainDigestWithWasm(backendModule, runtimeHandle) {
    const getDigest = getRuntimeDebugGetLastTerrainDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 12);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, outPtr, 12) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 12);
        return {
            levels: a[0] | 0,
            facesTotal: a[1] | 0,
            verticesTotal: a[2] | 0,
            hash: a[3] | 0,
            levelFaces: [a[4] | 0, a[5] | 0, a[6] | 0, a[7] | 0],
            levelVertices: [a[8] | 0, a[9] | 0, a[10] | 0, a[11] | 0],
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugSetTerrainDigestSampleStartVertexWithWasm(
    backendModule,
    runtimeHandle,
    startVertex,
) {
    const setStart = getRuntimeDebugSetTerrainDigestSampleStartVertexExport(backendModule);
    if (typeof setStart !== "function") {
        return false;
    }
    const status = setStart(runtimeHandle | 0, startVertex | 0) | 0;
    return status === RUNTIME_STATUS_OK;
}

export function runtimeDebugSetTerrainProbeWithWasm(
    backendModule,
    runtimeHandle,
    level,
    tileX,
    tileY,
) {
    const setProbe = getRuntimeDebugSetTerrainProbeExport(backendModule);
    if (typeof setProbe !== "function") {
        return false;
    }
    const status = setProbe(runtimeHandle | 0, level | 0, tileX | 0, tileY | 0) | 0;
    return status === RUNTIME_STATUS_OK;
}

export function runtimeDebugGetLastTerrainProbeWithWasm(backendModule, runtimeHandle) {
    const getProbe = getRuntimeDebugGetLastTerrainProbeExport(backendModule);
    if (typeof getProbe !== "function") {
        return undefined;
    }
    const PROBE_LEN = 68;
    const outPtr = mallocI32(backendModule, PROBE_LEN);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getProbe(runtimeHandle | 0, outPtr, PROBE_LEN) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + PROBE_LEN);
        return {
            hit: (a[0] | 0) !== 0,
            level: a[1] | 0,
            tileX: a[2] | 0,
            tileY: a[3] | 0,
            packed: new Int32Array(a.slice(4)),
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugDecodeCachedTerrainCellWithWasm(
    backendModule,
    runtimeHandle,
    mapX,
    mapY,
    level,
    localX,
    localY,
) {
    const decode = getRuntimeDebugDecodeCachedTerrainCellExport(backendModule);
    if (typeof decode !== "function") {
        return undefined;
    }
    const OUT_LEN = 16;
    const outPtr = mallocI32(backendModule, OUT_LEN);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = decode(
            runtimeHandle | 0,
            mapX | 0,
            mapY | 0,
            level | 0,
            localX | 0,
            localY | 0,
            outPtr,
            OUT_LEN,
        ) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + OUT_LEN);
        return {
            ok: (a[0] | 0) !== 0,
            newFormat: (a[1] | 0) !== 0,
            terrainBytesLength: a[2] | 0,
            underlayRaw: a[3] | 0,
            overlayRaw: a[4] | 0,
            shape: a[5] | 0,
            rotation: a[6] | 0,
            renderFlags: a[7] | 0,
            height: a[8] | 0,
            cacheGame: a[9] | 0,
            cacheRevision: a[10] | 0,
            mapX: a[11] | 0,
            mapY: a[12] | 0,
            packed: new Int32Array(a),
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugSetWorldHeightProbeWithWasm(
    backendModule,
    runtimeHandle,
    level,
    worldX,
    worldZ,
) {
    const setProbe = getRuntimeDebugSetWorldHeightProbeExport(backendModule);
    if (typeof setProbe !== "function") {
        return false;
    }
    const status = setProbe(runtimeHandle | 0, level | 0, worldX | 0, worldZ | 0) | 0;
    return status === RUNTIME_STATUS_OK;
}

export function runtimeDebugGetLastWorldHeightProbeWithWasm(backendModule, runtimeHandle) {
    const getProbe = getRuntimeDebugGetLastWorldHeightProbeExport(backendModule);
    if (typeof getProbe !== "function") {
        return undefined;
    }
    const PROBE_LEN = 20;
    const outPtr = mallocI32(backendModule, PROBE_LEN);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getProbe(runtimeHandle | 0, outPtr, PROBE_LEN) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + PROBE_LEN);
        return {
            rawHit: a[0] | 0,
            hit: (a[0] | 0) !== 0,
            level: a[1] | 0,
            worldX: a[2] | 0,
            worldZ: a[3] | 0,
            packed: new Int32Array(a.slice(4)),
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastTerrainDigestSamplesPackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastTerrainDigestSamplesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastTerrainDigestSamplesPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 3);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 3) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const meta = backendModule.HEAP32.slice(metaPtr >> 2, (metaPtr >> 2) + 3);
        const count = meta[0] | 0;
        const stride = meta[1] | 0;
        const len = meta[2] | 0;
        if (len <= 0) {
            return { count, stride, packed: new Int32Array(0) };
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
            return { count, stride, packed: new Int32Array(a) };
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastSceneCommandPlanDigestWithWasm(backendModule, runtimeHandle) {
    const getDigest = getRuntimeDebugGetLastSceneCommandPlanDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 9);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, outPtr, 9) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 9);
        return {
            opCount: a[0] | 0,
            mergedGroupOpCount: a[1] | 0,
            instancedOpCount: a[2] | 0,
            instancedFacesTotal: a[3] | 0,
            instancedInstancesTotal: a[4] | 0,
            instancedLodInstancesTotal: a[5] | 0,
            seqHash: a[6] | 0,
            multisetHashSum: a[7] | 0,
            multisetHashXor: a[8] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastSceneCommandPlanOpsPackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastSceneCommandPlanOpsPackedMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastSceneCommandPlanOpsPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 1);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 1) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastSceneCommandPlanOpProvenancePackedWithWasm(
    backendModule,
    runtimeHandle,
) {
    const getMeta = getRuntimeDebugGetLastSceneCommandPlanOpProvenancePackedMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastSceneCommandPlanOpProvenancePackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 1);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 1) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastSceneBucketsDigestWithWasm(backendModule, runtimeHandle) {
    const getDigest = getRuntimeDebugGetLastSceneBucketsDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 11);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, outPtr, 11) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 11);
        return {
            cmdTotal: a[0] | 0,
            instanceTotal: a[1] | 0,
            hash: a[2] | 0,
            bucketCmdCounts: [
                a[3] | 0,
                a[4] | 0,
                a[5] | 0,
                a[6] | 0,
                a[7] | 0,
                a[8] | 0,
                a[9] | 0,
                a[10] | 0,
            ],
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastLocRenderPlacementDigestWithWasm(backendModule, runtimeHandle) {
    const getDigest = getRuntimeDebugGetLastLocRenderPlacementDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 2);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, outPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 2);
        return {
            count: a[0] | 0,
            hash: a[1] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastLocRenderPlacementEntriesPackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastLocRenderPlacementEntriesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastLocRenderPlacementEntriesPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 2);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        const stride = backendModule.HEAP32[(metaPtr >> 2) + 1] | 0;
        if (stride !== 13) {
            return undefined;
        }
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetModelFacesDigestWithWasm(backendModule, runtimeHandle, modelId) {
    const getDigest = getRuntimeDebugGetModelFacesDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 4);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, modelId | 0, outPtr, 4) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 4);
        return {
            faceCount: a[0] | 0,
            opaqueCount: a[1] | 0,
            transparentCount: a[2] | 0,
            hash: a[3] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetModelVerticesDigestWithWasm(backendModule, runtimeHandle, modelId) {
    const getDigest = getRuntimeDebugGetModelVerticesDigestExport(backendModule);
    if (typeof getDigest !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 4);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getDigest(runtimeHandle | 0, modelId | 0, outPtr, 4) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 4);
        return {
            verticesCount: a[0] | 0,
            usedVertexCount: a[1] | 0,
            faceCount: a[2] | 0,
            hash: a[3] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetModelVerticesSampleWithWasm(backendModule, runtimeHandle, modelId) {
    const getSample = getRuntimeDebugGetModelVerticesSampleExport(backendModule);
    if (typeof getSample !== "function") {
        return undefined;
    }
    const LEN = 5 + 32 * 3;
    const outPtr = mallocI32(backendModule, LEN);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getSample(runtimeHandle | 0, modelId | 0, outPtr, LEN) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + LEN);
        const version = a[0] | 0;
        const verticesCount = a[1] | 0;
        const usedVertexCount = a[2] | 0;
        const faceCount = a[3] | 0;
        const written = a[4] | 0;
        const clampWritten = written >= 0 ? Math.min(written, 32) | 0 : 0;
        const xyz = new Int32Array(clampWritten * 3);
        for (let i = 0; i < xyz.length; i++) {
            xyz[i] = a[5 + i] | 0;
        }
        return { version, verticesCount, usedVertexCount, faceCount, written: clampWritten, xyz };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetModelVerticesSampleRangeWithWasm(
    backendModule,
    runtimeHandle,
    modelId,
    startVertex,
) {
    const getSample = getRuntimeDebugGetModelVerticesSampleRangeExport(backendModule);
    if (typeof getSample !== "function") {
        return undefined;
    }
    const LEN = 5 + 32 * 3;
    const outPtr = mallocI32(backendModule, LEN);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getSample(runtimeHandle | 0, modelId | 0, startVertex | 0, outPtr, LEN) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + LEN);
        const version = a[0] | 0;
        const verticesCount = a[1] | 0;
        const usedVertexCount = a[2] | 0;
        const faceCount = a[3] | 0;
        const written = a[4] | 0;
        const clampWritten = written >= 0 ? Math.min(written, 32) | 0 : 0;
        const xyz = new Int32Array(clampWritten * 3);
        for (let i = 0; i < xyz.length; i++) {
            xyz[i] = a[5 + i] | 0;
        }
        return { version, verticesCount, usedVertexCount, faceCount, written: clampWritten, xyz };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLocModelVerticesSampleWithWasm(
    backendModule,
    runtimeHandle,
    locTypeId,
    placementType,
    rotation,
    modelId,
) {
    const getSample = getRuntimeDebugGetLocModelVerticesSampleExport(backendModule);
    if (typeof getSample !== "function") {
        return undefined;
    }
    const LEN = 5 + 32 * 3;
    const outPtr = mallocI32(backendModule, LEN);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getSample(
            runtimeHandle | 0,
            locTypeId | 0,
            placementType | 0,
            rotation | 0,
            modelId | 0,
            outPtr,
            LEN,
        ) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const a = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + LEN);
        const version = a[0] | 0;
        const verticesCount = a[1] | 0;
        const usedVertexCount = a[2] | 0;
        const faceCount = a[3] | 0;
        const written = a[4] | 0;
        const clampWritten = written >= 0 ? Math.min(written, 32) | 0 : 0;
        const xyz = new Int32Array(clampWritten * 3);
        for (let i = 0; i < xyz.length; i++) {
            xyz[i] = a[5 + i] | 0;
        }
        return { version, verticesCount, usedVertexCount, faceCount, written: clampWritten, xyz };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeDebugGetLastLocPreMergeGroupKeySignaturesWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastLocPreMergeGroupKeySignaturesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastLocPreMergeGroupKeySignaturesExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 1);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 1) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastLocPreMergeGroupKeyEntriesPackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastLocPreMergeGroupKeyEntriesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastLocPreMergeGroupKeyEntriesPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 2);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        const stride = backendModule.HEAP32[(metaPtr >> 2) + 1] | 0;
        if (stride !== 17 && stride !== 10) {
            return undefined;
        }
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastLocMergeDecisionEntriesPackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastLocMergeDecisionEntriesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastLocMergeDecisionEntriesPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 2);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        const stride = backendModule.HEAP32[(metaPtr >> 2) + 1] | 0;
        if (stride !== 26) {
            return undefined;
        }
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastLocMergeEmitEntriesPackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastLocMergeEmitEntriesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastLocMergeEmitEntriesPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 2);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        const stride = backendModule.HEAP32[(metaPtr >> 2) + 1] | 0;
        if (stride !== 13 && stride !== 11) {
            return undefined;
        }
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastLocMergeNormalsTraceEntriesPackedWithWasm(
    backendModule,
    runtimeHandle,
) {
    const getMeta = getRuntimeDebugGetLastLocMergeNormalsTraceEntriesMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastLocMergeNormalsTraceEntriesPackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 2);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        const stride = backendModule.HEAP32[(metaPtr >> 2) + 1] | 0;
        if (stride !== 22) {
            return undefined;
        }
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugGetLastCommandProvenancePackedWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastCommandProvenanceMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastCommandProvenancePackedExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 2);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const len = backendModule.HEAP32[metaPtr >> 2] | 0;
        const stride = backendModule.HEAP32[(metaPtr >> 2) + 1] | 0;
        if (stride !== 11 && stride !== 12) {
            return undefined;
        }
        if (len <= 0) {
            return new Int32Array(0);
        }
        const outPtr = mallocI32(backendModule, len);
        if (!outPtr) {
            return undefined;
        }
        try {
            const copyStatus = copy(runtimeHandle | 0, outPtr, len) | 0;
            if (copyStatus !== RUNTIME_STATUS_OK) {
                return undefined;
            }
            return backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
        } finally {
            backendModule._free(outPtr);
        }
    } finally {
        backendModule._free(metaPtr);
    }
}

export function runtimeDebugBuildMapPlanFromCacheWithWasm(backendModule, runtimeHandle, request) {
    const buildMapPlanFromCache = getRuntimeDebugBuildMapPlanFromCacheExport(backendModule);
    if (typeof buildMapPlanFromCache !== "function") {
        return false;
    }
    const status = buildMapPlanFromCache(
        runtimeHandle | 0,
        request?.mapX | 0,
        request?.mapY | 0,
        request?.borderSize | 0,
        request?.sizeX | 0,
        request?.sizeY | 0,
        request?.smoothTerrain ? 1 : 0,
        request?.locLoadType | 0,
        request?.minimizeDrawCalls === true ? 1 : 0,
        request?.loadLocs === false ? 0 : 1,
        request?.loadObjs === false ? 0 : 1,
        request?.loadNpcs === false ? 0 : 1,
    ) | 0;
    return status === RUNTIME_STATUS_OK;
}
