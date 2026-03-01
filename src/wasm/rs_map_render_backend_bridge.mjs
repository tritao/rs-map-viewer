let backendModulePromise;
let backendModuleInstance;
const runtimeTickOutputByHandle = new Map();
const RUNTIME_BLOB_DOMAIN_MAP_SQUARE = 2;
const RUNTIME_BLOB_MAP_SQUARE_FILE_TERRAIN = 0;
const RUNTIME_BLOB_MAP_SQUARE_FILE_LOC = 1;
const RUNTIME_BLOB_MAP_SQUARE_FILE_NPC = 2;
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
const RUNTIME_PACKET_META_LENGTH = 46;
const RUNTIME_PACKET_VERSION = 3;


function createWasmModuleLocator(path) {
    return new URL(path, import.meta.url).href;
}

function createWasmModuleLocatorDebug(path) {
    // Emscripten backend always asks for `rs_map_render_backend.wasm`. For debug builds we output
    // `rs_map_render_backend_debug.wasm`, so remap here.
    if (typeof path === "string" && path.endsWith(".wasm")) {
        return new URL("./rs_map_render_backend_debug.wasm", import.meta.url).href;
    }
    return createWasmModuleLocator(path);
}

function wantDebugBackendModule() {
    // Node/parity scripts: controlled by env var.
    // Browser/app: `process` is typically undefined, so this will be false.
    return (
        typeof process !== "undefined" &&
        process &&
        process.env &&
        process.env.RS_MAP_RENDER_WASM_EXPORT_PROFILE === "debug"
    );
}

export async function tryLoadBackendModule() {
    if (backendModulePromise) {
        return backendModulePromise;
    }
    backendModulePromise = (async () => {
        try {
            const wantDebug = wantDebugBackendModule();
            const mod = wantDebug
                ? await import("./rs_map_render_backend_debug.js")
                : await import("./rs_map_render_backend.js");
            const createModule = mod.default;
            if (typeof createModule !== "function") {
                console.warn("[map-render-backend] wasm module factory export missing");
                return undefined;
            }
            const backendModule = await createModule({
                locateFile: wantDebug ? createWasmModuleLocatorDebug : createWasmModuleLocator,
            });
            if (
                typeof backendModule._rs_map_render_bridge_abi_version !== "function" ||
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
            const requiredRuntimeExports = [
                getRuntimeCreateWithConfigExport(backendModule),
                getRuntimeDestroyExport(backendModule),
                getRuntimeResetExport(backendModule),
                getRuntimeIsValidExport(backendModule),
                getRuntimeClearTickStateExport(backendModule),
                getRuntimeSetTickStatePackedExport(backendModule),
                getRuntimeTickForStatePackedExport(backendModule),
                getRuntimeTickMapsEmitPatchStreamsExport(backendModule),
                getRuntimeGetLastMissingBlobEntriesPackedExport(backendModule),
                getRuntimeCacheSetBuildConfigExport(backendModule),
                getRuntimeCacheSetVarpsExport(backendModule),
                getRuntimeCachePutBlobBatchExport(backendModule),
                getRuntimeCacheClearBlobDomainExport(backendModule),
                getRuntimeCacheClearAllBlobsExport(backendModule),
                getRuntimeBuildMapPacketHandleFromCacheExport(backendModule),
                getRuntimeGetPacketMetaExport(backendModule),
                getRuntimeReleasePacketExport(backendModule),
            ];
            for (let i = 0; i < requiredRuntimeExports.length; i++) {
                if (typeof requiredRuntimeExports[i] !== "function") {
                    console.warn("[map-render-backend] wasm module missing required runtime exports");
                    return undefined;
                }
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

function getRuntimeHasTickStateExport(backendModule) {
    return backendModule._rs_map_render_runtime_has_tick_state;
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

function getRuntimeTickMapsEmitPatchStreamsExport(backendModule) {
    return backendModule._rs_map_render_runtime_tick_maps_emit_patch_streams_meta;
}

function getRuntimeGetLastMissingBlobEntriesPackedExport(backendModule) {
    return backendModule._rs_map_render_runtime_get_last_missing_blob_entries_packed;
}

function getRuntimeCacheSetBuildConfigExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_set_build_config;
}

function getRuntimeCacheSetVarpsExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_set_varps;
}

function getRuntimeCachePutBlobBatchExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_put_blob_batch;
}

function getRuntimeCacheClearBlobDomainExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_clear_blob_domain;
}

function getRuntimeCacheClearAllBlobsExport(backendModule) {
    return backendModule._rs_map_render_runtime_cache_clear_all_blobs;
}

function getRuntimeDebugGetLastBuildFailureExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_build_failure;
}

function getRuntimeDebugGetLastCollectMapInputExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_collect_map_input;
}

function getRuntimeDebugGetLastCommandStreamStatusExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_command_stream_status;
}

