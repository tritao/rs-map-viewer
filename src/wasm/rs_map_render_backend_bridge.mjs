let backendModulePromise;
let backendModuleInstance;
const runtimeTickOutputByHandle = new Map();
const runtimeCacheUploadByHandle = new Map();
const CAP_NPC_DECODE = 1 << 1;
const CAP_RUNTIME_STATE = 1 << 9;
const CAP_RUNTIME_CACHE_V2 = 1 << 10;
const CAP_RUNTIME_PACKET_V2_ONLY = 1 << 11;
const MAP_SQUARE_SIZE = 64;
const SCENE_LEVELS = 4;
const SD_TEXTURE_PACK_LIMIT = 2047;
const RUNTIME_TICK_STATE_PACKED_VERSION = 1;
const RUNTIME_TICK_STATE_PACKED_VERSION_V2_COMPACT = 2;
const RUNTIME_TICK_OUTPUT_PACKED_VERSION = 1;
const RUNTIME_TICK_STATE_FIELD_COUNT = 70;
const TICK_FIELD_LOC_FRAME_STEPS = 2;
const TICK_FIELD_LOC_HAS_ANIM_MAYA = 3;
const TICK_FIELD_LOC_ANIM_MAYA_DURATIONS = 4;
const TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS = 5;
const TICK_FIELD_LOC_FRAME_LENGTH_COUNTS = 6;
const TICK_FIELD_LOC_FRAME_LENGTHS_PACKED = 7;
const RUNTIME_STATUS_OK = 1;
const RUNTIME_PACKET_META_LENGTH = 44;
const RUNTIME_PACKET_VERSION = 3;
const RUNTIME_BUILD_DEBUG_STATS_LENGTH = 65;
const RUNTIME_TYPE_BLOB_LOC_KIND = 1;
const RUNTIME_TYPE_BLOB_VARBIT_KIND = 2;
const RUNTIME_TYPE_BLOB_MODEL_KIND = 3;
const RUNTIME_TYPE_BLOB_TEXTURE_TRANSPARENT_KIND = 4;
const RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND = 5;
const RUNTIME_TYPE_BLOB_SEQ_FRAME_KIND = 6;
const RUNTIME_TYPE_BLOB_NPC_KIND = 7;
const RUNTIME_TYPE_BLOB_BAS_KIND = 8;
const RUNTIME_TYPE_BLOB_TEXTURE_IDS_KIND = 9;
const RUNTIME_TYPE_BLOB_UNDERLAY_KIND = 10;
const RUNTIME_TYPE_BLOB_OVERLAY_KIND = 11;
const RUNTIME_TYPE_BLOB_OBJ_KIND = 12;
const RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND = 13;
const RUNTIME_TYPE_BLOB_SEQ_ALPHA_HINT_KIND = 14;
const RUNTIME_TYPE_BLOB_SEQ_BASE_KIND = 15;
const RUNTIME_TYPE_BLOB_SKELETAL_SEQ_KIND = 16;


function createWasmModuleLocator(path) {
    return new URL(path, import.meta.url).href;
}

export async function tryLoadBackendModule() {
    if (backendModulePromise) {
        return backendModulePromise;
    }
    backendModulePromise = (async () => {
        try {
            const mod = await import("./rs_map_render_backend.js");
            const createModule = mod.default;
            if (typeof createModule !== "function") {
                console.warn("[map-render-backend] wasm module factory export missing");
                return undefined;
            }
            const backendModule = await createModule({
                locateFile: createWasmModuleLocator,
            });
            if (
                typeof backendModule._rs_map_render_bridge_abi_version !== "function" ||
                typeof backendModule._rs_map_render_bridge_capabilities !== "function" ||
                typeof backendModule._rs_decode_npc_spawns_from_bytes !== "function" ||
                typeof backendModule._malloc !== "function" ||
                typeof backendModule._free !== "function"
            ) {
                console.warn("[map-render-backend] wasm module missing required exports");
                return undefined;
            }
            const abiVersion = backendModule._rs_map_render_bridge_abi_version() | 0;
            if (abiVersion !== 2) {
                console.warn(`[map-render-backend] unsupported wasm ABI version: ${abiVersion}`);
                return undefined;
            }
            backendModule.__rsCapabilities = backendModule._rs_map_render_bridge_capabilities() | 0;
            if (
                (backendModule.__rsCapabilities & CAP_RUNTIME_STATE) !== 0 &&
                (typeof getRuntimeDestroyExport(backendModule) !== "function" ||
                    typeof getRuntimeResetExport(backendModule) !== "function" ||
                    typeof getRuntimeIsValidExport(backendModule) !== "function" ||
                    typeof getRuntimeClearTickStateExport(backendModule) !== "function" ||
                    typeof getRuntimeSetTickStatePackedExport(backendModule) !== "function" ||
                    typeof getRuntimeTickForStatePackedExport(backendModule) !== "function")
            ) {
                console.warn(
                    "[map-render-backend] runtime-state capability advertised but required runtime exports are missing",
                );
                backendModule.__rsCapabilities &= ~CAP_RUNTIME_STATE;
            }
            if (
                (backendModule.__rsCapabilities & CAP_RUNTIME_CACHE_V2) !== 0 &&
                (typeof getRuntimeCreateWithConfigExport(backendModule) !== "function" ||
                    typeof getRuntimeCachePutMapSquaresPackedExport(backendModule) !== "function" ||
                    typeof getRuntimeCachePutTypeEntryExport(backendModule) !== "function" ||
                    typeof getRuntimeCacheClearTypeKindExport(backendModule) !== "function" ||
                    typeof getRuntimeCollectRequiredPrimaryTypeIdsExport(backendModule) !==
                        "function" ||
                    typeof getRuntimeCollectRequiredExpandedTypeIdsExport(backendModule) !==
                        "function" ||
                    typeof getRuntimeCacheSetVarpsExport(backendModule) !== "function" ||
                    typeof getRuntimeBuildMapPacketHandleFromCacheExport(backendModule) !== "function" ||
                    typeof getRuntimeGetPacketMetaExport(backendModule) !== "function" ||
                    typeof getRuntimeReleasePacketExport(backendModule) !== "function")
            ) {
                console.warn(
                    "[map-render-backend] runtime-cache-v2 capability advertised but required exports are missing",
                );
                backendModule.__rsCapabilities &= ~CAP_RUNTIME_CACHE_V2;
            }
            if (
                (backendModule.__rsCapabilities & CAP_RUNTIME_CACHE_V2) !== 0 &&
                (backendModule.__rsCapabilities & CAP_RUNTIME_PACKET_V2_ONLY) === 0
            ) {
                console.warn(
                    "[map-render-backend] runtime-cache-v2 capability advertised without runtime-packet-v2-only bit",
                );
                backendModule.__rsCapabilities &= ~CAP_RUNTIME_CACHE_V2;
            }
            backendModuleInstance = backendModule;
            return backendModule;
        } catch (e) {
            console.warn(`[map-render-backend] failed to load wasm backend: ${String(e)}`);
            return undefined;
        }
    })();
    return backendModulePromise;
}

const DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
];

function getRuntimeCreateWithConfigExport(backendModule) {
    return backendModule._rs_map_render_runtime_create_with_config;
}

function getRuntimeDestroyExport(backendModule) {
    return backendModule._rs_map_render_runtime_destroy;
}

function getRuntimeResetExport(backendModule) {
    return backendModule._rs_map_render_runtime_reset;
}

function getRuntimeIsValidExport(backendModule) {
    return backendModule._rs_map_render_runtime_is_valid;
}

function getRuntimeClearTickStateExport(backendModule) {
    return backendModule._rs_map_render_runtime_clear_tick_state;
}

function getRuntimeSetTickStatePackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_set_tick_state_packed;
}

function getRuntimeTickForStatePackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_tick_advance_and_emit_base_patches_for_state_packed;
}

function getRuntimeCachePutMapSquaresPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_put_map_squares_packed;
}

function getRuntimeCacheClearMapSquaresExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_clear_map_squares;
}

function getRuntimeCachePutTypeEntryExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_put_type_entry;
}

function getRuntimeCacheClearTypeKindExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_clear_type_kind;
}

function getRuntimeCollectRequiredPrimaryTypeIdsExport(backendModule) {
    return backendModule._rs_map_render_runtime_collect_required_primary_type_ids;
}

function getRuntimeCollectRequiredExpandedTypeIdsExport(backendModule) {
    return backendModule._rs_map_render_runtime_collect_required_expanded_type_ids;
}

function getRuntimeCacheSetBuildConfigExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_set_build_config;
}

function getRuntimeCacheSetVarpsExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_set_varps;
}

function getRuntimeSetGeometrySeedExport(backendModule) {
    return backendModule._rs_map_render_runtime_set_geometry_seed;
}

function getRuntimeClearGeometrySeedExport(backendModule) {
    return backendModule._rs_map_render_runtime_clear_geometry_seed;
}

function getRuntimeCachePutTextureArgbExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_put_texture_argb;
}

function getRuntimeCacheClearTextureArgbExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_clear_texture_argb;
}

function getRuntimeCachePutMaterialParamsExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_put_material_params;
}

function getRuntimeCacheClearMaterialParamsExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_clear_material_params;
}

function getRuntimeCacheGetResourceCountsExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_get_resource_counts;
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

function getRuntimeDebugGetLastCollisionFlagsMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_collision_flags_meta;
}

function getRuntimeDebugCopyLastCollisionFlagsExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_copy_last_collision_flags;
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


function getRuntimeBuildMapPacketHandleFromCacheExport(backendModule) {
    return backendModule._rs_map_render_runtime_build_map_packet_handle_from_cache;
}

function getRuntimeDebugBuildMapPlanFromCacheExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_build_map_plan_from_cache;
}

function getRuntimeBuildNpcPacketHandleFromCacheExport(backendModule) {
    return backendModule._rs_map_render_runtime_build_npc_packet_handle_from_cache;
}

function getRuntimeGetPacketMetaExport(backendModule) {
    return backendModule._rs_map_render_runtime_get_packet_meta;
}

function getRuntimeReleasePacketExport(backendModule) {
    return backendModule._rs_map_render_runtime_release_packet;
}

function computeSceneBuildMapBounds(baseX, baseY, sizeX, sizeY) {
    return {
        mapStartX: Math.floor(baseX / MAP_SQUARE_SIZE),
        mapStartY: Math.floor(baseY / MAP_SQUARE_SIZE),
        mapEndX: Math.ceil((baseX + sizeX) / MAP_SQUARE_SIZE),
        mapEndY: Math.ceil((baseY + sizeY) / MAP_SQUARE_SIZE),
    };
}

function getMapSquareId(mapX, mapY) {
    return (mapX << 8) + mapY;
}

function concatByteChunks(chunks, totalLength) {
    if (totalLength <= 0) {
        return new Uint8Array(0);
    }
    const out = new Uint8Array(totalLength);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        out.set(chunk, off);
        off += chunk.length;
    }
    return out;
}

function mallocU8AndCopy(backendModule, bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return 0;
    }
    const ptr = backendModule._malloc(bytes.length);
    if (!ptr) {
        return 0;
    }
    backendModule.HEAPU8.set(bytes, ptr);
    return ptr;
}

function mallocI32AndCopy(backendModule, values) {
    if (!(values instanceof Int32Array) || values.length === 0) {
        return 0;
    }
    const bytes = values.length * 4;
    const ptr = backendModule._malloc(bytes);
    if (!ptr) {
        return 0;
    }
    backendModule.HEAP32.set(values, ptr >> 2);
    return ptr;
}

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


function tryGetVarbitLoader(varProvider) {
    if (!varProvider) {
        return undefined;
    }
    const fromManager = varProvider.varManager?.varbitLoader;
    if (fromManager && typeof fromManager.tryLoad === "function") {
        return fromManager;
    }
    const direct = varProvider.varbitLoader;
    if (direct && typeof direct.tryLoad === "function") {
        return direct;
    }
    return undefined;
}

function toUint8ArrayView(data) {
    if (data instanceof Uint8Array) {
        return data;
    }
    if (data instanceof Int8Array) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return undefined;
}

function tryLoadTypeBytes(loader, id) {
    if (!loader) {
        return undefined;
    }
    if (typeof loader.tryLoadBytes === "function") {
        try {
            const fromLoader = toUint8ArrayView(loader.tryLoadBytes(id));
            if (fromLoader) {
                return fromLoader;
            }
        } catch {
            // ignore and fall through
        }
    }
    if (typeof loader.getData === "function") {
        try {
            return toUint8ArrayView(loader.getData(id));
        } catch {
            return undefined;
        }
    }
    if (
        loader.modelSource &&
        typeof loader.modelSource.getBytes === "function"
    ) {
        try {
            return toUint8ArrayView(loader.modelSource.getBytes(id));
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function encodeVarbitTypeBytes(varbit) {
    const baseVar = (varbit?.baseVar ?? 0) & 0xffff;
    const startBit = (varbit?.startBit ?? 0) & 0xff;
    const endBit = (varbit?.endBit ?? 0) & 0xff;
    const bytes = new Uint8Array(6);
    bytes[0] = 1;
    bytes[1] = (baseVar >>> 8) & 0xff;
    bytes[2] = baseVar & 0xff;
    bytes[3] = startBit;
    bytes[4] = endBit;
    bytes[5] = 0;
    return bytes;
}

// Encode a decoded SeqFrame (Dat2 / Legacy / Dat) into a small bridge format so C++ can
// consume classic animation frames without requiring raw cache bytes + SeqBase blobs.
//
// Format (little-endian):
//   u8[4]  magic "RSQF"
//   u8     version = 1
//   u8     flags (bit0 hasAlphaTransform, bit1 hasColorTransform)
//   u16    baseCount
//   u8[baseCount] baseTypes
//   for each base group:
//     u8 labelCount
//     u8[labelCount] labels
//   u16 transformCount
//   for each transform:
//     u16 group
//     i16 tx, i16 ty, i16 tz
//     i16 resetOriginGroup
function encodeSeqFrameBytes(seqFrame) {
    if (!seqFrame || typeof seqFrame !== "object") {
        return undefined;
    }
    const base = seqFrame.base;
    const baseTypes = Array.isArray(base?.types) ? base.types : undefined;
    const baseLabels = Array.isArray(base?.labels) ? base.labels : undefined;
    const transformCount = seqFrame.transformCount | 0;
    const transformGroups = Array.isArray(seqFrame.transformGroups) ? seqFrame.transformGroups : [];
    const transformX = Array.isArray(seqFrame.transformX) ? seqFrame.transformX : [];
    const transformY = Array.isArray(seqFrame.transformY) ? seqFrame.transformY : [];
    const transformZ = Array.isArray(seqFrame.transformZ) ? seqFrame.transformZ : [];
    const resetOriginGroups = Array.isArray(seqFrame.resetOriginGroups)
        ? seqFrame.resetOriginGroups
        : [];

    const baseCount = base?.count ?? (Array.isArray(baseTypes) ? baseTypes.length | 0 : 0);
    if (!baseTypes || !baseLabels || (baseCount | 0) <= 0) {
        return undefined;
    }
    const bc = baseCount | 0;

    // Worst-case size upper bound.
    let labelsBytes = 0;
    for (let i = 0; i < bc; i++) {
        const labels = Array.isArray(baseLabels[i]) ? baseLabels[i] : [];
        labelsBytes += 1 + (labels.length | 0);
    }
    const tc = Math.max(0, transformCount | 0);
    const bytesLen =
        4 + // magic
        1 + // version
        1 + // flags
        2 + // baseCount
        bc + // baseTypes
        labelsBytes +
        2 + // transformCount
        tc * (2 + 2 + 2 + 2 + 2); // group + tx/ty/tz + resetOriginGroup

    const out = new Uint8Array(bytesLen);
    let o = 0;
    out[o++] = 0x52; // R
    out[o++] = 0x53; // S
    out[o++] = 0x51; // Q
    out[o++] = 0x46; // F
    out[o++] = 1; // version
    let flags = 0;
    if (seqFrame.hasAlphaTransform === true) flags |= 1;
    if (seqFrame.hasColorTransform === true) flags |= 2;
    out[o++] = flags & 0xff;
    out[o++] = bc & 0xff;
    out[o++] = (bc >>> 8) & 0xff;
    for (let i = 0; i < bc; i++) {
        out[o++] = (baseTypes[i] ?? 0) & 0xff;
    }
    for (let i = 0; i < bc; i++) {
        const labels = Array.isArray(baseLabels[i]) ? baseLabels[i] : [];
        const lc = labels.length | 0;
        out[o++] = lc & 0xff;
        for (let j = 0; j < lc; j++) {
            out[o++] = (labels[j] ?? 0) & 0xff;
        }
    }
    out[o++] = tc & 0xff;
    out[o++] = (tc >>> 8) & 0xff;
    const writeI16 = (v) => {
        const x = (v | 0) & 0xffff;
        out[o++] = x & 0xff;
        out[o++] = (x >>> 8) & 0xff;
    };
    const writeU16 = (v) => {
        const x = (v | 0) & 0xffff;
        out[o++] = x & 0xff;
        out[o++] = (x >>> 8) & 0xff;
    };
    for (let i = 0; i < tc; i++) {
        writeU16(transformGroups[i] ?? 0);
        writeI16(transformX[i] ?? 0);
        writeI16(transformY[i] ?? 0);
        writeI16(transformZ[i] ?? 0);
        writeI16(resetOriginGroups[i] ?? -1);
    }
    return o === out.length ? out : out.slice(0, o);
}

function emptyTypeBytePack() {
    return {
        ids: new Int32Array(0),
        offsets: new Int32Array(0),
        lengths: new Int32Array(0),
        bytes: new Uint8Array(0),
    };
}

function buildTypeBytePackFromLoader(loader, encodeFallback) {
    if (!loader || typeof loader.getCount !== "function") {
        return emptyTypeBytePack();
    }

    const count = loader.getCount() | 0;
    if (count <= 0) {
        return emptyTypeBytePack();
    }

    const ids = [];
    const offsets = [];
    const lengths = [];
    const chunks = [];
    let totalLength = 0;

    for (let id = 0; id < count; id++) {
        let bytes = tryLoadTypeBytes(loader, id);
        if (!bytes && encodeFallback && typeof loader.tryLoad === "function") {
            let result;
            try {
                result = loader.tryLoad(id);
            } catch {
                result = undefined;
            }
            if (result?.ok) {
                bytes = encodeFallback(result.value);
            }
        }
        if (!bytes || bytes.length <= 0) {
            continue;
        }
        ids.push(id | 0);
        offsets.push(totalLength | 0);
        lengths.push(bytes.length | 0);
        chunks.push(bytes);
        totalLength += bytes.length | 0;
    }

    return {
        ids: Int32Array.from(ids),
        offsets: Int32Array.from(offsets),
        lengths: Int32Array.from(lengths),
        bytes: concatByteChunks(chunks, totalLength),
    };
}

function buildTypeBytePackFromIds(loader, ids, encodeFallback) {
    if (!loader || !Array.isArray(ids) || ids.length <= 0) {
        return emptyTypeBytePack();
    }
    const sortedUniqueIds = Array.from(new Set(ids.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
    if (sortedUniqueIds.length <= 0) {
        return emptyTypeBytePack();
    }

    const outIds = [];
    const offsets = [];
    const lengths = [];
    const chunks = [];
    let totalLength = 0;

    for (let i = 0; i < sortedUniqueIds.length; i++) {
        const id = sortedUniqueIds[i] | 0;
        let bytes = tryLoadTypeBytes(loader, id);
        if (!bytes && encodeFallback && typeof loader.tryLoad === "function") {
            let result;
            try {
                result = loader.tryLoad(id);
            } catch {
                result = undefined;
            }
            if (result?.ok) {
                bytes = encodeFallback(result.value);
            }
        }
        if (!bytes || bytes.length <= 0) {
            continue;
        }
        outIds.push(id);
        offsets.push(totalLength | 0);
        lengths.push(bytes.length | 0);
        chunks.push(bytes);
        totalLength += bytes.length | 0;
    }

    return {
        ids: Int32Array.from(outIds),
        offsets: Int32Array.from(offsets),
        lengths: Int32Array.from(lengths),
        bytes: concatByteChunks(chunks, totalLength),
    };
}

function buildTypeBytePackFromIdsWithByteGetter(ids, tryGetBytes) {
    if (!Array.isArray(ids) || ids.length <= 0 || typeof tryGetBytes !== "function") {
        return emptyTypeBytePack();
    }
    const sortedUniqueIds = Array.from(new Set(ids.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
    if (sortedUniqueIds.length <= 0) {
        return emptyTypeBytePack();
    }

    const outIds = [];
    const offsets = [];
    const lengths = [];
    const chunks = [];
    let totalLength = 0;

    for (let i = 0; i < sortedUniqueIds.length; i++) {
        const id = sortedUniqueIds[i] | 0;
        let bytes;
        try {
            bytes = toUint8ArrayView(tryGetBytes(id));
        } catch {
            bytes = undefined;
        }
        if (!bytes || bytes.length <= 0) {
            continue;
        }
        outIds.push(id);
        offsets.push(totalLength | 0);
        lengths.push(bytes.length | 0);
        chunks.push(bytes);
        totalLength += bytes.length | 0;
    }

    return {
        ids: Int32Array.from(outIds),
        offsets: Int32Array.from(offsets),
        lengths: Int32Array.from(lengths),
        bytes: concatByteChunks(chunks, totalLength),
    };
}

function sortedUniqueTypeIds(ids) {
    if (!Array.isArray(ids) || ids.length <= 0) {
        return [];
    }
    return Array.from(new Set(ids.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
}

function tryLoadSeqBaseBytesFromLoader(seqBaseLoader, id) {
    if (!seqBaseLoader || id < 0) {
        return undefined;
    }
    // Best-effort generic hooks (some loaders expose raw bytes).
    const generic = tryLoadTypeBytes(seqBaseLoader, id);
    if (generic) {
        return generic;
    }
    // Dat2SeqBaseLoader: bytes live in baseSource (IndexFileBytesProvider).
    const baseSource = seqBaseLoader.baseSource;
    if (baseSource && typeof baseSource.getBytes === "function") {
        try {
            return toUint8ArrayView(baseSource.getBytes(id));
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function tryLoadSkeletalSeqBytesFromLoader(skeletalSeqLoader, id) {
    if (!skeletalSeqLoader || id < 0) {
        return undefined;
    }
    // Best-effort generic hooks first.
    const generic = tryLoadTypeBytes(skeletalSeqLoader, id);
    if (generic) {
        return generic;
    }
    // ProviderSkeletalSeqLoader: bytes are in an animation group provider (archive=fileMap).
    const archiveId = (id >> 16) | 0;
    const fileId = id & 0xffff;
    let group;
    try {
        group = skeletalSeqLoader.groupCache?.get?.(archiveId);
    } catch {
        group = undefined;
    }
    if (!group) {
        try {
            group = skeletalSeqLoader.animGroupProviderFactory?.getGroup?.(archiveId);
        } catch {
            group = undefined;
        }
        try {
            if (group && skeletalSeqLoader.groupCache?.set) {
                skeletalSeqLoader.groupCache.set(archiveId, group);
            }
        } catch {
            // ignore
        }
    }
    if (!group || typeof group.getBytes !== "function") {
        return undefined;
    }
    try {
        return toUint8ArrayView(group.getBytes(fileId));
    } catch {
        return undefined;
    }
}

function tryGetSeqFrameFromLoader(seqFrameLoader, frameId) {
    if (!seqFrameLoader || frameId < 0) {
        return undefined;
    }
    if (typeof seqFrameLoader.tryGet === "function") {
        try {
            const seqFrame = seqFrameLoader.tryGet(frameId | 0);
            if (seqFrame) {
                return seqFrame;
            }
        } catch {
            // ignore and fall through
        }
    }
    if (typeof seqFrameLoader.tryLoad === "function") {
        try {
            const result = seqFrameLoader.tryLoad(frameId | 0);
            if (result?.ok && result.value) {
                return result.value;
            }
        } catch {
            // ignore and return undefined
        }
    }
    return undefined;
}

function tryGetSkeletalSeqFromLoader(skeletalSeqLoader, seqId) {
    if (!skeletalSeqLoader || seqId < 0 || typeof skeletalSeqLoader.tryGet !== "function") {
        return undefined;
    }
    try {
        return skeletalSeqLoader.tryGet(seqId | 0);
    } catch {
        return undefined;
    }
}

function buildSeqAlphaHintPack(seqIds, seqTypeLoader, seqFrameLoader, skeletalSeqLoader) {
    if (!seqTypeLoader || !Array.isArray(seqIds) || seqIds.length <= 0) {
        return emptyTypeBytePack();
    }
    if (typeof seqTypeLoader.tryLoad !== "function") {
        return emptyTypeBytePack();
    }

    const sortedUniqueIds = Array.from(new Set(seqIds.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
    if (sortedUniqueIds.length <= 0) {
        return emptyTypeBytePack();
    }

    const outIds = [];
    const offsets = [];
    const lengths = [];
    const bytes = new Uint8Array(sortedUniqueIds.length);
    let cursor = 0;

    for (let i = 0; i < sortedUniqueIds.length; i++) {
        const seqId = sortedUniqueIds[i] | 0;
        let seqResult;
        try {
            seqResult = seqTypeLoader.tryLoad(seqId);
        } catch {
            seqResult = undefined;
        }
        if (!seqResult?.ok || !seqResult.value) {
            continue;
        }

        const seqType = seqResult.value;
        let hasAlphaTransform = false;
        const hasAnimMaya =
            typeof seqType?.hasAnimMayaSeq === "function"
                ? seqType.hasAnimMayaSeq()
                : (seqType?.animMayaId ?? -1) >= 0;
        if (hasAnimMaya) {
            const skeletalSeq = tryGetSkeletalSeqFromLoader(
                skeletalSeqLoader,
                seqType.animMayaId | 0,
            );
            hasAlphaTransform = skeletalSeq?.hasAlphaTransform === true;
        } else {
            const frameIds = Array.isArray(seqType?.frameIds) ? seqType.frameIds : [];
            for (let f = 0; f < frameIds.length; f++) {
                const frameId = frameIds[f] | 0;
                const seqFrame = tryGetSeqFrameFromLoader(seqFrameLoader, frameId);
                if (seqFrame?.hasAlphaTransform === true) {
                    hasAlphaTransform = true;
                    break;
                }
            }
        }

        outIds.push(seqId);
        offsets.push(cursor);
        lengths.push(1);
        bytes[cursor] = hasAlphaTransform ? 1 : 0;
        cursor++;
    }

    return {
        ids: Int32Array.from(outIds),
        offsets: Int32Array.from(offsets),
        lengths: Int32Array.from(lengths),
        bytes: bytes.slice(0, cursor),
    };
}

function readUnsignedShortBE(bytes, offset) {
    return ((bytes[offset] << 8) | bytes[offset + 1]) & 0xffff;
}

function readUnsignedSmart(bytes, cursorRef) {
    const cursor = cursorRef.value | 0;
    if (cursor >= bytes.length) {
        return 0;
    }
    const b0 = bytes[cursor] & 0xff;
    if (b0 < 128) {
        cursorRef.value = (cursor + 1) | 0;
        return b0 | 0;
    }
    if (cursor + 1 >= bytes.length) {
        cursorRef.value = bytes.length | 0;
        return 0;
    }
    const v = (readUnsignedShortBE(bytes, cursor) - 0x8000) | 0;
    cursorRef.value = (cursor + 2) | 0;
    return v;
}

function readSmart3(bytes, cursorRef) {
    let total = 0;
    let delta = readUnsignedSmart(bytes, cursorRef);
    while (delta === 32767) {
        total = (total + 32767) | 0;
        delta = readUnsignedSmart(bytes, cursorRef);
    }
    return (total + delta) | 0;
}

function decodeLocPlacementsFromBytesRaw(data) {
    const placements = [];
    if (!(data instanceof Uint8Array) || data.length <= 0) {
        return placements;
    }
    const cursorRef = { value: 0 };
    let id = -1;
    for (;;) {
        const idDelta = readSmart3(data, cursorRef);
        if ((idDelta | 0) === 0) {
            break;
        }
        id = (id + idDelta) | 0;
        let pos = 0;
        for (;;) {
            const posDelta = readUnsignedSmart(data, cursorRef);
            if ((posDelta | 0) === 0) {
                break;
            }
            pos = (pos + posDelta - 1) | 0;
            if (cursorRef.value >= data.length) {
                break;
            }
            const localX = (pos >> 6) & 0x3f;
            const localY = pos & 0x3f;
            const level = pos >> 12;
            const attributes = data[cursorRef.value++] & 0xff;
            placements.push({
                id: id | 0,
                level: level | 0,
                localX: localX | 0,
                localY: localY | 0,
                type: (attributes >> 2) | 0,
                rotation: (attributes & 0x3) | 0,
            });
        }
    }
    return placements;
}

function getVarpValue(varpValues, varpId) {
    if (!(varpValues instanceof Int32Array) || varpId < 0 || varpId >= varpValues.length) {
        return 0;
    }
    return varpValues[varpId] | 0;
}

function getSceneBuildVarpValues(sceneBuildInput) {
    if (sceneBuildInput?.varpValues instanceof Int32Array) {
        return sceneBuildInput.varpValues;
    }
    const managerValues = sceneBuildInput?.varProvider?.varManager?.values;
    if (managerValues instanceof Int32Array) {
        return managerValues;
    }
    const directValues = sceneBuildInput?.varProvider?.values;
    if (directValues instanceof Int32Array) {
        return directValues;
    }
    return new Int32Array(0);
}

function getVarbitValue(varbitLoader, varpValues, varbitId) {
    if (!varbitLoader || typeof varbitLoader.tryLoad !== "function" || varbitId < 0) {
        return 0;
    }
    let varbitResult;
    try {
        varbitResult = varbitLoader.tryLoad(varbitId | 0);
    } catch {
        varbitResult = undefined;
    }
    if (!varbitResult?.ok || !varbitResult.value) {
        return 0;
    }
    const varbit = varbitResult.value;
    const baseVar = varbit.baseVar | 0;
    const startBit = varbit.startBit | 0;
    const endBit = varbit.endBit | 0;
    const bitCount = (endBit - startBit + 1) | 0;
    if (bitCount <= 0 || bitCount > 31) {
        return 0;
    }
    const value = getVarpValue(varpValues, baseVar);
    const mask = ((1 << bitCount) - 1) | 0;
    return (value >> startBit) & mask;
}

function tryLoadLocType(locTypeLoader, id, cache) {
    if (!locTypeLoader || typeof locTypeLoader.tryLoad !== "function" || id < 0) {
        return undefined;
    }
    if (cache && cache.has(id)) {
        return cache.get(id);
    }
    let result;
    try {
        result = locTypeLoader.tryLoad(id | 0);
    } catch {
        result = undefined;
    }
    const value = result?.ok ? result.value : undefined;
    if (cache) {
        cache.set(id, value);
    }
    return value;
}

function resolveLocTypeForPlacement(
    placementId,
    locTypeLoader,
    varbitLoader,
    varpValues,
    locTypeCache,
) {
    const base = tryLoadLocType(locTypeLoader, placementId | 0, locTypeCache);
    if (!base) {
        return undefined;
    }
    const transforms = Array.isArray(base.transforms) ? base.transforms : [];
    if (transforms.length <= 0) {
        return base;
    }
    let transformIndex = -1;
    const transformVarbit = base.transformVarbit | 0;
    const transformVarp = base.transformVarp | 0;
    if (transformVarbit !== -1) {
        transformIndex = getVarbitValue(varbitLoader, varpValues, transformVarbit);
    } else if (transformVarp !== -1) {
        transformIndex = getVarpValue(varpValues, transformVarp);
    }
    let transformId = transforms[transforms.length - 1] | 0;
    if (
        transformIndex >= 0 &&
        transformIndex < transforms.length - 1 &&
        (transforms[transformIndex] | 0) !== -1
    ) {
        transformId = transforms[transformIndex] | 0;
    }
    if (transformId === -1) {
        return undefined;
    }
    // Match TS: if the transform can't be loaded, keep the base type.
    return tryLoadLocType(locTypeLoader, transformId, locTypeCache);
}

function getLocTypeModelGroupForPlacement(locType, placementType) {
    if (!locType || !Array.isArray(locType.models) || locType.models.length <= 0) {
        return undefined;
    }
    const hasTypes = Array.isArray(locType.types) && locType.types.length > 0;
    if (!hasTypes) {
        if ((placementType | 0) !== 10) {
            return undefined;
        }
        return Array.isArray(locType.models[0]) ? locType.models[0] : undefined;
    }
    const types = locType.types;
    for (let i = 0; i < types.length; i++) {
        if ((types[i] | 0) === (placementType | 0)) {
            return Array.isArray(locType.models[i]) ? locType.models[i] : undefined;
        }
    }
    return undefined;
}

function expandLocPlacementModelTypes(type) {
    const t = type | 0;
    switch (t) {
        case 11: // NORMAL_DIAGIONAL -> NORMAL
            return [10];
        case 2: // WALL_CORNER emits two wall-corner variants
            return [2, 2];
        case 5: // WALL_DECORATION_OUTSIDE -> INSIDE
        case 6: // WALL_DECORATION_DIAGONAL_OUTSIDE -> INSIDE
        case 7: // WALL_DECORATION_DIAGONAL_INSIDE -> INSIDE
            return [4];
        case 8: // WALL_DECORATION_DIAGONAL_DOUBLE -> INSIDE + INSIDE
            return [4, 4];
        default:
            return [t];
    }
}

function collectLocModelIdsForSceneBuild(sceneBuildInput) {
    const locTypeLoader = sceneBuildInput?.locTypeLoader;
    const locModelLoader = sceneBuildInput?.locModelLoader;
    const modelLoader = locModelLoader?.modelLoader;
    if (!locTypeLoader || typeof locTypeLoader.tryLoad !== "function") {
        return {
            modelIds: [],
            seqIds: [],
            locTypeIds: [],
            varbitIds: [],
        };
    }

    const mapEntries = collectRuntimeCacheMapSquareEntries(sceneBuildInput);
    if (!Array.isArray(mapEntries) || mapEntries.length <= 0) {
        return {
            modelIds: [],
            seqIds: [],
            locTypeIds: [],
            varbitIds: [],
        };
    }

    const sizeX = sceneBuildInput.sizeX | 0;
    const sizeY = sceneBuildInput.sizeY | 0;
    const baseX = sceneBuildInput.baseX | 0;
    const baseY = sceneBuildInput.baseY | 0;
    const varProvider = sceneBuildInput?.varProvider;
    const varbitLoader = tryGetVarbitLoader(varProvider);
    const varpValues = getSceneBuildVarpValues(sceneBuildInput);
    const locTypeCache = new Map();
    const outModelIds = new Set();
    const outSeqIds = new Set();
    const outLocTypeIds = new Set();
    const outVarbitIds = new Set();

    function collectLocTypeDepsForPlacementType(locType, placementType, explicitTypeId = undefined) {
        if (!locType) {
            return;
        }
        const resolvedTypeId = locType?.id | 0;
        if (resolvedTypeId >= 0) {
            outLocTypeIds.add(resolvedTypeId);
        }
        if (explicitTypeId !== undefined) {
            const baseTypeId = explicitTypeId | 0;
            if (baseTypeId >= 0 && baseTypeId !== resolvedTypeId) {
                outLocTypeIds.add(baseTypeId);
            }
        }
        const transformVarbit = locType.transformVarbit | 0;
        if (transformVarbit >= 0) {
            outVarbitIds.add(transformVarbit);
        }
        const placementTypes = expandLocPlacementModelTypes(placementType);
        for (let v = 0; v < placementTypes.length; v++) {
            const group = getLocTypeModelGroupForPlacement(locType, placementTypes[v] | 0);
            if (!Array.isArray(group)) {
                continue;
            }
            for (let j = 0; j < group.length; j++) {
                const modelId = group[j] | 0;
                if (modelId >= 0) {
                    outModelIds.add(modelId);
                }
            }
        }
        const seqId = locType.seqId | 0;
        if (seqId >= 0) {
            outSeqIds.add(seqId);
        } else if (Array.isArray(locType.randomSeqIds) && locType.randomSeqIds.length > 0) {
            for (let s = 0; s < locType.randomSeqIds.length; s++) {
                const randomSeqId = locType.randomSeqIds[s] | 0;
                if (randomSeqId >= 0) {
                    outSeqIds.add(randomSeqId);
                }
            }
        }
    }

    for (let i = 0; i < mapEntries.length; i++) {
        const entry = mapEntries[i];
        const placements = decodeLocPlacementsFromBytesRaw(entry.locBytes);
        if (placements.length <= 0) {
            continue;
        }
        const offsetX = (entry.mapX | 0) * MAP_SQUARE_SIZE - baseX;
        const offsetY = (entry.mapY | 0) * MAP_SQUARE_SIZE - baseY;
        for (let p = 0; p < placements.length; p++) {
            const placement = placements[p];
            const sceneX = (placement.localX + offsetX) | 0;
            const sceneY = (placement.localY + offsetY) | 0;
            if (!(sceneX > 0 && sceneY > 0 && sceneX < sizeX - 1 && sceneY < sizeY - 1)) {
                continue;
            }

            const placementId = placement.id | 0;
            const placementType = placement.type | 0;
            const baseLocType = tryLoadLocType(locTypeLoader, placementId, locTypeCache);
            if (baseLocType) {
                if (placementId >= 0) {
                    outLocTypeIds.add(placementId);
                }
                const transformVarbit = baseLocType.transformVarbit | 0;
                if (transformVarbit >= 0) {
                    outVarbitIds.add(transformVarbit);
                }
            }

            const locType = resolveLocTypeForPlacement(
                placementId,
                locTypeLoader,
                varbitLoader,
                varpValues,
                locTypeCache,
            );
            if (!locType) {
                continue;
            }
            collectLocTypeDepsForPlacementType(locType, placementType, placementId);
        }
    }
    return {
        modelIds: Array.from(outModelIds),
        seqIds: Array.from(outSeqIds),
        locTypeIds: Array.from(outLocTypeIds),
        varbitIds: Array.from(outVarbitIds),
    };
}

function tryLoadObjType(objTypeLoader, id, cache) {
    if (!objTypeLoader || typeof objTypeLoader.tryLoad !== "function" || id < 0) {
        return undefined;
    }
    if (cache && cache.has(id)) {
        return cache.get(id);
    }
    let result;
    try {
        result = objTypeLoader.tryLoad(id | 0);
    } catch {
        result = undefined;
    }
    const value = result?.ok ? result.value : undefined;
    if (cache) {
        cache.set(id, value);
    }
    return value;
}

function collectObjTypeAndModelIdsForSceneBuild(sceneBuildInput) {
    const loadObjs = sceneBuildInput?.loadObjs === true;
    const objTypeLoader =
        sceneBuildInput?.objTypeLoader ??
        sceneBuildInput?.session?.loaders?.objTypeLoader;
    const objSpawns = Array.isArray(sceneBuildInput?.objSpawns)
        ? sceneBuildInput.objSpawns
        : [];
    const mapX = sceneBuildInput?.mapX | 0;
    const mapY = sceneBuildInput?.mapY | 0;
    const maxLevel = sceneBuildInput?.maxLevel | 0;

    if (!loadObjs || !objTypeLoader || typeof objTypeLoader.tryLoad !== "function") {
        return {
            modelIds: [],
            objTypeIds: [],
            objSpawnsByMap: {
                ids: new Int32Array(0),
                offsets: new Int32Array(0),
                lengths: new Int32Array(0),
                bytes: new Uint8Array(0),
            },
        };
    }

    const outModelIds = new Set();
    const outObjTypeIds = new Set();
    const objTypeCache = new Map();
    const selectedSpawns = [];

    for (let i = 0; i < objSpawns.length; i++) {
        const spawn = objSpawns[i];
        if (!spawn || typeof spawn !== "object") {
            continue;
        }
        const id = spawn.id | 0;
        const count = spawn.count | 0;
        const x = spawn.x | 0;
        const y = spawn.y | 0;
        const plane = spawn.plane | 0;
        if (plane > maxLevel) {
            continue;
        }
        const spawnMapX = Math.floor(x / MAP_SQUARE_SIZE) | 0;
        const spawnMapY = Math.floor(y / MAP_SQUARE_SIZE) | 0;
        if (spawnMapX !== mapX || spawnMapY !== mapY) {
            continue;
        }

        const baseObjType = tryLoadObjType(objTypeLoader, id, objTypeCache);
        if (!baseObjType) {
            continue;
        }
        if ((baseObjType?.name ?? "null") === "null") {
            continue;
        }

        selectedSpawns.push({ id, count, x, y, plane });

        let currentId = id;
        let currentCount = count;
        for (let depth = 0; depth < 16; depth++) {
            const objType = tryLoadObjType(objTypeLoader, currentId, objTypeCache);
            if (!objType) {
                break;
            }
            outObjTypeIds.add(currentId | 0);
            const modelId = objType.model | 0;
            if (modelId >= 0) {
                outModelIds.add(modelId);
            }

            let nextId = -1;
            const countObj = Array.isArray(objType.countObj) ? objType.countObj : [];
            const countCo = Array.isArray(objType.countCo) ? objType.countCo : [];
            if (currentCount > 1 && countObj.length > 0 && countCo.length > 0) {
                const n = Math.min(10, countObj.length, countCo.length);
                for (let j = 0; j < n; j++) {
                    const threshold = countCo[j] | 0;
                    if (threshold !== 0 && currentCount >= threshold) {
                        nextId = countObj[j] | 0;
                    }
                }
            }
            if (nextId < 0 || nextId === currentId) {
                break;
            }
            currentId = nextId | 0;
            currentCount = 1;
        }
    }

    if (selectedSpawns.length <= 0) {
        return {
            modelIds: Array.from(outModelIds),
            objTypeIds: Array.from(outObjTypeIds),
            objSpawnsByMap: {
                ids: new Int32Array(0),
                offsets: new Int32Array(0),
                lengths: new Int32Array(0),
                bytes: new Uint8Array(0),
            },
        };
    }

    const mapId = ((mapX & 0xff) << 8) | (mapY & 0xff);
    const packed = new Int32Array(selectedSpawns.length * 5);
    for (let i = 0; i < selectedSpawns.length; i++) {
        const off = i * 5;
        const spawn = selectedSpawns[i];
        packed[off + 0] = spawn.id | 0;
        packed[off + 1] = spawn.count | 0;
        packed[off + 2] = spawn.x | 0;
        packed[off + 3] = spawn.y | 0;
        packed[off + 4] = spawn.plane | 0;
    }
    const bytes = new Uint8Array(packed.byteLength);
    bytes.set(new Uint8Array(packed.buffer));

    return {
        modelIds: Array.from(outModelIds),
        objTypeIds: Array.from(outObjTypeIds),
        objSpawnsByMap: {
            ids: Int32Array.of(mapId),
            offsets: Int32Array.of(0),
            lengths: Int32Array.of(bytes.length | 0),
            bytes,
        },
    };
}

function collectRuntimeCacheMapSquareEntries(sceneBuildInput) {
    if (!sceneBuildInput || typeof sceneBuildInput !== "object") {
        return undefined;
    }
    const mapBytesProvider = sceneBuildInput.mapBytesProvider;
    if (!mapBytesProvider) {
        return undefined;
    }
    const bounds = computeSceneBuildMapBounds(
        sceneBuildInput.baseX | 0,
        sceneBuildInput.baseY | 0,
        sceneBuildInput.sizeX | 0,
        sceneBuildInput.sizeY | 0,
    );

    const entries = [];
    for (let mapX = bounds.mapStartX; mapX < bounds.mapEndX; mapX++) {
        for (let mapY = bounds.mapStartY; mapY < bounds.mapEndY; mapY++) {
            const terrainBytes = mapBytesProvider.getTerrainBytes(mapX, mapY);
            const locBytes = mapBytesProvider.getLocBytes(mapX, mapY);
            const npcBytes =
                typeof mapBytesProvider.getNpcSpawnBytes === "function"
                    ? mapBytesProvider.getNpcSpawnBytes(mapX, mapY)
                    : undefined;
            if (!terrainBytes && !locBytes && !npcBytes) {
                continue;
            }
            entries.push({
                mapX,
                mapY,
                terrainBytes,
                locBytes,
                npcBytes,
            });
        }
    }
    return entries;
}

function normalizeTickStateKey(stateKey) {
    const key = stateKey | 0;
    if (!Number.isFinite(key) || key < 0) {
        return undefined;
    }
    return key;
}

function getRuntimeTickOutputsForHandle(runtimeHandle, create) {
    const handle = runtimeHandle | 0;
    let byHandle = runtimeTickOutputByHandle.get(handle);
    if (!byHandle && create) {
        byHandle = new Map();
        runtimeTickOutputByHandle.set(handle, byHandle);
    }
    return byHandle;
}

function getRuntimeCacheUploadState(runtimeHandle, create) {
    const handle = runtimeHandle | 0;
    let state = runtimeCacheUploadByHandle.get(handle);
    if (!state && create) {
        state = {
            typeCacheKey: "",
            typeEntryIdsByKind: new Map(),
            mapSquareKeys: new Set(),
        };
        runtimeCacheUploadByHandle.set(handle, state);
    }
    return state;
}

function clearRuntimeCacheUploadState(runtimeHandle) {
    runtimeCacheUploadByHandle.delete(runtimeHandle | 0);
}

function createTickOutputRefs(input) {
    return {
        locFrameIds: input.locFrameIds,
        locCycleStartsFixed: input.locCycleStartsFixed,
        locOutActiveFlags: input.locOutActiveFlags,
        outLocPatchesPacked: input.outLocPatchesPacked,
        outLocAlphaPatchesPacked: input.outLocAlphaPatchesPacked,
        outLocLodPatchesPacked: input.outLocLodPatchesPacked,
        outLocLodAlphaPatchesPacked: input.outLocLodAlphaPatchesPacked,
        outLocInteractPatchesPacked: input.outLocInteractPatchesPacked,
        outLocInteractAlphaPatchesPacked: input.outLocInteractAlphaPatchesPacked,
        outLocInteractLodPatchesPacked: input.outLocInteractLodPatchesPacked,
        outLocInteractLodAlphaPatchesPacked: input.outLocInteractLodAlphaPatchesPacked,
        npcX: input.npcX,
        npcY: input.npcY,
        npcOrientation: input.npcOrientation,
        npcRotation: input.npcRotation,
        npcPathLength: input.npcPathLength,
        npcMovementSeqId: input.npcMovementSeqId,
        npcFrameIds: input.npcFrameIds,
        npcFrameTicks: input.npcFrameTicks,
        npcMovementLoops: input.npcMovementLoops,
        outNpcPatchesPacked: input.outNpcPatchesPacked,
        outNpcAlphaPatchesPacked: input.outNpcAlphaPatchesPacked,
    };
}

const RUNTIME_TICK_PACKED_FIELDS_GETTERS = [
    (i) => i.locFrameIds,
    (i) => i.locCycleStartsFixed,
    (i) => i.locFrameSteps,
    (i) => i.locHasAnimMaya,
    (i) => i.locAnimMayaDurations,
    (i) => i.locFrameLengthOffsets,
    (i) => i.locFrameLengthCounts,
    (i) => i.locFrameLengthsPacked,
    (i) => i.locDrawRangeIndicesBase,
    (i) => i.locAnimFrameOffsetsBase,
    (i) => i.locAnimFrameCountsBase,
    (i) => i.locAnimFramesBasePacked,
    (i) => i.locDrawRangeIndicesAlpha,
    (i) => i.locDrawRangeIndicesLod,
    (i) => i.locDrawRangeIndicesLodAlpha,
    (i) => i.locDrawRangeIndicesInteract,
    (i) => i.locDrawRangeIndicesInteractAlpha,
    (i) => i.locDrawRangeIndicesInteractLod,
    (i) => i.locDrawRangeIndicesInteractLodAlpha,
    (i) => i.locAnimFrameOffsetsAlpha,
    (i) => i.locAnimFrameCountsAlpha,
    (i) => i.locAnimFramesAlphaPacked,
    (i) => i.npcX,
    (i) => i.npcY,
    (i) => i.npcOrientation,
    (i) => i.npcRotation,
    (i) => i.npcPathLength,
    (i) => i.npcMovementSeqId,
    (i) => i.npcPathXPacked,
    (i) => i.npcPathYPacked,
    (i) => i.npcPathMovementTypePacked,
    (i) => i.npcSize,
    (i) => i.npcIsClickable,
    (i) => i.npcRotationSpeed,
    (i) => i.npcIdleSeqId,
    (i) => i.npcWalkSeqId,
    (i) => i.npcHasWalkAnim,
    (i) => i.npcFrameIds,
    (i) => i.npcFrameTicks,
    (i) => i.npcMovementLoops,
    (i) => i.npcIdleSeqValid,
    (i) => i.npcIdleSeqHasAnimMaya,
    (i) => i.npcIdleSeqAnimMayaDurations,
    (i) => i.npcIdleSeqFrameSteps,
    (i) => i.npcIdleSeqLooping,
    (i) => i.npcIdleSeqMaxLoops,
    (i) => i.npcIdleSeqFrameIdCounts,
    (i) => i.npcIdleSeqFrameLengthOffsets,
    (i) => i.npcIdleSeqFrameLengthCounts,
    (i) => i.npcWalkSeqValid,
    (i) => i.npcWalkSeqHasAnimMaya,
    (i) => i.npcWalkSeqAnimMayaDurations,
    (i) => i.npcWalkSeqFrameSteps,
    (i) => i.npcWalkSeqLooping,
    (i) => i.npcWalkSeqMaxLoops,
    (i) => i.npcWalkSeqFrameIdCounts,
    (i) => i.npcWalkSeqFrameLengthOffsets,
    (i) => i.npcWalkSeqFrameLengthCounts,
    (i) => i.npcSeqFrameLengthsPacked,
    (i) => i.npcDrawRangeIndices,
    (i) => i.npcIdleAnimFrameOffsetsBase,
    (i) => i.npcIdleAnimFrameCountsBase,
    (i) => i.npcWalkAnimFrameOffsetsBase,
    (i) => i.npcWalkAnimFrameCountsBase,
    (i) => i.npcAnimFramesBasePacked,
    (i) => i.npcIdleAnimFrameOffsetsAlpha,
    (i) => i.npcIdleAnimFrameCountsAlpha,
    (i) => i.npcWalkAnimFrameOffsetsAlpha,
    (i) => i.npcWalkAnimFrameCountsAlpha,
    (i) => i.npcAnimFramesAlphaPacked,
];

let tickStateDebugLogCount = 0;
const MAX_TICK_STATE_DEBUG_LOGS = 20;

function logTickStateDebug(message, extra) {
    if (tickStateDebugLogCount >= MAX_TICK_STATE_DEBUG_LOGS) {
        return;
    }
    tickStateDebugLogCount++;
    console.warn(`[map-render-backend][tick-state] ${message}`, extra);
}

function validateTickStateInput(input) {
    if (!input || typeof input !== "object") {
        logTickStateDebug("invalid input object", { inputType: typeof input });
        return false;
    }

    const arrayFields = [
        "locFrameIds","locCycleStartsFixed","locFrameSteps","locHasAnimMaya","locAnimMayaDurations",
        "locFrameLengthOffsets","locFrameLengthCounts","locFrameLengthsPacked","locOutActiveFlags",
        "locDrawRangeIndicesBase","locAnimFrameOffsetsBase","locAnimFrameCountsBase","locAnimFramesBasePacked",
        "outLocPatchesPacked","locDrawRangeIndicesAlpha","locDrawRangeIndicesLod","locDrawRangeIndicesLodAlpha",
        "locDrawRangeIndicesInteract","locDrawRangeIndicesInteractAlpha","locDrawRangeIndicesInteractLod",
        "locDrawRangeIndicesInteractLodAlpha","locAnimFrameOffsetsAlpha","locAnimFrameCountsAlpha",
        "locAnimFramesAlphaPacked","outLocAlphaPatchesPacked","outLocLodPatchesPacked",
        "outLocLodAlphaPatchesPacked","outLocInteractPatchesPacked","outLocInteractAlphaPatchesPacked",
        "outLocInteractLodPatchesPacked","outLocInteractLodAlphaPatchesPacked",
        "npcX","npcY","npcOrientation","npcRotation","npcPathLength","npcMovementSeqId",
        "npcPathXPacked","npcPathYPacked","npcPathMovementTypePacked","npcSize","npcIsClickable",
        "npcRotationSpeed","npcIdleSeqId","npcWalkSeqId","npcHasWalkAnim","npcFrameIds","npcFrameTicks",
        "npcMovementLoops","npcIdleSeqValid","npcIdleSeqHasAnimMaya","npcIdleSeqAnimMayaDurations",
        "npcIdleSeqFrameSteps","npcIdleSeqLooping","npcIdleSeqMaxLoops","npcIdleSeqFrameIdCounts",
        "npcIdleSeqFrameLengthOffsets","npcIdleSeqFrameLengthCounts","npcWalkSeqValid","npcWalkSeqHasAnimMaya",
        "npcWalkSeqAnimMayaDurations","npcWalkSeqFrameSteps","npcWalkSeqLooping","npcWalkSeqMaxLoops",
        "npcWalkSeqFrameIdCounts","npcWalkSeqFrameLengthOffsets","npcWalkSeqFrameLengthCounts",
        "npcSeqFrameLengthsPacked","npcDrawRangeIndices","npcIdleAnimFrameOffsetsBase",
        "npcIdleAnimFrameCountsBase","npcWalkAnimFrameOffsetsBase","npcWalkAnimFrameCountsBase",
        "npcAnimFramesBasePacked","outNpcPatchesPacked","npcIdleAnimFrameOffsetsAlpha",
        "npcIdleAnimFrameCountsAlpha","npcWalkAnimFrameOffsetsAlpha","npcWalkAnimFrameCountsAlpha",
        "npcAnimFramesAlphaPacked","outNpcAlphaPatchesPacked",
    ];

    const badTypes = [];
    for (const name of arrayFields) {
        if (!(input[name] instanceof Int32Array)) {
            badTypes.push({ name, type: Object.prototype.toString.call(input[name]) });
        }
    }
    if (!Number.isFinite(input.npcNullAlphaFrameOffset)) {
        badTypes.push({ name: "npcNullAlphaFrameOffset", type: typeof input.npcNullAlphaFrameOffset });
    }
    if (badTypes.length > 0) {
        logTickStateDebug("type validation failed", {
            badTypes: badTypes.slice(0, 10),
            badTypeCount: badTypes.length,
        });
        return false;
    }

    const locCount = input.locFrameIds.length | 0;
    const npcCount = input.npcX.length | 0;
    const hasCompactLocSeqIds =
        input.locSeqIds instanceof Int32Array && input.locSeqIds.length === locCount;

    const expectedLocEqual = [
        "locCycleStartsFixed","locDrawRangeIndicesBase","locAnimFrameOffsetsBase","locAnimFrameCountsBase",
        "locDrawRangeIndicesAlpha","locDrawRangeIndicesLod","locDrawRangeIndicesLodAlpha",
        "locDrawRangeIndicesInteract","locDrawRangeIndicesInteractAlpha","locDrawRangeIndicesInteractLod",
        "locDrawRangeIndicesInteractLodAlpha","locAnimFrameOffsetsAlpha","locAnimFrameCountsAlpha",
    ];
    if (!hasCompactLocSeqIds) {
        expectedLocEqual.push(
            "locFrameSteps","locHasAnimMaya","locAnimMayaDurations","locFrameLengthOffsets","locFrameLengthCounts",
        );
    }

    const expectedNpcEqual = [
        "npcY","npcOrientation","npcRotation","npcPathLength","npcMovementSeqId","npcSize","npcIsClickable",
        "npcRotationSpeed","npcIdleSeqId","npcWalkSeqId","npcHasWalkAnim","npcFrameIds","npcFrameTicks",
        "npcMovementLoops","npcIdleSeqValid","npcIdleSeqHasAnimMaya","npcIdleSeqAnimMayaDurations",
        "npcIdleSeqFrameSteps","npcIdleSeqLooping","npcIdleSeqMaxLoops","npcIdleSeqFrameIdCounts",
        "npcIdleSeqFrameLengthOffsets","npcIdleSeqFrameLengthCounts","npcWalkSeqValid","npcWalkSeqHasAnimMaya",
        "npcWalkSeqAnimMayaDurations","npcWalkSeqFrameSteps","npcWalkSeqLooping","npcWalkSeqMaxLoops",
        "npcWalkSeqFrameIdCounts","npcWalkSeqFrameLengthOffsets","npcWalkSeqFrameLengthCounts",
        "npcDrawRangeIndices","npcIdleAnimFrameOffsetsBase","npcIdleAnimFrameCountsBase",
        "npcWalkAnimFrameOffsetsBase","npcWalkAnimFrameCountsBase","npcIdleAnimFrameOffsetsAlpha",
        "npcIdleAnimFrameCountsAlpha","npcWalkAnimFrameOffsetsAlpha","npcWalkAnimFrameCountsAlpha",
    ];

    const lengthIssues = [];
    for (const name of expectedLocEqual) {
        const got = input[name].length | 0;
        if (got !== locCount) {
            lengthIssues.push({ name, expected: locCount, got });
        }
    }
    if ((input.locOutActiveFlags.length | 0) < locCount) {
        lengthIssues.push({ name: "locOutActiveFlags", expectedMin: locCount, got: input.locOutActiveFlags.length | 0 });
    }
    for (const name of expectedNpcEqual) {
        const got = input[name].length | 0;
        if (got !== npcCount) {
            lengthIssues.push({ name, expected: npcCount, got });
        }
    }

    const expectedPath = npcCount * 10;
    if ((input.npcPathXPacked.length | 0) !== expectedPath) {
        lengthIssues.push({ name: "npcPathXPacked", expected: expectedPath, got: input.npcPathXPacked.length | 0 });
    }
    if ((input.npcPathYPacked.length | 0) !== expectedPath) {
        lengthIssues.push({ name: "npcPathYPacked", expected: expectedPath, got: input.npcPathYPacked.length | 0 });
    }
    if ((input.npcPathMovementTypePacked.length | 0) !== expectedPath) {
        lengthIssues.push({ name: "npcPathMovementTypePacked", expected: expectedPath, got: input.npcPathMovementTypePacked.length | 0 });
    }

    if (lengthIssues.length > 0) {
        logTickStateDebug("length validation failed", {
            locCount,
            npcCount,
            hasCompactLocSeqIds,
            issues: lengthIssues.slice(0, 15),
            issueCount: lengthIssues.length,
        });
        return false;
    }

    return true;
}

function diagnosePackedTickStateAgainstCppContract(packed) {
    if (!(packed instanceof Int32Array) || packed.length < 3) {
        return { ok: false, reason: "packed_too_small" };
    }
    const version = packed[0] | 0;
    const fieldCount = packed[1] | 0;
    if (version !== RUNTIME_TICK_STATE_PACKED_VERSION || fieldCount !== RUNTIME_TICK_STATE_FIELD_COUNT) {
        return {
            ok: false,
            reason: "header_mismatch",
            version,
            fieldCount,
            expectedVersion: RUNTIME_TICK_STATE_PACKED_VERSION,
            expectedFieldCount: RUNTIME_TICK_STATE_FIELD_COUNT,
        };
    }
    const headerInts = 3 + fieldCount;
    if (packed.length < headerInts) {
        return { ok: false, reason: "packed_short_header", packedLength: packed.length | 0, headerInts };
    }
    const lengths = packed.subarray(3, 3 + fieldCount);
    let total = 0;
    for (let i = 0; i < lengths.length; i++) {
        const len = lengths[i] | 0;
        if (len < 0) {
            return { ok: false, reason: "negative_length", index: i, len };
        }
        total += len;
        if ((total | 0) < 0) {
            return { ok: false, reason: "length_overflow", index: i, total };
        }
    }
    if (((headerInts + total) | 0) !== (packed.length | 0)) {
        return {
            ok: false,
            reason: "header_total_mismatch",
            headerInts,
            total,
            packedLength: packed.length | 0,
        };
    }
    const locCount = lengths[0] | 0;
    const npcCount = lengths[22] | 0;
    const expectEq = (index, expected, name) => {
        const got = lengths[index] | 0;
        if (got !== expected) {
            return { ok: false, reason: "length_eq_mismatch", index, name, expected, got };
        }
        return undefined;
    };

    const locEq = [
        [1,"locCycleStartsFixed"],[2,"locFrameSteps"],[3,"locHasAnimMaya"],[4,"locAnimMayaDurations"],
        [5,"locFrameLengthOffsets"],[6,"locFrameLengthCounts"],[8,"locDrawRangeIndicesBase"],
        [9,"locAnimFrameOffsetsBase"],[10,"locAnimFrameCountsBase"],[12,"locDrawRangeIndicesAlpha"],
        [13,"locDrawRangeIndicesLod"],[14,"locDrawRangeIndicesLodAlpha"],[15,"locDrawRangeIndicesInteract"],
        [16,"locDrawRangeIndicesInteractAlpha"],[17,"locDrawRangeIndicesInteractLod"],
        [18,"locDrawRangeIndicesInteractLodAlpha"],[19,"locAnimFrameOffsetsAlpha"],[20,"locAnimFrameCountsAlpha"],
    ];
    for (const [i,name] of locEq) {
        const r = expectEq(i, locCount, name);
        if (r) return r;
    }

    const npcEq = [
        [23,"npcY"],[24,"npcOrientation"],[25,"npcRotation"],[26,"npcPathLength"],[27,"npcMovementSeqId"],
        [31,"npcSize"],[32,"npcIsClickable"],[33,"npcRotationSpeed"],[34,"npcIdleSeqId"],[35,"npcWalkSeqId"],
        [36,"npcHasWalkAnim"],[37,"npcFrameIds"],[38,"npcFrameTicks"],[39,"npcMovementLoops"],
        [40,"npcIdleSeqValid"],[41,"npcIdleSeqHasAnimMaya"],[42,"npcIdleSeqAnimMayaDurations"],
        [43,"npcIdleSeqFrameSteps"],[44,"npcIdleSeqLooping"],[45,"npcIdleSeqMaxLoops"],
        [46,"npcIdleSeqFrameIdCounts"],[47,"npcIdleSeqFrameLengthOffsets"],[48,"npcIdleSeqFrameLengthCounts"],
        [49,"npcWalkSeqValid"],[50,"npcWalkSeqHasAnimMaya"],[51,"npcWalkSeqAnimMayaDurations"],
        [52,"npcWalkSeqFrameSteps"],[53,"npcWalkSeqLooping"],[54,"npcWalkSeqMaxLoops"],
        [55,"npcWalkSeqFrameIdCounts"],[56,"npcWalkSeqFrameLengthOffsets"],[57,"npcWalkSeqFrameLengthCounts"],
        [59,"npcDrawRangeIndices"],[60,"npcIdleAnimFrameOffsetsBase"],[61,"npcIdleAnimFrameCountsBase"],
        [62,"npcWalkAnimFrameOffsetsBase"],[63,"npcWalkAnimFrameCountsBase"],[65,"npcIdleAnimFrameOffsetsAlpha"],
        [66,"npcIdleAnimFrameCountsAlpha"],[67,"npcWalkAnimFrameOffsetsAlpha"],[68,"npcWalkAnimFrameCountsAlpha"],
    ];
    for (const [i,name] of npcEq) {
        const r = expectEq(i, npcCount, name);
        if (r) return r;
    }

    const expectedPathPacked = (npcCount * 10) | 0;
    for (const [i,name] of [[28,"npcPathXPacked"],[29,"npcPathYPacked"],[30,"npcPathMovementTypePacked"]]) {
        const got = lengths[i] | 0;
        if (got !== expectedPathPacked) {
            return {
                ok: false,
                reason: "path_len_mismatch",
                index: i,
                name,
                expected: expectedPathPacked,
                got,
                npcCount,
            };
        }
    }

    return { ok: true, locCount, npcCount, packedLength: packed.length | 0 };
}

function packRuntimeTickStateInput(input) {
    const fields = RUNTIME_TICK_PACKED_FIELDS_GETTERS.map((getter) => getter(input));
    if (fields.length !== RUNTIME_TICK_STATE_FIELD_COUNT) {
        return undefined;
    }
    const locSeqIds = input.locSeqIds instanceof Int32Array ? input.locSeqIds : undefined;
    const useCompactLocSeq = false;
    const empty = new Int32Array(0);
    if (useCompactLocSeq) {
        fields[TICK_FIELD_LOC_FRAME_STEPS] = empty;
        fields[TICK_FIELD_LOC_HAS_ANIM_MAYA] = empty;
        fields[TICK_FIELD_LOC_ANIM_MAYA_DURATIONS] = empty;
        fields[TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS] = empty;
        fields[TICK_FIELD_LOC_FRAME_LENGTH_COUNTS] = empty;
        fields[TICK_FIELD_LOC_FRAME_LENGTHS_PACKED] = empty;
    }
    const packedFieldCount = RUNTIME_TICK_STATE_FIELD_COUNT + (useCompactLocSeq ? 1 : 0);
    let totalLength = 3 + packedFieldCount;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!(field instanceof Int32Array)) {
            return undefined;
        }
        totalLength += field.length | 0;
    }
    if (useCompactLocSeq) {
        totalLength += locSeqIds.length | 0;
    }
    const packed = new Int32Array(totalLength);
    packed[0] = useCompactLocSeq
        ? RUNTIME_TICK_STATE_PACKED_VERSION_V2_COMPACT
        : RUNTIME_TICK_STATE_PACKED_VERSION;
    packed[1] = packedFieldCount;
    packed[2] = input.npcNullAlphaFrameOffset | 0;

    let lengthsOffset = 3;
    let dataOffset = 3 + packedFieldCount;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        packed[lengthsOffset++] = field.length | 0;
        packed.set(field, dataOffset);
        dataOffset += field.length | 0;
    }
    if (useCompactLocSeq) {
        packed[lengthsOffset++] = locSeqIds.length | 0;
        packed.set(locSeqIds, dataOffset);
        dataOffset += locSeqIds.length | 0;
    }
    if (dataOffset !== totalLength) {
        return undefined;
    }
    return packed;
}

function isMapRenderRuntimeHandleValid(runtimeHandle) {
    const backendModule = backendModuleInstance;
    if (!backendModule) {
        return false;
    }
    const isValidExport = getRuntimeIsValidExport(backendModule);
    if (typeof isValidExport !== "function") {
        return false;
    }
    return (isValidExport(runtimeHandle | 0) | 0) === 1;
}

function setRuntimeTickStateWithWasm(backendModule, runtimeHandle, stateKey, input) {
    if ((backendModule.__rsCapabilities & CAP_RUNTIME_STATE) === 0) {
        logTickStateDebug("runtime state capability missing", {
            runtimeHandle: runtimeHandle | 0,
            stateKey,
            capabilities: backendModule.__rsCapabilities | 0,
        });
        return false;
    }
    const key = normalizeTickStateKey(stateKey);
    if (key === undefined) {
        logTickStateDebug("invalid state key", { runtimeHandle: runtimeHandle | 0, stateKey });
        return false;
    }
    if (!validateTickStateInput(input)) {
        logTickStateDebug("validateTickStateInput returned false", {
            runtimeHandle: runtimeHandle | 0,
            stateKey: key,
            runtimeValid: isMapRenderRuntimeHandleValid(runtimeHandle | 0),
        });
        return false;
    }
    const setTickStatePacked = getRuntimeSetTickStatePackedExport(backendModule);
    if (typeof setTickStatePacked !== "function") {
        logTickStateDebug("set_tick_state_packed export missing", {
            runtimeHandle: runtimeHandle | 0,
            stateKey: key,
        });
        return false;
    }
    const trySetPacked = (packed) => {
        if (!(packed instanceof Int32Array) || packed.length <= 0) {
            logTickStateDebug("packed tick state missing/empty", {
                runtimeHandle: runtimeHandle | 0,
                stateKey: key,
                packedType: Object.prototype.toString.call(packed),
                packedLength: packed?.length,
            });
            return false;
        }
        const packedPtr = mallocI32AndCopy(backendModule, packed);
        if (!packedPtr) {
            logTickStateDebug("mallocI32AndCopy failed for packed tick state", {
                runtimeHandle: runtimeHandle | 0,
                stateKey: key,
                packedLength: packed.length | 0,
            });
            return false;
        }
        try {
            const raw = setTickStatePacked(
                runtimeHandle | 0,
                key,
                packedPtr,
                packed.length | 0,
            ) | 0;
            if (raw !== 1) {
                const diagnostic = diagnosePackedTickStateAgainstCppContract(packed);
                logTickStateDebug("set_tick_state_packed returned failure", {
                    runtimeHandle: runtimeHandle | 0,
                    stateKey: key,
                    packedLength: packed.length | 0,
                    packedVersion: packed[0] | 0,
                    packedFieldCount: packed[1] | 0,
                    runtimeValid: isMapRenderRuntimeHandleValid(runtimeHandle | 0),
                    raw,
                    diagnostic,
                });
                return false;
            }
            return true;
        } finally {
            backendModule._free(packedPtr);
        }
    };
    const packed = packRuntimeTickStateInput(input);
    const ok = trySetPacked(packed);
    if (!ok) {
        return false;
    }
    const byHandle = getRuntimeTickOutputsForHandle(runtimeHandle | 0, true);
    byHandle.set(key, createTickOutputRefs(input));
    return true;
}

function clearRuntimeTickStateWithWasm(backendModule, runtimeHandle, stateKey) {
    if ((backendModule.__rsCapabilities & CAP_RUNTIME_STATE) === 0) {
        return;
    }
    const key = normalizeTickStateKey(stateKey);
    if (key === undefined) {
        return;
    }
    const clearTickState = getRuntimeClearTickStateExport(backendModule);
    if (typeof clearTickState === "function") {
        clearTickState(runtimeHandle | 0, key);
    }
    const byHandle = getRuntimeTickOutputsForHandle(runtimeHandle | 0, false);
    byHandle?.delete(key);
}

function tickRuntimeStateForOutputRefsWithWasm(
    backendModule,
    runtimeHandle,
    stateKey,
    cycleNowFixed,
    clientTickCount,
    outputRefs,
) {
    if ((backendModule.__rsCapabilities & CAP_RUNTIME_STATE) === 0) {
        return undefined;
    }
    const tickForStatePacked = getRuntimeTickForStatePackedExport(backendModule);
    if (typeof tickForStatePacked !== "function") {
        return undefined;
    }
    const locCount = outputRefs.locFrameIds.length | 0;
    const npcCount = outputRefs.npcX.length | 0;
    const maxPackedLength = 13 + locCount * 35 + npcCount * 17;
    const outPackedPtr = mallocI32(backendModule, maxPackedLength);
    if (maxPackedLength > 0 && !outPackedPtr) {
        return undefined;
    }
    try {
        const written = tickForStatePacked(
            runtimeHandle | 0,
            stateKey | 0,
            cycleNowFixed | 0,
            clientTickCount | 0,
            outPackedPtr,
            maxPackedLength | 0,
        );
        if ((written | 0) <= 0 || written > maxPackedLength) {
            return undefined;
        }
        const packed = backendModule.HEAP32.subarray(outPackedPtr >> 2, (outPackedPtr >> 2) + written);
        let cursor = 0;
        const version = packed[cursor++] | 0;
        if (version !== RUNTIME_TICK_OUTPUT_PACKED_VERSION) {
            return undefined;
        }
        const locBasePatchCount = packed[cursor++] | 0;
        const locAlphaPatchCount = packed[cursor++] | 0;
        const locLodPatchCount = packed[cursor++] | 0;
        const locLodAlphaPatchCount = packed[cursor++] | 0;
        const locInteractPatchCount = packed[cursor++] | 0;
        const locInteractAlphaPatchCount = packed[cursor++] | 0;
        const locInteractLodPatchCount = packed[cursor++] | 0;
        const locInteractLodAlphaPatchCount = packed[cursor++] | 0;
        const npcBasePatchCount = packed[cursor++] | 0;
        const npcAlphaPatchCount = packed[cursor++] | 0;
        const packedLocCount = packed[cursor++] | 0;
        const packedNpcCount = packed[cursor++] | 0;
        if (packedLocCount !== locCount || packedNpcCount !== npcCount) {
            return undefined;
        }
        if (
            locBasePatchCount < 0 ||
            locAlphaPatchCount < 0 ||
            locLodPatchCount < 0 ||
            locLodAlphaPatchCount < 0 ||
            locInteractPatchCount < 0 ||
            locInteractAlphaPatchCount < 0 ||
            locInteractLodPatchCount < 0 ||
            locInteractLodAlphaPatchCount < 0 ||
            npcBasePatchCount < 0 ||
            npcAlphaPatchCount < 0 ||
            locBasePatchCount > locCount ||
            locAlphaPatchCount > locCount ||
            locLodPatchCount > locCount ||
            locLodAlphaPatchCount > locCount ||
            locInteractPatchCount > locCount ||
            locInteractAlphaPatchCount > locCount ||
            locInteractLodPatchCount > locCount ||
            locInteractLodAlphaPatchCount > locCount ||
            npcBasePatchCount > npcCount ||
            npcAlphaPatchCount > npcCount
        ) {
            return undefined;
        }

        const copyExact = (dst, len) => {
            if ((dst.length | 0) !== (len | 0)) {
                return false;
            }
            if (cursor + len > packed.length) {
                return false;
            }
            if (len > 0) {
                dst.set(packed.subarray(cursor, cursor + len));
            }
            cursor += len;
            return true;
        };
        const copyPrefix = (dst, len) => {
            if ((dst.length | 0) < (len | 0)) {
                return false;
            }
            if (cursor + len > packed.length) {
                return false;
            }
            if (len > 0) {
                dst.set(packed.subarray(cursor, cursor + len), 0);
            }
            cursor += len;
            return true;
        };

        if (
            !copyExact(outputRefs.locFrameIds, locCount) ||
            !copyExact(outputRefs.locCycleStartsFixed, locCount) ||
            !copyExact(outputRefs.locOutActiveFlags, locCount) ||
            !copyExact(outputRefs.npcX, npcCount) ||
            !copyExact(outputRefs.npcY, npcCount) ||
            !copyExact(outputRefs.npcOrientation, npcCount) ||
            !copyExact(outputRefs.npcRotation, npcCount) ||
            !copyExact(outputRefs.npcPathLength, npcCount) ||
            !copyExact(outputRefs.npcMovementSeqId, npcCount) ||
            !copyExact(outputRefs.npcFrameIds, npcCount) ||
            !copyExact(outputRefs.npcFrameTicks, npcCount) ||
            !copyExact(outputRefs.npcMovementLoops, npcCount) ||
            !copyPrefix(outputRefs.outLocPatchesPacked, locBasePatchCount * 4) ||
            !copyPrefix(outputRefs.outLocAlphaPatchesPacked, locAlphaPatchCount * 4) ||
            !copyPrefix(outputRefs.outLocLodPatchesPacked, locLodPatchCount * 4) ||
            !copyPrefix(outputRefs.outLocLodAlphaPatchesPacked, locLodAlphaPatchCount * 4) ||
            !copyPrefix(outputRefs.outLocInteractPatchesPacked, locInteractPatchCount * 4) ||
            !copyPrefix(outputRefs.outLocInteractAlphaPatchesPacked, locInteractAlphaPatchCount * 4) ||
            !copyPrefix(outputRefs.outLocInteractLodPatchesPacked, locInteractLodPatchCount * 4) ||
            !copyPrefix(
                outputRefs.outLocInteractLodAlphaPatchesPacked,
                locInteractLodAlphaPatchCount * 4,
            ) ||
            !copyPrefix(outputRefs.outNpcPatchesPacked, npcBasePatchCount * 4) ||
            !copyPrefix(outputRefs.outNpcAlphaPatchesPacked, npcAlphaPatchCount * 4)
        ) {
            return undefined;
        }
        if (cursor !== packed.length) {
            return undefined;
        }

        return {
            locBasePatchCount,
            locAlphaPatchCount,
            locLodPatchCount,
            locLodAlphaPatchCount,
            locInteractPatchCount,
            locInteractAlphaPatchCount,
            locInteractLodPatchCount,
            locInteractLodAlphaPatchCount,
            npcBasePatchCount,
            npcAlphaPatchCount,
        };
    } finally {
        if (outPackedPtr) {
            backendModule._free(outPackedPtr);
        }
    }
}

function flattenFlagsLevel1(tileRenderFlagsLevel1) {
    if (!Array.isArray(tileRenderFlagsLevel1) || tileRenderFlagsLevel1.length === 0) {
        return undefined;
    }
    const flagsWidth = tileRenderFlagsLevel1[0]?.length | 0;
    if (flagsWidth <= 0) {
        return undefined;
    }
    const flagsColumns = tileRenderFlagsLevel1.length | 0;
    const flat = new Uint8Array(flagsColumns * flagsWidth);
    for (let x = 0; x < flagsColumns; x++) {
        const column = tileRenderFlagsLevel1[x];
        if (!(column instanceof Uint8Array) || column.length !== flagsWidth) {
            return undefined;
        }
        flat.set(column, x * flagsWidth);
    }
    return { flat, flagsWidth };
}

function decodeNpcSpawnsWithWasm(
    backendModule,
    tileRenderFlagsLevel1,
    borderSize,
    mapX,
    mapY,
    data,
    npcLoginScreenPropsById,
    requiredLoginScreenPropsMask,
) {
    if ((backendModule.__rsCapabilities & CAP_NPC_DECODE) === 0) {
        return undefined;
    }
    if (!(data instanceof Uint8Array)) {
        return undefined;
    }
    const flags = flattenFlagsLevel1(tileRenderFlagsLevel1);
    if (!flags) {
        return undefined;
    }

    const maxCount = data.length >>> 2;
    const outPackedInts = maxCount * 4;

    let loginScreenProps = undefined;
    if (npcLoginScreenPropsById !== undefined) {
        if (!(npcLoginScreenPropsById instanceof Uint8Array)) {
            return undefined;
        }
        loginScreenProps = npcLoginScreenPropsById;
    }
    const requiredMask = (requiredLoginScreenPropsMask ?? 0) | 0;

    const flagsPtr = backendModule._malloc(flags.flat.length);
    const dataPtr = backendModule._malloc(data.length);
    const loginScreenPropsPtr = loginScreenProps ? backendModule._malloc(loginScreenProps.length) : 0;
    const outPtr = backendModule._malloc(outPackedInts * 4);
    if (!flagsPtr || !dataPtr || !outPtr || (loginScreenProps && !loginScreenPropsPtr)) {
        if (flagsPtr) backendModule._free(flagsPtr);
        if (dataPtr) backendModule._free(dataPtr);
        if (loginScreenPropsPtr) backendModule._free(loginScreenPropsPtr);
        if (outPtr) backendModule._free(outPtr);
        return undefined;
    }

    try {
        backendModule.HEAPU8.set(flags.flat, flagsPtr);
        backendModule.HEAPU8.set(data, dataPtr);
        if (loginScreenProps) {
            backendModule.HEAPU8.set(loginScreenProps, loginScreenPropsPtr);
        }

        const count = backendModule._rs_decode_npc_spawns_from_bytes(
            flagsPtr,
            flags.flagsWidth | 0,
            flags.flat.length | 0,
            borderSize | 0,
            mapX | 0,
            mapY | 0,
            dataPtr,
            data.length | 0,
            loginScreenPropsPtr | 0,
            loginScreenProps ? loginScreenProps.length | 0 : 0,
            requiredMask,
            outPtr,
            outPackedInts | 0,
        );
        if ((count | 0) < 0 || count > maxCount) {
            return undefined;
        }
        const packed = backendModule.HEAP32.subarray(outPtr >> 2, (outPtr >> 2) + count * 4);
        const out = new Array(count);
        for (let i = 0; i < count; i++) {
            const off = i * 4;
            out[i] = {
                id: packed[off + 0] | 0,
                x: packed[off + 1] | 0,
                y: packed[off + 2] | 0,
                level: packed[off + 3] | 0,
            };
        }
        return out;
    } finally {
        backendModule._free(flagsPtr);
        backendModule._free(dataPtr);
        if (loginScreenPropsPtr) {
            backendModule._free(loginScreenPropsPtr);
        }
        backendModule._free(outPtr);
    }
}

function createRuntimeCacheBuildRequest(sceneBuildInput) {
    if (!sceneBuildInput || typeof sceneBuildInput !== "object") {
        return undefined;
    }
    const sizeX = sceneBuildInput.sizeX | 0;
    const sizeY = sceneBuildInput.sizeY | 0;
    if (sizeX <= 0 || sizeY <= 0) {
        return undefined;
    }
    const borderX = ((sizeX - MAP_SQUARE_SIZE) / 2) | 0;
    const borderY = ((sizeY - MAP_SQUARE_SIZE) / 2) | 0;
    if (
        borderX < 0 ||
        borderY < 0 ||
        borderX !== borderY ||
        sizeX !== MAP_SQUARE_SIZE + borderX * 2 ||
        sizeY !== MAP_SQUARE_SIZE + borderY * 2
    ) {
        return undefined;
    }
    const borderSize = borderX;
    const mapX = Math.floor(((sceneBuildInput.baseX | 0) + borderSize) / MAP_SQUARE_SIZE);
    const mapY = Math.floor(((sceneBuildInput.baseY | 0) + borderSize) / MAP_SQUARE_SIZE);
    return {
        mapX: mapX | 0,
        mapY: mapY | 0,
        borderSize,
        sizeX,
        sizeY,
        smoothTerrain: !!sceneBuildInput.smoothTerrain,
        locLoadType: sceneBuildInput.locLoadType | 0,
        minimizeDrawCalls: sceneBuildInput?.minimizeDrawCalls === true,
        loadLocs: sceneBuildInput?.loadLocs !== false,
        loadObjs: sceneBuildInput?.loadObjs !== false,
        loadNpcs: sceneBuildInput?.loadNpcs !== false,
    };
}

function normalizeRuntimeBuildRequest(request) {
    if (!request || typeof request !== "object") {
        return undefined;
    }
    const mapX = request.mapX | 0;
    const mapY = request.mapY | 0;
    const borderSize = request.borderSize | 0;
    const sizeX = request.sizeX | 0;
    const sizeY = request.sizeY | 0;
    if (sizeX <= 0 || sizeY <= 0 || borderSize < 0) {
        return undefined;
    }
    if (
        sizeX !== MAP_SQUARE_SIZE + borderSize * 2 ||
        sizeY !== MAP_SQUARE_SIZE + borderSize * 2
    ) {
        return undefined;
    }
    return {
        mapX,
        mapY,
        borderSize,
        sizeX,
        sizeY,
        smoothTerrain: !!request.smoothTerrain,
        locLoadType: request.locLoadType | 0,
        minimizeDrawCalls: request?.minimizeDrawCalls === true,
        loadLocs: request?.loadLocs !== false,
        loadObjs: request?.loadObjs !== false,
        loadNpcs: request?.loadNpcs !== false,
    };
}

function hasRuntimeTypeEntryApi(backendModule) {
    return (
        typeof getRuntimeCachePutTypeEntryExport(backendModule) === "function" &&
        typeof getRuntimeCacheClearTypeKindExport(backendModule) === "function"
    );
}

function getUploadedTypeIdSet(uploadState, kind, create) {
    if (!uploadState) {
        return undefined;
    }
    if (!(uploadState.typeEntryIdsByKind instanceof Map)) {
        if (!create) {
            return undefined;
        }
        uploadState.typeEntryIdsByKind = new Map();
    }
    let set = uploadState.typeEntryIdsByKind.get(kind | 0);
    if (!set && create) {
        set = new Set();
        uploadState.typeEntryIdsByKind.set(kind | 0, set);
    }
    return set;
}

function uploadTypeEntriesFromIdsWithByteGetter(
    backendModule,
    runtimeHandle,
    kind,
    ids,
    tryGetBytes,
    options,
) {
    if (typeof tryGetBytes !== "function") {
        return false;
    }
    const uploadedIdsSet = options?.uploadedIdsSet instanceof Set ? options.uploadedIdsSet : undefined;
    const sortedIds = sortedUniqueTypeIds(ids);
    const allowEmptyBytes = options?.allowEmptyBytes === true;
    for (let i = 0; i < sortedIds.length; i++) {
        const id = sortedIds[i] | 0;
        if (uploadedIdsSet?.has(id)) {
            continue;
        }
        let bytes;
        try {
            bytes = toUint8ArrayView(tryGetBytes(id));
        } catch {
            bytes = undefined;
        }
        if (!bytes) {
            continue;
        }
        if (!allowEmptyBytes && (bytes.length | 0) <= 0) {
            continue;
        }
        const status = runtimeCachePutTypeEntryWithWasm(
            backendModule,
            runtimeHandle,
            kind,
            id,
            bytes,
        );
        if (status !== RUNTIME_STATUS_OK) {
            return false;
        }
        uploadedIdsSet?.add(id);
    }
    return true;
}

function uploadTypeEntriesFromLoaderIdsWithWasm(
    backendModule,
    runtimeHandle,
    kind,
    loader,
    ids,
    encodeFallback,
    options,
) {
    return uploadTypeEntriesFromIdsWithByteGetter(
        backendModule,
        runtimeHandle,
        kind,
        ids,
        (id) => {
            let bytes = tryLoadTypeBytes(loader, id);
            if (!bytes && encodeFallback && typeof loader?.tryLoad === "function") {
                let result;
                try {
                    result = loader.tryLoad(id | 0);
                } catch {
                    result = undefined;
                }
                if (result?.ok) {
                    bytes = encodeFallback(result.value);
                }
            }
            return bytes;
        },
        options,
    );
}

function uploadTypeEntriesFromPackWithWasm(
    backendModule,
    runtimeHandle,
    kind,
    pack,
    options,
) {
    const ids = pack?.ids;
    const offsets = pack?.offsets;
    const lengths = pack?.lengths;
    const bytes = pack?.bytes;
    if (
        !(ids instanceof Int32Array) ||
        !(offsets instanceof Int32Array) ||
        !(lengths instanceof Int32Array) ||
        !(bytes instanceof Uint8Array)
    ) {
        return false;
    }
    if (ids.length !== offsets.length || ids.length !== lengths.length) {
        return false;
    }
    const uploadedIdsSet = options?.uploadedIdsSet instanceof Set ? options.uploadedIdsSet : undefined;
    const allowEmptyBytes = options?.allowEmptyBytes === true;
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i] | 0;
        if (uploadedIdsSet?.has(id)) {
            continue;
        }
        const offset = offsets[i] | 0;
        const length = lengths[i] | 0;
        if (id < 0 || offset < 0 || length < 0) {
            return false;
        }
        if (offset > bytes.length || length > bytes.length - offset) {
            return false;
        }
        if (!allowEmptyBytes && length <= 0) {
            continue;
        }
        const entryBytes = length > 0 ? bytes.subarray(offset, offset + length) : new Uint8Array(0);
        const status = runtimeCachePutTypeEntryWithWasm(
            backendModule,
            runtimeHandle,
            kind,
            id,
            entryBytes,
        );
        if (status !== RUNTIME_STATUS_OK) {
            return false;
        }
        uploadedIdsSet?.add(id);
    }
    return true;
}

function uploadRuntimeTypesWithEntryApiWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
    uploadState,
) {
    const locTypeLoader = sceneBuildInput?.locTypeLoader;
    const locModelLoader = sceneBuildInput?.locModelLoader;
    const modelLoader = locModelLoader?.modelLoader;
    const objTypeLoader =
        sceneBuildInput?.objTypeLoader ??
        sceneBuildInput?.session?.loaders?.objTypeLoader;
    const textureLoader =
        sceneBuildInput?.textureLoader ??
        locModelLoader?.textureLoader ??
        sceneBuildInput?.session?.getTextureLoader?.();
    const seqTypeLoader =
        sceneBuildInput?.seqTypeLoader ??
        locModelLoader?.seqTypeLoader ??
        sceneBuildInput?.session?.loaders?.seqTypeLoader;
    const seqFrameLoader =
        sceneBuildInput?.seqFrameLoader ??
        locModelLoader?.seqFrameLoader ??
        sceneBuildInput?.session?.loaders?.seqFrameLoader;
    const skeletalSeqLoader =
        sceneBuildInput?.skeletalSeqLoader ??
        locModelLoader?.skeletalSeqLoader ??
        sceneBuildInput?.session?.getSkeletalSeqLoader?.() ??
        sceneBuildInput?.session?.loaders?.skeletalSeqLoader;
    const npcTypeLoader =
        sceneBuildInput?.npcTypeLoader ??
        sceneBuildInput?.session?.loaders?.npcTypeLoader;
    const basTypeLoader =
        sceneBuildInput?.basTypeLoader ??
        sceneBuildInput?.session?.loaders?.basTypeLoader;
    const underlayTypeLoader =
        sceneBuildInput?.underlayTypeLoader ??
        sceneBuildInput?.session?.loaders?.underlayTypeLoader;
    const overlayTypeLoader =
        sceneBuildInput?.overlayTypeLoader ??
        sceneBuildInput?.session?.loaders?.overlayTypeLoader;
    const varProvider = sceneBuildInput?.varProvider;
    const varbitLoader = tryGetVarbitLoader(varProvider);

    const locUploadedIds = getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_LOC_KIND, true);
    const objUploadedIds = getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_OBJ_KIND, true);
    const npcUploadedIds = getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_NPC_KIND, true);

    let requiredExpandedTypeIds = undefined;
    for (let pass = 0; pass < 8; pass++) {
        const expanded = runtimeCollectRequiredExpandedTypeIdsWithWasm(
            backendModule,
            runtimeHandle,
            sceneBuildInput,
        );
        if (!expanded) {
            return false;
        }
        requiredExpandedTypeIds = expanded;
        const beforeLoc = locUploadedIds?.size ?? 0;
        const beforeObj = objUploadedIds?.size ?? 0;
        const beforeNpc = npcUploadedIds?.size ?? 0;
        if (
            !uploadTypeEntriesFromLoaderIdsWithWasm(
                backendModule,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_LOC_KIND,
                locTypeLoader,
                expanded.locTypeIds,
                undefined,
                { uploadedIdsSet: locUploadedIds },
            )
        ) {
            return false;
        }
        if (
            !uploadTypeEntriesFromLoaderIdsWithWasm(
                backendModule,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_OBJ_KIND,
                objTypeLoader,
                expanded.objTypeIds,
                undefined,
                { uploadedIdsSet: objUploadedIds },
            )
        ) {
            return false;
        }
        if (
            !uploadTypeEntriesFromLoaderIdsWithWasm(
                backendModule,
                runtimeHandle,
                RUNTIME_TYPE_BLOB_NPC_KIND,
                npcTypeLoader,
                expanded.npcTypeIds,
                undefined,
                { uploadedIdsSet: npcUploadedIds },
            )
        ) {
            return false;
        }
        const changed =
            (locUploadedIds?.size ?? 0) !== beforeLoc ||
            (objUploadedIds?.size ?? 0) !== beforeObj ||
            (npcUploadedIds?.size ?? 0) !== beforeNpc;
        if (!changed) {
            break;
        }
    }

    const finalizedExpanded = runtimeCollectRequiredExpandedTypeIdsWithWasm(
        backendModule,
        runtimeHandle,
        sceneBuildInput,
    );
    if (!finalizedExpanded) {
        return false;
    }
    requiredExpandedTypeIds = finalizedExpanded;

    if (!requiredExpandedTypeIds) {
        return false;
    }
    const locTypeIds = requiredExpandedTypeIds.locTypeIds;
    const objTypeIds = requiredExpandedTypeIds.objTypeIds;
    const npcTypeIds = requiredExpandedTypeIds.npcTypeIds;
    const basTypeIds = requiredExpandedTypeIds.basTypeIds;
    const mergedModelIds = requiredExpandedTypeIds.modelIds;
    const sortedSeqIds = requiredExpandedTypeIds.seqTypeIds;
    const varbitIds = requiredExpandedTypeIds.varbitTypeIds;
    const underlayTypeIds = requiredExpandedTypeIds.underlayTypeIds;
    const overlayTypeIds = requiredExpandedTypeIds.overlayTypeIds;

    const seqFrameIds = [];
    const skeletalSeqIds = [];
    if (seqTypeLoader && typeof seqTypeLoader.tryLoad === "function") {
        for (let i = 0; i < sortedSeqIds.length; i++) {
            let seqResult;
            try {
                seqResult = seqTypeLoader.tryLoad(sortedSeqIds[i] | 0);
            } catch {
                seqResult = undefined;
            }
            if (!seqResult?.ok) {
                continue;
            }
            const animMayaId = seqResult.value?.animMayaId ?? -1;
            if ((animMayaId | 0) >= 0) {
                skeletalSeqIds.push(animMayaId | 0);
            }
            const frameIds = seqResult.value?.frameIds;
            if (!Array.isArray(frameIds)) {
                continue;
            }
            for (let f = 0; f < frameIds.length; f++) {
                const frameId = frameIds[f] | 0;
                if (frameId >= 0) {
                    seqFrameIds.push(frameId);
                }
            }
        }
    }

    const seqAlphaHintPack = buildSeqAlphaHintPack(
        sortedSeqIds,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
    );

    const skeletalSeqBytesById = new Map();
    const seqBaseIds = new Set();
    const sortedSkeletalSeqIds = sortedUniqueTypeIds(skeletalSeqIds);
    for (let i = 0; i < sortedSkeletalSeqIds.length; i++) {
        const id = sortedSkeletalSeqIds[i] | 0;
        const bytes = tryLoadSkeletalSeqBytesFromLoader(skeletalSeqLoader, id);
        if (!bytes || bytes.length < 3) {
            continue;
        }
        skeletalSeqBytesById.set(id, bytes);
        const baseId = readUnsignedShortBE(bytes, 1) | 0;
        if (baseId >= 0) {
            seqBaseIds.add(baseId);
        }
    }

    const transparentTextureIds = [];
    const sdTextureIds = [];
    if (
        textureLoader &&
        typeof textureLoader.getTextureIds === "function" &&
        typeof textureLoader.isSd === "function" &&
        typeof textureLoader.isTransparent === "function"
    ) {
        const allTextureIds = textureLoader.getTextureIds();
        if (Array.isArray(allTextureIds)) {
            for (let i = 0; i < allTextureIds.length; i++) {
                const textureId = allTextureIds[i] | 0;
                if (textureId < 0) {
                    continue;
                }
                if (textureLoader.isTransparent(textureId)) {
                    transparentTextureIds.push(textureId);
                }
                if (!textureLoader.isSd(textureId)) {
                    continue;
                }
                if (sdTextureIds.length < SD_TEXTURE_PACK_LIMIT) {
                    sdTextureIds.push(textureId);
                }
            }
        }
    }

    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_LOC_KIND,
            locTypeLoader,
            locTypeIds,
            undefined,
            { uploadedIdsSet: locUploadedIds },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_VARBIT_KIND,
            varbitLoader,
            varbitIds,
            encodeVarbitTypeBytes,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_VARBIT_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_MODEL_KIND,
            modelLoader,
            mergedModelIds,
            undefined,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_MODEL_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_OBJ_KIND,
            objTypeLoader,
            objTypeIds,
            undefined,
            { uploadedIdsSet: objUploadedIds },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND,
            seqTypeLoader,
            sortedSeqIds,
            undefined,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_SEQ_FRAME_KIND,
            seqFrameLoader,
            seqFrameIds,
            encodeSeqFrameBytes,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_SEQ_FRAME_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromPackWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_SEQ_ALPHA_HINT_KIND,
            seqAlphaHintPack,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_SEQ_ALPHA_HINT_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromIdsWithByteGetter(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_SEQ_BASE_KIND,
            Array.from(seqBaseIds),
            (id) => tryLoadSeqBaseBytesFromLoader(skeletalSeqLoader?.baseLoader ?? seqFrameLoader?.baseLoader, id | 0),
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_SEQ_BASE_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromIdsWithByteGetter(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_SKELETAL_SEQ_KIND,
            Array.from(skeletalSeqBytesById.keys()),
            (id) => skeletalSeqBytesById.get(id | 0),
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_SKELETAL_SEQ_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_NPC_KIND,
            npcTypeLoader,
            npcTypeIds,
            undefined,
            { uploadedIdsSet: npcUploadedIds },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_BAS_KIND,
            basTypeLoader,
            basTypeIds,
            undefined,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_BAS_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_UNDERLAY_KIND,
            underlayTypeLoader,
            underlayTypeIds,
            undefined,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_UNDERLAY_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromLoaderIdsWithWasm(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_OVERLAY_KIND,
            overlayTypeLoader,
            overlayTypeIds,
            undefined,
            { uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_OVERLAY_KIND, true) },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromIdsWithByteGetter(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_TEXTURE_TRANSPARENT_KIND,
            transparentTextureIds,
            () => new Uint8Array(0),
            {
                allowEmptyBytes: true,
                uploadedIdsSet: getUploadedTypeIdSet(
                    uploadState,
                    RUNTIME_TYPE_BLOB_TEXTURE_TRANSPARENT_KIND,
                    true,
                ),
            },
        )
    ) {
        return false;
    }
    if (
        !uploadTypeEntriesFromIdsWithByteGetter(
            backendModule,
            runtimeHandle,
            RUNTIME_TYPE_BLOB_TEXTURE_IDS_KIND,
            sdTextureIds,
            () => new Uint8Array(0),
            {
                allowEmptyBytes: true,
                uploadedIdsSet: getUploadedTypeIdSet(uploadState, RUNTIME_TYPE_BLOB_TEXTURE_IDS_KIND, true),
            },
        )
    ) {
        return false;
    }
    return true;
}

function uploadRuntimeMapSquaresAndObjSpawnsWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
    mapEntries,
    state,
) {
    const { objSpawnsByMap } = collectObjTypeAndModelIdsForSceneBuild(sceneBuildInput);
    const objSpawnStatus = uploadTypeEntriesFromPackWithWasm(
        backendModule,
        runtimeHandle,
        RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND,
        objSpawnsByMap,
        {
            uploadedIdsSet: getUploadedTypeIdSet(
                state,
                RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND,
                true,
            ),
        },
    )
        ? RUNTIME_STATUS_OK
        : -1;
    if (objSpawnStatus !== RUNTIME_STATUS_OK) {
        return false;
    }

    const clearMapSquaresStatus = runtimeCacheClearMapSquaresWithWasm(
        backendModule,
        runtimeHandle,
    );
    const nextMapSquareKeys = new Set();
    for (let i = 0; i < mapEntries.length; i++) {
        const entry = mapEntries[i];
        nextMapSquareKeys.add(`${entry.mapX | 0},${entry.mapY | 0}`);
    }

    if (clearMapSquaresStatus === RUNTIME_STATUS_OK) {
        if (mapEntries.length > 0) {
            const status = runtimeCachePutMapSquaresPackedWithWasm(
                backendModule,
                runtimeHandle,
                mapEntries,
            );
            if (status !== RUNTIME_STATUS_OK) {
                return false;
            }
        }
    } else if (clearMapSquaresStatus === undefined) {
        if (mapEntries.length > 0) {
            const status = runtimeCachePutMapSquaresPackedWithWasm(
                backendModule,
                runtimeHandle,
                mapEntries,
            );
            if (status !== RUNTIME_STATUS_OK) {
                return false;
            }
        }
        const clearEntries = [];
        for (const staleKey of state?.mapSquareKeys ?? []) {
            if (nextMapSquareKeys.has(staleKey)) {
                continue;
            }
            const comma = staleKey.indexOf(",");
            if (comma <= 0) {
                continue;
            }
            const mapX = Number.parseInt(staleKey.slice(0, comma), 10) | 0;
            const mapY = Number.parseInt(staleKey.slice(comma + 1), 10) | 0;
            clearEntries.push({ mapX, mapY });
        }
        if (clearEntries.length > 0) {
            const clearStatus = runtimeCachePutMapSquaresPackedWithWasm(
                backendModule,
                runtimeHandle,
                clearEntries,
            );
            if (clearStatus !== RUNTIME_STATUS_OK) {
                return false;
            }
        }
    } else {
        return false;
    }

    if (state) {
        state.mapSquareKeys = nextMapSquareKeys;
    }
    return true;
}

function getOrResetRuntimeUploadStateForCacheKey(runtimeHandle, sceneBuildInput) {
    const state = getRuntimeCacheUploadState(runtimeHandle, true);
    const cacheKey = `${sceneBuildInput?.cacheGame | 0}:${sceneBuildInput?.cacheRevision | 0}`;
    if (state && state.typeCacheKey !== cacheKey) {
        state.typeCacheKey = cacheKey;
        state.typeEntryIdsByKind = new Map();
    }
    return { state, cacheKey };
}

function ensureRuntimeTypeEntryApi(backendModule) {
    const useEntryTypeApi = hasRuntimeTypeEntryApi(backendModule);
    if (!useEntryTypeApi) {
        console.warn(
            "[map-render-backend][cache-upload] runtime type-entry api is required for cache-v2 uploads",
        );
        return false;
    }
    return true;
}

export function uploadRuntimeObjSpawnTypeEntriesWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    if (!ensureRuntimeTypeEntryApi(backendModule)) {
        return false;
    }
    const { state, cacheKey } = getOrResetRuntimeUploadStateForCacheKey(
        runtimeHandle,
        sceneBuildInput,
    );
    const { objSpawnsByMap } = collectObjTypeAndModelIdsForSceneBuild(sceneBuildInput);
    const ok = uploadTypeEntriesFromPackWithWasm(
        backendModule,
        runtimeHandle,
        RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND,
        objSpawnsByMap,
        {
            uploadedIdsSet: getUploadedTypeIdSet(
                state,
                RUNTIME_TYPE_BLOB_OBJ_SPAWNS_KIND,
                true,
            ),
        },
    );
    if (ok && state) {
        state.typeCacheKey = cacheKey;
    }
    return ok;
}

export function uploadRuntimeRequiredTypeEntriesWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    if (!ensureRuntimeTypeEntryApi(backendModule)) {
        return false;
    }
    const { state, cacheKey } = getOrResetRuntimeUploadStateForCacheKey(
        runtimeHandle,
        sceneBuildInput,
    );
    const ok = uploadRuntimeTypesWithEntryApiWithWasm(
        backendModule,
        runtimeHandle,
        sceneBuildInput,
        state,
    );
    if (ok && state) {
        state.typeCacheKey = cacheKey;
    }
    return ok;
}

export function uploadRuntimeCacheInputsWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    const { state, cacheKey } = getOrResetRuntimeUploadStateForCacheKey(
        runtimeHandle,
        sceneBuildInput,
    );

    const buildConfigStatus = runtimeCacheSetBuildConfigWithWasm(
        backendModule,
        runtimeHandle,
        sceneBuildInput,
    );
    if (buildConfigStatus !== RUNTIME_STATUS_OK) {
        return false;
    }

    const mapEntries = collectRuntimeCacheMapSquareEntries(sceneBuildInput);
    if (!Array.isArray(mapEntries)) {
        return false;
    }

    if (!ensureRuntimeTypeEntryApi(backendModule)) {
        return false;
    }

    if (
        !uploadRuntimeMapSquaresAndObjSpawnsWithWasm(
            backendModule,
            runtimeHandle,
            sceneBuildInput,
            mapEntries,
            state,
        )
    ) {
        return false;
    }

    if (
        !uploadRuntimeTypesWithEntryApiWithWasm(
            backendModule,
            runtimeHandle,
            sceneBuildInput,
            state,
        )
    ) {
        return false;
    }
    if (state) {
        state.typeCacheKey = cacheKey;
    }

    const varpValues = getSceneBuildVarpValues(sceneBuildInput);
    const varpStatus = runtimeCacheSetVarpsWithWasm(backendModule, runtimeHandle, varpValues);
    if (varpStatus !== 1) {
        return false;
    }

    return true;
}

function copyI32FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Int32Array(0);
    }
    const start = ptr >>> 2;
    const end = start + (length | 0);
    return backendModule.HEAP32.slice(start, end);
}