function getRuntimeDebugGetLastLegacyModelLoadExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_legacy_model_load;
}

function getRuntimeDebugGetLastMissingTypeExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_get_last_missing_type;
}

function getRuntimeDebugBuildMapPlanFromCacheExport(backendModule) {
    return backendModule._rs_map_render_runtime_debug_build_map_plan_from_cache;
}

function getRuntimeBuildMapPacketHandleFromCacheExport(backendModule) {
    return backendModule._rs_map_render_runtime_build_map_packet_handle_from_cache;
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



function sortedUniqueTypeIds(ids) {
    if (!Array.isArray(ids) || ids.length <= 0) {
        return [];
    }
    return Array.from(new Set(ids.map((v) => v | 0)))
        .filter((v) => v >= 0)
        .sort((a, b) => a - b);
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

function setRuntimeTickStatePackedWithWasm(backendModule, runtimeHandle, stateKey, packed) {
    const key = normalizeTickStateKey(stateKey);
    if (key === undefined) {
        return false;
    }
    if (!(packed instanceof Int32Array) || (packed.length | 0) <= 0) {
        return false;
    }
    const setTickStatePacked = getRuntimeSetTickStatePackedExport(backendModule);
    if (typeof setTickStatePacked !== "function") {
        return false;
    }
    const packedPtr = mallocI32AndCopy(backendModule, packed);
    if (!packedPtr) {
        return false;
    }
    try {
        return (
            (setTickStatePacked(runtimeHandle | 0, key, packedPtr, packed.length | 0) | 0) === 1
        );
    } finally {
        backendModule._free(packedPtr);
    }
}

function clearRuntimeTickStateWithWasm(backendModule, runtimeHandle, stateKey) {
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

function runtimeHasTickStateWithWasm(backendModule, runtimeHandle, stateKey) {
    const key = normalizeTickStateKey(stateKey);
    if (key === undefined) {
        return false;
    }
    const fn = getRuntimeHasTickStateExport(backendModule);
    if (typeof fn !== "function") {
        return false;
    }
    return (fn(runtimeHandle | 0, key) | 0) === 1;
}

function tickRuntimeMapsEmitPatchStreamsWithWasm(
    backendModule,
    runtimeHandle,
    stateKeys,
    cycleNowFixed,
    clientTickCount,
) {
    const fn = getRuntimeTickMapsEmitPatchStreamsExport(backendModule);
    if (typeof fn !== "function") {
        return undefined;
    }
    if (!(stateKeys instanceof Int32Array)) {
        return undefined;
    }
    const keysPtr = mallocI32AndCopy(backendModule, stateKeys);
    if ((stateKeys.length | 0) > 0 && !keysPtr) {
        return undefined;
    }
    const metaPtr = mallocI32(backendModule, 4);
    if (!metaPtr) {
        if (keysPtr) backendModule._free(keysPtr);
        return undefined;
    }
    try {
        const raw = fn(
            runtimeHandle | 0,
            keysPtr,
            stateKeys.length | 0,
            cycleNowFixed | 0,
            clientTickCount | 0,
            metaPtr,
            4,
        ) | 0;
        if (raw !== 1) {
            return undefined;
        }
        const meta = backendModule.HEAP32.subarray(metaPtr >> 2, (metaPtr >> 2) + 4);
        const countsPtr = meta[0] | 0;
        const countsLen = meta[1] | 0;
        const patchesPtr = meta[2] | 0;
        const patchesLen = meta[3] | 0;
        if (countsLen < 0 || patchesLen < 0) {
            return undefined;
        }
        const counts =
            countsLen > 0
                ? backendModule.HEAP32.slice(countsPtr >> 2, (countsPtr >> 2) + countsLen)
                : new Int32Array(0);
        const patches =
            patchesLen > 0
                ? backendModule.HEAP32.slice(patchesPtr >> 2, (patchesPtr >> 2) + patchesLen)
                : new Int32Array(0);
        return { tickPatchCountsByMapId: counts, tickPatchPacked: patches };
    } finally {
        backendModule._free(metaPtr);
        if (keysPtr) backendModule._free(keysPtr);
    }
}

function tickRuntimeStateForOutputRefsWithWasm(
    backendModule,
    runtimeHandle,
    stateKey,
    cycleNowFixed,
    clientTickCount,
    outputRefs,
) {
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

function copyI32FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Int32Array(0);
    }
    const start = ptr >>> 2;
    const end = start + (length | 0);
    return backendModule.HEAP32.slice(start, end);
}

function copyI16FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Int16Array(0);
    }
    const start = ptr >>> 1;
    const end = start + (length | 0);
    return backendModule.HEAP16.slice(start, end);
}