function viewI32FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Int32Array(0);
    }
    const start = ptr >>> 2;
    const end = start + (length | 0);
    return backendModule.HEAP32.subarray(start, end);
}

function copyI16FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Int16Array(0);
    }
    const start = ptr >>> 1;
    const end = start + (length | 0);
    return backendModule.HEAP16.slice(start, end);
}

function viewI16FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Int16Array(0);
    }
    const start = ptr >>> 1;
    const end = start + (length | 0);
    return backendModule.HEAP16.subarray(start, end);
}

function copyU16FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Uint16Array(0);
    }
    const start = ptr >>> 1;
    const end = start + (length | 0);
    return backendModule.HEAPU16.slice(start, end);
}

function viewU16FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Uint16Array(0);
    }
    const start = ptr >>> 1;
    const end = start + (length | 0);
    return backendModule.HEAPU16.subarray(start, end);
}

function copyU8FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Uint8Array(0);
    }
    const start = ptr >>> 0;
    const end = start + (length | 0);
    return backendModule.HEAPU8.slice(start, end);
}

function viewU8FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Uint8Array(0);
    }
    const start = ptr >>> 0;
    const end = start + (length | 0);
    return backendModule.HEAPU8.subarray(start, end);
}

function runtimeCachePutMapSquaresPackedWithWasm(
    backendModule,
    runtimeHandle,
    mapEntries,
) {
    const cachePutMapSquaresPacked = getRuntimeCachePutMapSquaresPackedExport(backendModule);
    if (typeof cachePutMapSquaresPacked !== "function") {
        return -1;
    }
    const count = Array.isArray(mapEntries) ? mapEntries.length | 0 : 0;
    if (count <= 0) {
        return 1;
    }

    const mapXs = new Int32Array(count);
    const mapYs = new Int32Array(count);
    const terrainOffsets = new Int32Array(count);
    const terrainLengths = new Int32Array(count);
    const locOffsets = new Int32Array(count);
    const locLengths = new Int32Array(count);
    const npcOffsets = new Int32Array(count);
    const npcLengths = new Int32Array(count);
    terrainOffsets.fill(-1);
    terrainLengths.fill(-1);
    locOffsets.fill(-1);
    locLengths.fill(-1);
    npcOffsets.fill(-1);
    npcLengths.fill(-1);

    const terrainChunks = [];
    const locChunks = [];
    const npcChunks = [];
    let terrainTotalBytes = 0;
    let locTotalBytes = 0;
    let npcTotalBytes = 0;

    for (let i = 0; i < count; i++) {
        const entry = mapEntries[i] ?? {};
        mapXs[i] = entry.mapX | 0;
        mapYs[i] = entry.mapY | 0;

        const terrain = entry.terrainBytes instanceof Uint8Array ? entry.terrainBytes : undefined;
        if (terrain && terrain.length > 0) {
            terrainOffsets[i] = terrainTotalBytes | 0;
            terrainLengths[i] = terrain.length | 0;
            terrainChunks.push(terrain);
            terrainTotalBytes += terrain.length | 0;
        }

        const loc = entry.locBytes instanceof Uint8Array ? entry.locBytes : undefined;
        if (loc && loc.length > 0) {
            locOffsets[i] = locTotalBytes | 0;
            locLengths[i] = loc.length | 0;
            locChunks.push(loc);
            locTotalBytes += loc.length | 0;
        }

        const npc = entry.npcBytes instanceof Uint8Array ? entry.npcBytes : undefined;
        if (npc && npc.length > 0) {
            npcOffsets[i] = npcTotalBytes | 0;
            npcLengths[i] = npc.length | 0;
            npcChunks.push(npc);
            npcTotalBytes += npc.length | 0;
        }
    }

    const terrainBytes = concatByteChunks(terrainChunks, terrainTotalBytes);
    const locBytes = concatByteChunks(locChunks, locTotalBytes);
    const npcBytes = concatByteChunks(npcChunks, npcTotalBytes);

    const mapXsPtr = mallocI32AndCopy(backendModule, mapXs);
    const mapYsPtr = mallocI32AndCopy(backendModule, mapYs);
    const terrainOffsetsPtr = mallocI32AndCopy(backendModule, terrainOffsets);
    const terrainLengthsPtr = mallocI32AndCopy(backendModule, terrainLengths);
    const terrainBytesPtr = mallocU8AndCopy(backendModule, terrainBytes);
    const locOffsetsPtr = mallocI32AndCopy(backendModule, locOffsets);
    const locLengthsPtr = mallocI32AndCopy(backendModule, locLengths);
    const locBytesPtr = mallocU8AndCopy(backendModule, locBytes);
    const npcOffsetsPtr = mallocI32AndCopy(backendModule, npcOffsets);
    const npcLengthsPtr = mallocI32AndCopy(backendModule, npcLengths);
    const npcBytesPtr = mallocU8AndCopy(backendModule, npcBytes);
    if (!mapXsPtr || !mapYsPtr || !terrainOffsetsPtr || !terrainLengthsPtr || !locOffsetsPtr || !locLengthsPtr || !npcOffsetsPtr || !npcLengthsPtr) {
        if (mapXsPtr) backendModule._free(mapXsPtr);
        if (mapYsPtr) backendModule._free(mapYsPtr);
        if (terrainOffsetsPtr) backendModule._free(terrainOffsetsPtr);
        if (terrainLengthsPtr) backendModule._free(terrainLengthsPtr);
        if (terrainBytesPtr) backendModule._free(terrainBytesPtr);
        if (locOffsetsPtr) backendModule._free(locOffsetsPtr);
        if (locLengthsPtr) backendModule._free(locLengthsPtr);
        if (locBytesPtr) backendModule._free(locBytesPtr);
        if (npcOffsetsPtr) backendModule._free(npcOffsetsPtr);
        if (npcLengthsPtr) backendModule._free(npcLengthsPtr);
        if (npcBytesPtr) backendModule._free(npcBytesPtr);
        return -1;
    }
    try {
        return cachePutMapSquaresPacked(
            runtimeHandle | 0,
            count | 0,
            mapXsPtr,
            mapYsPtr,
            terrainOffsetsPtr,
            terrainLengthsPtr,
            terrainBytesPtr,
            terrainBytes.length | 0,
            locOffsetsPtr,
            locLengthsPtr,
            locBytesPtr,
            locBytes.length | 0,
            npcOffsetsPtr,
            npcLengthsPtr,
            npcBytesPtr,
            npcBytes.length | 0,
        ) | 0;
    } finally {
        backendModule._free(mapXsPtr);
        backendModule._free(mapYsPtr);
        backendModule._free(terrainOffsetsPtr);
        backendModule._free(terrainLengthsPtr);
        if (terrainBytesPtr) {
            backendModule._free(terrainBytesPtr);
        }
        backendModule._free(locOffsetsPtr);
        backendModule._free(locLengthsPtr);
        if (locBytesPtr) {
            backendModule._free(locBytesPtr);
        }
        backendModule._free(npcOffsetsPtr);
        backendModule._free(npcLengthsPtr);
        if (npcBytesPtr) {
            backendModule._free(npcBytesPtr);
        }
    }
}

function runtimeCacheClearTypeKindWithWasm(backendModule, runtimeHandle, kind) {
    const clearTypeKind = getRuntimeCacheClearTypeKindExport(backendModule);
    if (typeof clearTypeKind !== "function") {
        return -1;
    }
    return clearTypeKind(runtimeHandle | 0, kind | 0) | 0;
}

function runtimeCachePutTypeEntryWithWasm(
    backendModule,
    runtimeHandle,
    kind,
    id,
    bytes,
) {
    const putTypeEntry = getRuntimeCachePutTypeEntryExport(backendModule);
    if (typeof putTypeEntry !== "function") {
        return -1;
    }
    const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
    const bytesPtr = mallocU8AndCopy(backendModule, safeBytes);
    try {
        return putTypeEntry(
            runtimeHandle | 0,
            kind | 0,
            id | 0,
            bytesPtr,
            safeBytes.length | 0,
        ) | 0;
    } finally {
        if (bytesPtr) {
            backendModule._free(bytesPtr);
        }
    }
}

function runtimeCollectRequiredTypeIdsWithWasm(
    backendModule,
    runtimeHandle,
    requestOrSceneBuildInput,
    collectFn,
) {
    if (typeof collectFn !== "function") {
        return undefined;
    }
    const runtimeRequest =
        normalizeRuntimeBuildRequest(requestOrSceneBuildInput) ??
        createRuntimeCacheBuildRequest(requestOrSceneBuildInput);
    if (!runtimeRequest) {
        return undefined;
    }
    const sizeX = runtimeRequest.sizeX | 0;
    const sizeY = runtimeRequest.sizeY | 0;
    if (sizeX <= 0 || sizeY <= 0) {
        return undefined;
    }
    const baseX = ((runtimeRequest.mapX | 0) * MAP_SQUARE_SIZE - (runtimeRequest.borderSize | 0)) | 0;
    const baseY = ((runtimeRequest.mapY | 0) * MAP_SQUARE_SIZE - (runtimeRequest.borderSize | 0)) | 0;
    const includeLocs = runtimeRequest.loadLocs === false ? 0 : 1;
    const includeObjs = runtimeRequest.loadObjs === false ? 0 : 1;
    const includeNpcs = runtimeRequest.loadNpcs === false ? 0 : 1;
    const requiredLength = collectFn(
        runtimeHandle | 0,
        baseX,
        baseY,
        sizeX,
        sizeY,
        includeLocs,
        includeObjs,
        includeNpcs,
        0,
        0,
    ) | 0;
    if (requiredLength < 2) {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, requiredLength);
    if (!outPtr) {
        return undefined;
    }
    try {
        const written = collectFn(
            runtimeHandle | 0,
            baseX,
            baseY,
            sizeX,
            sizeY,
            includeLocs,
            includeObjs,
            includeNpcs,
            outPtr,
            requiredLength,
        ) | 0;
        if (written < 2 || written > requiredLength) {
            return undefined;
        }
        const packed = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + written);
        const packedVersion = packed[0] | 0;
        const pairCount = packed[1] | 0;
        if (packedVersion !== 1 || pairCount < 0 || written !== (2 + pairCount * 2)) {
            return undefined;
        }
        const typeIdsByKind = new Map();
        const locTypeIds = [];
        const objTypeIds = [];
        const npcTypeIds = [];
        const varbitTypeIds = [];
        const modelIds = [];
        const seqTypeIds = [];
        const basTypeIds = [];
        const underlayTypeIds = [];
        const overlayTypeIds = [];
        for (let i = 0; i < pairCount; i++) {
            const off = 2 + i * 2;
            const kind = packed[off] | 0;
            const id = packed[off + 1] | 0;
            if (id < 0) {
                continue;
            }
            let ids = typeIdsByKind.get(kind);
            if (!Array.isArray(ids)) {
                ids = [];
                typeIdsByKind.set(kind, ids);
            }
            ids.push(id);
            if (kind === RUNTIME_TYPE_BLOB_LOC_KIND) {
                locTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_OBJ_KIND) {
                objTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_NPC_KIND) {
                npcTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_VARBIT_KIND) {
                varbitTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_MODEL_KIND) {
                modelIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_SEQ_TYPE_KIND) {
                seqTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_BAS_KIND) {
                basTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_UNDERLAY_KIND) {
                underlayTypeIds.push(id);
            } else if (kind === RUNTIME_TYPE_BLOB_OVERLAY_KIND) {
                overlayTypeIds.push(id);
            }
        }
        return {
            locTypeIds: sortedUniqueTypeIds(locTypeIds),
            objTypeIds: sortedUniqueTypeIds(objTypeIds),
            npcTypeIds: sortedUniqueTypeIds(npcTypeIds),
            varbitTypeIds: sortedUniqueTypeIds(varbitTypeIds),
            modelIds: sortedUniqueTypeIds(modelIds),
            seqTypeIds: sortedUniqueTypeIds(seqTypeIds),
            basTypeIds: sortedUniqueTypeIds(basTypeIds),
            underlayTypeIds: sortedUniqueTypeIds(underlayTypeIds),
            overlayTypeIds: sortedUniqueTypeIds(overlayTypeIds),
            typeIdsByKind,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

export function runtimeCollectRequiredPrimaryTypeIdsWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    return runtimeCollectRequiredTypeIdsWithWasm(
        backendModule,
        runtimeHandle,
        sceneBuildInput,
        getRuntimeCollectRequiredPrimaryTypeIdsExport(backendModule),
    );
}

export function runtimeCollectRequiredExpandedTypeIdsWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    return runtimeCollectRequiredTypeIdsWithWasm(
        backendModule,
        runtimeHandle,
        sceneBuildInput,
        getRuntimeCollectRequiredExpandedTypeIdsExport(backendModule),
    );
}