function copyU16FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Uint16Array(0);
    }
    const start = ptr >>> 1;
    const end = start + (length | 0);
    return backendModule.HEAPU16.slice(start, end);
}

function copyU8FromHeap(backendModule, ptr, length) {
    if ((length | 0) <= 0 || (ptr >>> 0) === 0) {
        return new Uint8Array(0);
    }
    const start = ptr >>> 0;
    const end = start + (length | 0);
    return backendModule.HEAPU8.slice(start, end);
}

function runtimeGetLastMissingBlobEntriesWithWasm(
    backendModule,
    runtimeHandle,
) {
    const getPacked = getRuntimeGetLastMissingBlobEntriesPackedExport(backendModule);
    if (typeof getPacked !== "function") {
        return undefined;
    }
    const requiredLength = getPacked(runtimeHandle | 0, 0, 0) | 0;
    if (requiredLength < 2) {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, requiredLength);
    if (!outPtr) {
        return undefined;
    }
    try {
        const written = getPacked(runtimeHandle | 0, outPtr, requiredLength) | 0;
        if (written < 2 || written > requiredLength) {
            return undefined;
        }
        const packed = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + written);
        const packedVersion = packed[0] | 0;
        const entryCount = packed[1] | 0;
        if (packedVersion !== 1 || entryCount < 0 || written !== (2 + entryCount * 3)) {
            return undefined;
        }
        const domains = new Int32Array(entryCount);
        const groups = new Int32Array(entryCount);
        const files = new Int32Array(entryCount);
        for (let i = 0; i < entryCount; i++) {
            const off = 2 + i * 3;
            domains[i] = packed[off] | 0;
            groups[i] = packed[off + 1] | 0;
            files[i] = packed[off + 2] | 0;
        }
        return { domains, groups, files };
    } finally {
        backendModule._free(outPtr);
    }
}