function runtimeCacheSetVarpsWithWasm(backendModule, runtimeHandle, varps) {
    const cacheSetVarps = getRuntimeCacheSetVarpsExport(backendModule);
    if (typeof cacheSetVarps !== "function") {
        return -1;
    }
    const values = varps instanceof Int32Array ? varps : new Int32Array(0);
    const valuesPtr = mallocI32AndCopy(backendModule, values);
    try {
        return cacheSetVarps(runtimeHandle | 0, valuesPtr, values.length | 0) | 0;
    } finally {
        if (valuesPtr) {
            backendModule._free(valuesPtr);
        }
    }
}

function runtimeSetGeometrySeedWithWasm(backendModule, runtimeHandle, vertices, indices) {
    const setGeometrySeed = getRuntimeSetGeometrySeedExport(backendModule);
    if (typeof setGeometrySeed !== "function") {
        return -1;
    }
    const safeVertices = vertices instanceof Uint8Array ? vertices : new Uint8Array(0);
    const safeIndices = indices instanceof Int32Array ? indices : new Int32Array(0);
    const verticesPtr = mallocU8AndCopy(backendModule, safeVertices);
    const indicesPtr = mallocI32AndCopy(backendModule, safeIndices);
    try {
        return setGeometrySeed(
            runtimeHandle | 0,
            verticesPtr,
            safeVertices.length | 0,
            indicesPtr,
            safeIndices.length | 0,
        ) | 0;
    } finally {
        if (verticesPtr) {
            backendModule._free(verticesPtr);
        }
        if (indicesPtr) {
            backendModule._free(indicesPtr);
        }
    }
}

function runtimeClearGeometrySeedWithWasm(backendModule, runtimeHandle) {
    const clearGeometrySeed = getRuntimeClearGeometrySeedExport(backendModule);
    if (typeof clearGeometrySeed !== "function") {
        return -1;
    }
    return clearGeometrySeed(runtimeHandle | 0) | 0;
}

function runtimeCachePutTextureArgbWithWasm(backendModule, runtimeHandle, textureId, argb) {
    const putTextureArgb = getRuntimeCachePutTextureArgbExport(backendModule);
    if (typeof putTextureArgb !== "function") {
        return -1;
    }
    const values = argb instanceof Int32Array ? argb : new Int32Array(0);
    const valuesPtr = mallocI32AndCopy(backendModule, values);
    try {
        return putTextureArgb(
            runtimeHandle | 0,
            textureId | 0,
            valuesPtr,
            values.length | 0,
        ) | 0;
    } finally {
        if (valuesPtr) {
            backendModule._free(valuesPtr);
        }
    }
}

function runtimeCacheClearTextureArgbWithWasm(backendModule, runtimeHandle) {
    const clearTextureArgb = getRuntimeCacheClearTextureArgbExport(backendModule);
    if (typeof clearTextureArgb !== "function") {
        return -1;
    }
    return clearTextureArgb(runtimeHandle | 0) | 0;
}