function runtimeDebugBuildMapPlanFromCacheWithWasm(backendModule, runtimeHandle, request) {
    const buildPlan = getRuntimeDebugBuildMapPlanFromCacheExport(backendModule);
    if (typeof buildPlan !== "function") {
        return -1;
    }
    return buildPlan(
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

function runtimeCachePutBlobBatchWithWasm(
    backendModule,
    runtimeHandle,
    domain,
    groups,
    files,
    offsets,
    lengths,
    bytes,
) {
    const putBlobBatch = getRuntimeCachePutBlobBatchExport(backendModule);
    if (typeof putBlobBatch !== "function") {
        return -1;
    }

    const safeGroups = groups instanceof Int32Array ? groups : new Int32Array(0);
    const safeFiles = files instanceof Int32Array ? files : new Int32Array(0);
    const safeOffsets = offsets instanceof Int32Array ? offsets : new Int32Array(0);
    const safeLengths = lengths instanceof Int32Array ? lengths : new Int32Array(0);
    const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);

    const n = safeGroups.length | 0;
    if (
        (safeFiles.length | 0) !== n ||
        (safeOffsets.length | 0) !== n ||
        (safeLengths.length | 0) !== n
    ) {
        return -1;
    }

    const groupsPtr = mallocI32AndCopy(backendModule, safeGroups);
    const filesPtr = mallocI32AndCopy(backendModule, safeFiles);
    const offsetsPtr = mallocI32AndCopy(backendModule, safeOffsets);
    const lengthsPtr = mallocI32AndCopy(backendModule, safeLengths);
    const bytesPtr = mallocU8AndCopy(backendModule, safeBytes);
    try {
        return putBlobBatch(
            runtimeHandle | 0,
            domain | 0,
            groupsPtr,
            filesPtr,
            offsetsPtr,
            lengthsPtr,
            n,
            bytesPtr,
            safeBytes.length | 0,
        ) | 0;
    } finally {
        if (groupsPtr) backendModule._free(groupsPtr);
        if (filesPtr) backendModule._free(filesPtr);
        if (offsetsPtr) backendModule._free(offsetsPtr);
        if (lengthsPtr) backendModule._free(lengthsPtr);
        if (bytesPtr) backendModule._free(bytesPtr);
    }
}

function runtimeCacheClearBlobDomainWithWasm(backendModule, runtimeHandle, domain) {
    const clearBlobDomain = getRuntimeCacheClearBlobDomainExport(backendModule);
    if (typeof clearBlobDomain !== "function") {
        return -1;
    }
    return clearBlobDomain(runtimeHandle | 0, domain | 0) | 0;
}

function runtimeCacheClearAllBlobsWithWasm(backendModule, runtimeHandle) {
    const clearAllBlobs = getRuntimeCacheClearAllBlobsExport(backendModule);
    if (typeof clearAllBlobs !== "function") {
        return -1;
    }
    return clearAllBlobs(runtimeHandle | 0) | 0;
}

function runtimeDebugGetLastBuildFailureWithWasm(backendModule, runtimeHandle) {
    const fn = getRuntimeDebugGetLastBuildFailureExport(backendModule);
    if (typeof fn !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 4);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = fn(runtimeHandle | 0, outPtr, 4) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const out = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 4);
        return {
            stage: out[0] | 0,
            status: out[1] | 0,
            detail0: out[2] | 0,
            detail1: out[3] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

function runtimeDebugGetLastCollectMapInputWithWasm(backendModule, runtimeHandle) {
    const fn = getRuntimeDebugGetLastCollectMapInputExport(backendModule);
    if (typeof fn !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 12);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = fn(runtimeHandle | 0, outPtr, 12) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const out = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 12);
        return {
            status: out[0] | 0,
            reason: out[1] | 0,
            mapStartX: out[2] | 0,
            mapStartY: out[3] | 0,
            mapEndX: out[4] | 0,
            mapEndY: out[5] | 0,
            expectedSquares: out[6] | 0,
            squaresWithAny: out[7] | 0,
            squaresWithTerrain: out[8] | 0,
            squaresWithLoc: out[9] | 0,
            firstPresentMapSquareId: out[10] | 0,
            firstMissingMapSquareId: out[11] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

function runtimeDebugGetLastCommandStreamStatusWithWasm(backendModule, runtimeHandle) {
    const fn = getRuntimeDebugGetLastCommandStreamStatusExport(backendModule);
    if (typeof fn !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 1);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = fn(runtimeHandle | 0, outPtr, 1) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        return backendModule.HEAP32[outPtr >> 2] | 0;
    } finally {
        backendModule._free(outPtr);
    }
}

function runtimeDebugGetLastLegacyModelLoadWithWasm(backendModule, runtimeHandle) {
    const fn = getRuntimeDebugGetLastLegacyModelLoadExport(backendModule);
    if (typeof fn !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 3);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = fn(runtimeHandle | 0, outPtr, 3) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const out = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 3);
        return {
            modelId: out[0] | 0,
            status: out[1] | 0,
            missingFile: out[2] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
}

function runtimeDebugGetLastMissingTypeWithWasm(backendModule, runtimeHandle) {
    const fn = getRuntimeDebugGetLastMissingTypeExport(backendModule);
    if (typeof fn !== "function") {
        return undefined;
    }
    const outPtr = mallocI32(backendModule, 2);
    if (!outPtr) {
        return undefined;
    }
    try {
        const status = fn(runtimeHandle | 0, outPtr, 2) | 0;
        if (status !== RUNTIME_STATUS_OK) {
            return undefined;
        }
        const out = backendModule.HEAP32.slice(outPtr >> 2, (outPtr >> 2) + 2);
        return {
            kind: out[0] | 0,
            id: out[1] | 0,
        };
    } finally {
        backendModule._free(outPtr);
    }
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

function parseRuntimePacketFromMetaArray(backendModule, meta) {
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
    const usedTextureIdsPtr = meta[44] >>> 0;
    const usedTextureIdsLen = meta[45] | 0;
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
        usedTextureIdsLen < 0 ||
        packetVersion !== RUNTIME_PACKET_VERSION
    ) {
        return undefined;
    }
    const bucketCmdCounts = copyI32FromHeap(backendModule, bucketCmdCountsPtr, bucketCmdCountsLen);
    const bucketModelInfoLengths = copyI32FromHeap(
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
        modelInfoTextureBuckets[bucket] = copyU16FromHeap(backendModule, ptr, len);
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
        heightMapTextureData: copyI16FromHeap(backendModule, heightMapPtr, heightMapLen),
        levels: meta[6] | 0,
        sizeX: meta[7] | 0,
        sizeY: meta[8] | 0,
        unitsTileHeightBasis: meta[9] | 0,
        totalModelInfoLength,
        packetVersion,
        drawRangesPacked: copyI32FromHeap(backendModule, drawRangesPackedPtr, drawRangesPackedLen),
        vertices: copyU8FromHeap(backendModule, verticesPtr, verticesLen),
        indices: copyI32FromHeap(backendModule, indicesPtr, indicesLen),
        npcDrawRangesBase: copyI32FromHeap(backendModule, npcDrawRangesBasePtr, npcDrawRangesBaseLen),
        npcDrawRangesAlpha: copyI32FromHeap(backendModule, npcDrawRangesAlphaPtr, npcDrawRangesAlphaLen),
        npcVertices: copyU8FromHeap(backendModule, npcVerticesPtr, npcVerticesLen),
        npcIndices: copyI32FromHeap(backendModule, npcIndicesPtr, npcIndicesLen),
        npcOrderKeys: copyI32FromHeap(backendModule, npcOrderKeysPtr, npcOrderKeysLen),
        usedTextureIds: copyI32FromHeap(backendModule, usedTextureIdsPtr, usedTextureIdsLen),
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
            console.warn("[map-render-backend] buildMapPacketFromCache failed", {
                runtimeHandle: runtimeHandle | 0,
                mapX: request?.mapX | 0,
                mapY: request?.mapY | 0,
                borderSize: request?.borderSize | 0,
                sizeX: request?.sizeX | 0,
                sizeY: request?.sizeY | 0,
                buildStatus,
            });
            return undefined;
        }
        packetHandle = backendModule.HEAP32[outHandlePtr >> 2] | 0;
        if (packetHandle <= 0) {
            console.warn("[map-render-backend] buildMapPacketFromCache produced invalid packet handle", {
                runtimeHandle: runtimeHandle | 0,
                mapX: request?.mapX | 0,
                mapY: request?.mapY | 0,
                packetHandle,
            });
            return undefined;
        }
        const metaStatus = getPacketMeta(packetHandle | 0, metaPtr, metaLength) | 0;
        if (metaStatus !== 1) {
            console.warn("[map-render-backend] buildMapPacketFromCache getPacketMeta failed", {
                runtimeHandle: runtimeHandle | 0,
                mapX: request?.mapX | 0,
                mapY: request?.mapY | 0,
                packetHandle,
                metaStatus,
            });
            releasePacket(packetHandle | 0);
            return undefined;
        }
        const meta = backendModule.HEAP32.slice(metaPtr >> 2, (metaPtr >> 2) + metaLength);
        const parsed = parseRuntimePacketFromMetaArray(backendModule, meta);
        // Parsed packets are deep-copied out of the wasm heap, so we can release the packet handle
        // before returning to the caller.
        releasePacket(packetHandle | 0);
        packetHandle = 0;
        if (!parsed) {
            console.warn("[map-render-backend] buildMapPacketFromCache failed to parse packet meta", {
                runtimeHandle: runtimeHandle | 0,
                mapX: request?.mapX | 0,
                mapY: request?.mapY | 0,
                packetHandle,
            });
        }
        return parsed;
    } finally {
        if ((packetHandle | 0) > 0) {
            releasePacket(packetHandle | 0);
        }
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
        return true;
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
    },
    async cacheSetVarps(runtimeHandle, varps) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheSetVarpsWithWasm(backendModule, runtimeHandle, varps);
    },
    async cachePutBlobBatch(runtimeHandle, domain, groups, files, offsets, lengths, bytes) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCachePutBlobBatchWithWasm(
            backendModule,
            runtimeHandle,
            domain,
            groups,
            files,
            offsets,
            lengths,
            bytes,
        );
    },
    async cacheClearBlobDomain(runtimeHandle, domain) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheClearBlobDomainWithWasm(backendModule, runtimeHandle, domain);
    },
    async cacheClearAllBlobs(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheClearAllBlobsWithWasm(backendModule, runtimeHandle);
    },
    async debugGetLastBuildFailure(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastBuildFailureWithWasm(backendModule, runtimeHandle);
    },
    async debugGetLastCollectMapInput(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastCollectMapInputWithWasm(backendModule, runtimeHandle);
    },
    async debugGetLastCommandStreamStatus(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastCommandStreamStatusWithWasm(backendModule, runtimeHandle);
    },
    async debugGetLastLegacyModelLoad(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLegacyModelLoadWithWasm(backendModule, runtimeHandle);
    },
    async debugGetLastMissingType(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastMissingTypeWithWasm(backendModule, runtimeHandle);
    },
    async cacheSetBuildConfig(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeCacheSetBuildConfigWithWasm(backendModule, runtimeHandle, request);
    },
    async getLastMissingBlobEntries(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeGetLastMissingBlobEntriesWithWasm(backendModule, runtimeHandle);
    },
    async debugBuildMapPlanFromCache(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return -1;
        }
        return runtimeDebugBuildMapPlanFromCacheWithWasm(backendModule, runtimeHandle, request);
    },
    async buildMapPacketFromCache(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeBuildMapPacketFromCacheWithWasm(backendModule, runtimeHandle, request);
    },
    setTickState(runtimeHandle, stateKey, input) {
        if (!backendModuleInstance) {
            return false;
        }
        return setRuntimeTickStateWithWasm(backendModuleInstance, runtimeHandle, stateKey, input);
    },
    setTickStatePacked(runtimeHandle, stateKey, packed) {
        if (!backendModuleInstance) {
            return false;
        }
        return setRuntimeTickStatePackedWithWasm(
            backendModuleInstance,
            runtimeHandle,
            stateKey,
            packed,
        );
    },
    clearTickState(runtimeHandle, stateKey) {
        if (!backendModuleInstance) {
            return;
        }
        clearRuntimeTickStateWithWasm(backendModuleInstance, runtimeHandle, stateKey);
    },
    hasTickState(runtimeHandle, stateKey) {
        if (!backendModuleInstance) {
            return false;
        }
        return runtimeHasTickStateWithWasm(backendModuleInstance, runtimeHandle, stateKey);
    },
    tickMapsEmitPatchStreams(runtimeHandle, stateKeys, cycleNowFixed, clientTickCount) {
        if (!backendModuleInstance) {
            return undefined;
        }
        return tickRuntimeMapsEmitPatchStreamsWithWasm(
            backendModuleInstance,
            runtimeHandle | 0,
            stateKeys,
            cycleNowFixed | 0,
            clientTickCount | 0,
        );
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
        backendModulePromise = undefined;
        backendModuleInstance = undefined;
    },
};