function runtimeCachePutMaterialParamsWithWasm(backendModule, runtimeHandle, materialId, params) {
    const putMaterialParams = getRuntimeCachePutMaterialParamsExport(backendModule);
    if (typeof putMaterialParams !== "function") {
        return -1;
    }
    const values = params instanceof Int32Array ? params : new Int32Array(0);
    const valuesPtr = mallocI32AndCopy(backendModule, values);
    try {
        return putMaterialParams(
            runtimeHandle | 0,
            materialId | 0,
            valuesPtr,
            values.length | 0,
        ) | 0;
    } finally {
        if (valuesPtr) {
            backendModule._free(valuesPtr);
        }
    }
}

function runtimeCacheClearMaterialParamsWithWasm(backendModule, runtimeHandle) {
    const clearMaterialParams = getRuntimeCacheClearMaterialParamsExport(backendModule);
    if (typeof clearMaterialParams !== "function") {
        return -1;
    }
    return clearMaterialParams(runtimeHandle | 0) | 0;
}

function runtimeCacheGetResourceCountsWithWasm(backendModule, runtimeHandle) {
    const getResourceCounts = getRuntimeCacheGetResourceCountsExport(backendModule);
    if (typeof getResourceCounts !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 2);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = getResourceCounts(runtimeHandle | 0, outPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const out = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 2);
        return {
            textureCount: out[0] | 0,
            materialCount: out[1] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

function runtimeCacheClearMapSquaresWithWasm(backendModule, runtimeHandle) {
    const clearMapSquares = getRuntimeCacheClearMapSquaresExport(backendModule);
    if (typeof clearMapSquares !== "function") {
        return undefined;
    }
    return clearMapSquares(runtimeHandle | 0) | 0;
}

function runtimeCacheSetBuildConfigWithWasm(
    backendModule,
    runtimeHandle,
    sceneBuildInput,
) {
    const setBuildConfig = getRuntimeCacheSetBuildConfigExport(backendModule);
    if (typeof setBuildConfig !== "function") {
        return RUNTIME_STATUS_OK;
    }
    const unitsTileHeightBasis =
        (sceneBuildInput?.unitsTileHeightBasis | 0) > 0
            ? (sceneBuildInput.unitsTileHeightBasis | 0)
            : 8;
    return setBuildConfig(
        runtimeHandle | 0,
        sceneBuildInput?.cacheGame | 0,
        sceneBuildInput?.cacheRevision | 0,
        SCENE_LEVELS,
        unitsTileHeightBasis,
    ) | 0;
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

export function runtimeDebugGetLastCollisionFlagsWithWasm(backendModule, runtimeHandle) {
    const getMeta = getRuntimeDebugGetLastCollisionFlagsMetaExport(backendModule);
    const copy = getRuntimeDebugCopyLastCollisionFlagsExport(backendModule);
    if (typeof getMeta !== "function" || typeof copy !== "function") {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 4);
    if (!metaPtr) {
        return undefined;
    }
    try {
        const status = getMeta(runtimeHandle | 0, metaPtr, 4) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const meta = backendModule.HEAP32.slice(metaPtr >> 2, (metaPtr >> 2) + 4);
        const levels = meta[0] | 0;
        const sizeX = meta[1] | 0;
        const sizeY = meta[2] | 0;
        const len = meta[3] | 0;
        const expectedLen = (levels | 0) * (sizeX | 0) * (sizeY | 0);
        if (expectedLen !== (len | 0)) {
            return undefined;
        }
        if (len <= 0) {
            return { levels, sizeX, sizeY, flags: new Int32Array(0) };
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
            const flags = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + len);
            return { levels, sizeX, sizeY, flags };
        } finally {
            backendModule._free(outPtr);
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

function parseRuntimePacketFromMetaArray(backendModule, meta, options) {
    const asView = !!options?.asView;
    const bucketCmdCountsPtr = meta[0] >>> 0;
    const bucketCmdCountsLen = meta[1] | 0;
    const bucketModelInfoLengthsPtr = meta[2] >>> 0;
    const bucketModelInfoLengthsLen = meta[3] | 0;
    const heightMapPtr = meta[4] >>> 0;
    const heightMapLen = meta[5] | 0;
    const drawRangesPackedPtr = meta[11] >>> 0;
    const drawRangesPackedLen = meta[12] | 0;
    const totalModelInfoLength = meta[10] | 0;
    const verticesPtr = meta[29] >>> 0;
    const verticesLen = meta[30] | 0;
    const indicesPtr = meta[31] >>> 0;
    const indicesLen = meta[32] | 0;
    const npcDrawRangesBasePtr = meta[33] >>> 0;
    const npcDrawRangesBaseLen = meta[34] | 0;
    const npcDrawRangesAlphaPtr = meta[35] >>> 0;
    const npcDrawRangesAlphaLen = meta[36] | 0;
    const npcVerticesPtr = meta[37] >>> 0;
    const npcVerticesLen = meta[38] | 0;
    const npcIndicesPtr = meta[39] >>> 0;
    const npcIndicesLen = meta[40] | 0;
    const npcOrderKeysPtr = meta[41] >>> 0;
    const npcOrderKeysLen = meta[42] | 0;
    const packetVersion = meta[43] | 0;
    if (
        (meta.length | 0) < RUNTIME_PACKET_META_LENGTH ||
        bucketCmdCountsLen !== DRAW_BUCKET_KEYS.length ||
        bucketModelInfoLengthsLen !== DRAW_BUCKET_KEYS.length ||
        totalModelInfoLength < 0 ||
        drawRangesPackedLen < 0 ||
        verticesLen < 0 ||
        indicesLen < 0 ||
        npcDrawRangesBaseLen < 0 ||
        npcDrawRangesAlphaLen < 0 ||
        npcVerticesLen < 0 ||
        npcIndicesLen < 0 ||
        npcOrderKeysLen < 0 ||
        packetVersion !== RUNTIME_PACKET_VERSION
    ) {
        return undefined;
    }
    const i32Reader = asView ? viewI32FromHeap : copyI32FromHeap;
    const i16Reader = asView ? viewI16FromHeap : copyI16FromHeap;
    const u16Reader = asView ? viewU16FromHeap : copyU16FromHeap;
    const u8Reader = asView ? viewU8FromHeap : copyU8FromHeap;
    const bucketCmdCounts = i32Reader(backendModule, bucketCmdCountsPtr, bucketCmdCountsLen);
    const bucketModelInfoLengths = i32Reader(
        backendModule,
        bucketModelInfoLengthsPtr,
        bucketModelInfoLengthsLen,
    );
    if (
        bucketCmdCounts.length !== DRAW_BUCKET_KEYS.length ||
        bucketModelInfoLengths.length !== DRAW_BUCKET_KEYS.length
    ) {
        return undefined;
    }

    const modelInfoTextureBuckets = new Array(DRAW_BUCKET_KEYS.length);
    let modelInfoLengthSum = 0;
    for (let bucket = 0; bucket < DRAW_BUCKET_KEYS.length; bucket++) {
        const ptr = meta[13 + bucket] >>> 0;
        const len = meta[21 + bucket] | 0;
        if (len < 0) {
            return undefined;
        }
        if ((bucketModelInfoLengths[bucket] | 0) !== len) {
            return undefined;
        }
        if (len > 0 && ptr === 0) {
            return undefined;
        }
        modelInfoTextureBuckets[bucket] = u16Reader(backendModule, ptr, len);
        if (modelInfoTextureBuckets[bucket].length !== len) {
            return undefined;
        }
        modelInfoLengthSum += len;
    }
    if ((modelInfoLengthSum | 0) !== totalModelInfoLength) {
        return undefined;
    }

    return {
        bucketCmdCounts,
        bucketModelInfoLengths,
        modelInfoTextureBuckets,
        heightMapTextureData: i16Reader(backendModule, heightMapPtr, heightMapLen),
        levels: meta[6] | 0,
        sizeX: meta[7] | 0,
        sizeY: meta[8] | 0,
        unitsTileHeightBasis: meta[9] | 0,
        totalModelInfoLength,
        packetVersion,
        drawRangesPacked: i32Reader(backendModule, drawRangesPackedPtr, drawRangesPackedLen),
        vertices: u8Reader(backendModule, verticesPtr, verticesLen),
        indices: i32Reader(backendModule, indicesPtr, indicesLen),
        npcDrawRangesBase: i32Reader(backendModule, npcDrawRangesBasePtr, npcDrawRangesBaseLen),
        npcDrawRangesAlpha: i32Reader(backendModule, npcDrawRangesAlphaPtr, npcDrawRangesAlphaLen),
        npcVertices: u8Reader(backendModule, npcVerticesPtr, npcVerticesLen),
        npcIndices: i32Reader(backendModule, npcIndicesPtr, npcIndicesLen),
        npcOrderKeys: i32Reader(backendModule, npcOrderKeysPtr, npcOrderKeysLen),
        __packetHandle: (options?.packetHandle | 0) > 0 ? (options.packetHandle | 0) : 0,
    };
}

function runtimeBuildMapPacketFromCacheWithWasm(backendModule, runtimeHandle, request) {
    const buildMapPacketHandleFromCache = getRuntimeBuildMapPacketHandleFromCacheExport(backendModule);
    const getPacketMeta = getRuntimeGetPacketMetaExport(backendModule);
    const releasePacket = getRuntimeReleasePacketExport(backendModule);
    if (
        typeof buildMapPacketHandleFromCache !== "function" ||
        typeof getPacketMeta !== "function" ||
        typeof releasePacket !== "function"
    ) {
        return undefined;
    }

    const outHandlePtr = mallocI32(backendModule, 1);
    const metaLength = RUNTIME_PACKET_META_LENGTH;
    const metaPtr = mallocI32(backendModule, metaLength);
    if (!outHandlePtr || !metaPtr) {
        if (outHandlePtr) {
            backendModule._free(outHandlePtr);
        }
        if (metaPtr) {
            backendModule._free(metaPtr);
        }
        return undefined;
    }
    let packetHandle = 0;
    try {
        const buildStatus = buildMapPacketHandleFromCache(
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
            outHandlePtr,
        ) | 0;
        if (buildStatus !== 1) {
            return undefined;
        }
        packetHandle = backendModule.HEAP32[outHandlePtr >> 2] | 0;
        if (packetHandle <= 0) {
            return undefined;
        }
        const metaStatus = getPacketMeta(packetHandle | 0, metaPtr, metaLength) | 0;
        if (metaStatus !== 1) {
            releasePacket(packetHandle | 0);
            return undefined;
        }
        const meta = backendModule.HEAP32.slice(metaPtr >> 2, (metaPtr >> 2) + metaLength);
        return parseRuntimePacketFromMetaArray(backendModule, meta, {
            asView: true,
            packetHandle,
        });
    } finally {
        backendModule._free(outHandlePtr);
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



function runtimeBuildNpcPacketFromCacheWithWasm(backendModule, runtimeHandle, request) {
    const buildNpcPacketHandleFromCache = getRuntimeBuildNpcPacketHandleFromCacheExport(backendModule);
    const getPacketMeta = getRuntimeGetPacketMetaExport(backendModule);
    const releasePacket = getRuntimeReleasePacketExport(backendModule);
    if (
        typeof buildNpcPacketHandleFromCache !== "function" ||
        typeof getPacketMeta !== "function" ||
        typeof releasePacket !== "function"
    ) {
        return undefined;
    }

    const outHandlePtr = mallocI32(backendModule, 1);
    const metaLength = RUNTIME_PACKET_META_LENGTH;
    const metaPtr = mallocI32(backendModule, metaLength);
    if (!outHandlePtr || !metaPtr) {
        if (outHandlePtr) {
            backendModule._free(outHandlePtr);
        }
        if (metaPtr) {
            backendModule._free(metaPtr);
        }
        return undefined;
    }
    let packetHandle = 0;
    try {
        const buildStatus = buildNpcPacketHandleFromCache(
            runtimeHandle | 0,
            request?.mapX | 0,
            request?.mapY | 0,
            request?.borderSize | 0,
            request?.sizeX | 0,
            request?.sizeY | 0,
            outHandlePtr,
        ) | 0;
        if (buildStatus !== 1) {
            return undefined;
        }
        packetHandle = backendModule.HEAP32[outHandlePtr >> 2] | 0;
        if (packetHandle <= 0) {
            return undefined;
        }
        const metaStatus = getPacketMeta(packetHandle | 0, metaPtr, metaLength) | 0;
        if (metaStatus !== 1) {
            releasePacket(packetHandle | 0);
            return undefined;
        }
        const meta = backendModule.HEAP32.slice(metaPtr >> 2, (metaPtr >> 2) + metaLength);
        return parseRuntimePacketFromMetaArray(backendModule, meta, {
            asView: true,
            packetHandle,
        });
    } finally {
        backendModule._free(outHandlePtr);
        backendModule._free(metaPtr);
    }
}
export const mapRenderRuntimeBridge = {
    async initRuntime() {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return false;
        }
        return (
            (backendModule.__rsCapabilities & CAP_RUNTIME_CACHE_V2) !== 0 &&
            (backendModule.__rsCapabilities & CAP_RUNTIME_PACKET_V2_ONLY) !== 0
        );
    },
    async createRuntimeWithConfig(config) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        const createWithConfig = getRuntimeCreateWithConfigExport(backendModule);
        if (typeof createWithConfig === "function") {
            const runtimeHandle = createWithConfig(
                config?.cacheGame | 0,
                config?.cacheRevision | 0,
                config?.sceneLevels | 0,
                config?.unitsTileHeightBasis | 0,
            ) | 0;
            if (runtimeHandle > 0) {
                getRuntimeTickOutputsForHandle(runtimeHandle, true);
                getRuntimeCacheUploadState(runtimeHandle, true);
                return runtimeHandle;
            }
            return undefined;
        }
        return undefined;
    },
    destroyRuntime(runtimeHandle) {
        if (!backendModuleInstance) {
            return;
        }
        const handle = runtimeHandle | 0;
        const destroyRuntime = getRuntimeDestroyExport(backendModuleInstance);
        if (typeof destroyRuntime === "function") {
            destroyRuntime(handle);
        }
        runtimeTickOutputByHandle.delete(handle);
        clearRuntimeCacheUploadState(handle);
    },
    resetRuntime(runtimeHandle) {
        if (!backendModuleInstance) {
            return;
        }
        const handle = runtimeHandle | 0;
        const resetRuntime = getRuntimeResetExport(backendModuleInstance);
        if (typeof resetRuntime === "function") {
            resetRuntime(handle);
        }
        const byHandle = getRuntimeTickOutputsForHandle(handle, false);
        byHandle?.clear();
        clearRuntimeCacheUploadState(handle);
    },
    async cacheSetVarps(runtimeHandle, varps) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheSetVarpsWithWasm(backendModule, runtimeHandle, varps);
    },
    async setGeometrySeed(runtimeHandle, vertices, indices) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeSetGeometrySeedWithWasm(backendModule, runtimeHandle, vertices, indices);
    },
    async clearGeometrySeed(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeClearGeometrySeedWithWasm(backendModule, runtimeHandle);
    },

    async cachePutTextureArgb(runtimeHandle, textureId, argb) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCachePutTextureArgbWithWasm(
            backendModule,
            runtimeHandle,
            textureId,
            argb,
        );
    },
    async cacheClearTextureArgb(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheClearTextureArgbWithWasm(backendModule, runtimeHandle);
    },
    async cachePutMaterialParams(runtimeHandle, materialId, params) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCachePutMaterialParamsWithWasm(
            backendModule,
            runtimeHandle,
            materialId,
            params,
        );
    },
    async cacheClearMaterialParams(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheClearMaterialParamsWithWasm(backendModule, runtimeHandle);
    },
    async cacheGetResourceCounts(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeCacheGetResourceCountsWithWasm(backendModule, runtimeHandle);
    },
    async cacheSetBuildConfig(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheSetBuildConfigWithWasm(backendModule, runtimeHandle, request);
    },
    async cacheClearMapSquares(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        const status = runtimeCacheClearMapSquaresWithWasm(backendModule, runtimeHandle);
        if (status === RUNTIME_STATUS_OK) {
            const state = getRuntimeCacheUploadState(runtimeHandle, false);
            state?.mapSquareKeys?.clear();
        }
        return status ?? -1;
    },
    async cachePutMapSquaresPacked(runtimeHandle, entries) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        const status = runtimeCachePutMapSquaresPackedWithWasm(backendModule, runtimeHandle, entries);
        if (status === RUNTIME_STATUS_OK) {
            const state = getRuntimeCacheUploadState(runtimeHandle, true);
            const nextMapSquareKeys = new Set();
            for (let i = 0; i < (entries?.length ?? 0); i++) {
                const entry = entries[i];
                nextMapSquareKeys.add(`${entry?.mapX | 0},${entry?.mapY | 0}`);
            }
            if (state) {
                state.mapSquareKeys = nextMapSquareKeys;
            }
        }
        return status ?? -1;
    },
    async cacheClearTypeKind(runtimeHandle, kind) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheClearTypeKindWithWasm(backendModule, runtimeHandle, kind);
    },
    async cachePutTypeEntry(runtimeHandle, kind, id, bytes) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCachePutTypeEntryWithWasm(backendModule, runtimeHandle, kind, id, bytes);
    },
    async collectRequiredPrimaryTypeIds(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeCollectRequiredPrimaryTypeIdsWithWasm(
            backendModule,
            runtimeHandle,
            request,
        );
    },
    async collectRequiredExpandedTypeIds(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeCollectRequiredExpandedTypeIdsWithWasm(
            backendModule,
            runtimeHandle,
            request,
        );
    },
    async getRuntimeCachedCommandStreamDigest(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetCachedCommandStreamDigestWithWasm(backendModule, runtimeHandle);
    },
    async getRuntimeCachedCommandStreamArrays(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetCachedCommandStreamArraysWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastBuildStats(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastBuildStatsWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastCommandProvenancePacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastCommandProvenancePackedWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastLocMergeEmitEntriesPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocMergeEmitEntriesPackedWithWasm(backendModule, runtimeHandle);
    },
    async buildMapPacketFromCache(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeBuildMapPacketFromCacheWithWasm(backendModule, runtimeHandle, request);
    },
    async buildNpcPacketFromCache(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeBuildNpcPacketFromCacheWithWasm(backendModule, runtimeHandle, request);
    },
    releasePacket(packet) {
        if (!backendModuleInstance) {
            return false;
        }
        const packetHandle = packet?.__packetHandle | 0;
        if (packetHandle <= 0) {
            return false;
        }
        const releasePacket = getRuntimeReleasePacketExport(backendModuleInstance);
        if (typeof releasePacket === "function") {
            return (releasePacket(packetHandle) | 0) === 1;
        }
        return false;
    },
    setTickState(runtimeHandle, stateKey, input) {
        if (!backendModuleInstance) {
            return false;
        }
        return setRuntimeTickStateWithWasm(backendModuleInstance, runtimeHandle, stateKey, input);
    },
    clearTickState(runtimeHandle, stateKey) {
        if (!backendModuleInstance) {
            return;
        }
        clearRuntimeTickStateWithWasm(backendModuleInstance, runtimeHandle, stateKey);
    },
    tickAdvanceAndEmitBasePatchesForState(
        runtimeHandle,
        stateKey,
        cycleNowFixed,
        clientTickCount,
    ) {
        if (!backendModuleInstance) {
            return undefined;
        }
        const handle = runtimeHandle | 0;
        const key = normalizeTickStateKey(stateKey);
        if (key === undefined) {
            return undefined;
        }
        const byHandle = getRuntimeTickOutputsForHandle(handle, false);
        const outputRefs = byHandle?.get(key);
        if (!outputRefs) {
            return undefined;
        }
        return tickRuntimeStateForOutputRefsWithWasm(
            backendModuleInstance,
            handle,
            key,
            cycleNowFixed | 0,
            clientTickCount | 0,
            outputRefs,
        );
    },
    async decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1,
        borderSize,
        mapX,
        mapY,
        data,
        npcLoginScreenPropsById,
        requiredLoginScreenPropsMask,
    ) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return decodeNpcSpawnsWithWasm(
            backendModule,
            tileRenderFlagsLevel1,
            borderSize,
            mapX,
            mapY,
            data,
            npcLoginScreenPropsById,
            requiredLoginScreenPropsMask,
        );
    },
    reset() {
        runtimeTickOutputByHandle.clear();
        runtimeCacheUploadByHandle.clear();
        backendModulePromise = undefined;
        backendModuleInstance = undefined;
    },
};
