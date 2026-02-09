let backendModulePromise;
const CAP_NPC_DECODE = 1 << 1;
const CAP_SCENE_PACK = 1 << 3;

function createWasmModuleLocator(path) {
    return new URL(path, import.meta.url).href;
}

async function tryLoadBackendModule() {
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
            if (abiVersion !== 1) {
                console.warn(`[map-render-backend] unsupported wasm ABI version: ${abiVersion}`);
                return undefined;
            }
            backendModule.__rsCapabilities = backendModule._rs_map_render_bridge_capabilities() | 0;
            if (
                (backendModule.__rsCapabilities & CAP_SCENE_PACK) !== 0 &&
                typeof backendModule._rs_pack_scene_staging !== "function"
            ) {
                console.warn(
                    "[map-render-backend] scene-pack capability advertised but export is missing",
                );
                backendModule.__rsCapabilities &= ~CAP_SCENE_PACK;
            }
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

function newHeapScratchEntry() {
    return {
        ptr: 0,
        capacity: 0,
    };
}

const scenePackHeapScratch = {
    module: undefined,
    i32: {
        tileHeights: newHeapScratchEntry(),
        bucketCounts: newHeapScratchEntry(),
        offsets: newHeapScratchEntry(),
        elements: newHeapScratchEntry(),
        instanceCounts: newHeapScratchEntry(),
        packedInstances: newHeapScratchEntry(),
        outDrawRanges: newHeapScratchEntry(),
    },
    i16: {
        outHeightMap: newHeapScratchEntry(),
    },
    u16: {
        outModelInfoConcat: newHeapScratchEntry(),
    },
};

function freeHeapScratchGroup(module, group) {
    for (const value of Object.values(group)) {
        if (value.ptr) {
            module._free(value.ptr);
            value.ptr = 0;
            value.capacity = 0;
        }
    }
}

function clearScenePackHeapScratch() {
    const module = scenePackHeapScratch.module;
    if (!module) {
        return;
    }
    freeHeapScratchGroup(module, scenePackHeapScratch.i32);
    freeHeapScratchGroup(module, scenePackHeapScratch.i16);
    freeHeapScratchGroup(module, scenePackHeapScratch.u16);
    scenePackHeapScratch.module = undefined;
}

function prepareScenePackHeapScratch(backendModule) {
    if (scenePackHeapScratch.module && scenePackHeapScratch.module !== backendModule) {
        clearScenePackHeapScratch();
    }
    if (!scenePackHeapScratch.module) {
        scenePackHeapScratch.module = backendModule;
    }
}

function ensureScenePackHeapBuffer(backendModule, group, key, minLength, bytesPerElement) {
    if (minLength <= 0) {
        return 0;
    }
    const entry = group[key];
    if (entry.capacity >= minLength && entry.ptr) {
        return entry.ptr;
    }
    if (entry.ptr) {
        backendModule._free(entry.ptr);
        entry.ptr = 0;
        entry.capacity = 0;
    }
    const nextCapacity = Math.max(minLength, entry.capacity * 2, 16);
    const ptr = backendModule._malloc(nextCapacity * bytesPerElement);
    if (!ptr) {
        return 0;
    }
    entry.ptr = ptr;
    entry.capacity = nextCapacity;
    return ptr;
}


function modelInfoLengthFromCounts(cmdCount, totalInstances) {
    const dataLength = Math.ceil((cmdCount * 4 + totalInstances) / 16) * 16;
    return Math.max(dataLength, 16) * 4;
}

function validateScenePackInput(scenePackInput, payload) {
    if (!scenePackInput || typeof scenePackInput !== "object") {
        return "missing scenePackInput";
    }
    const levels = scenePackInput.levels | 0;
    const sizeX = scenePackInput.sizeX | 0;
    const sizeY = scenePackInput.sizeY | 0;
    const unitsTileHeightBasis = scenePackInput.unitsTileHeightBasis | 0;
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return `invalid scenePackInput dimensions levels=${levels} sizeX=${sizeX} sizeY=${sizeY} basis=${unitsTileHeightBasis}`;
    }
    const sceneTileHeights = scenePackInput.sceneTileHeights;
    if (!(sceneTileHeights instanceof Int32Array)) {
        return "scenePackInput.sceneTileHeights must be Int32Array";
    }
    const expectedHeightsLength = levels * (sizeX + 1) * (sizeY + 1);
    if (sceneTileHeights.length !== expectedHeightsLength) {
        return `scenePackInput.sceneTileHeights length mismatch expected=${expectedHeightsLength} got=${sceneTileHeights.length}`;
    }

    const bucketCmdCounts = scenePackInput.bucketCmdCounts;
    const bucketModelInfoLengths = scenePackInput.bucketModelInfoLengths;
    const cmdOffsets = scenePackInput.cmdOffsets;
    const cmdElements = scenePackInput.cmdElements;
    const cmdInstanceCounts = scenePackInput.cmdInstanceCounts;
    const packedInstances = scenePackInput.packedInstances;
    if (
        !(bucketCmdCounts instanceof Int32Array) ||
        !(bucketModelInfoLengths instanceof Int32Array) ||
        !(cmdOffsets instanceof Int32Array) ||
        !(cmdElements instanceof Int32Array) ||
        !(cmdInstanceCounts instanceof Int32Array) ||
        !(packedInstances instanceof Int32Array)
    ) {
        return "scenePackInput typed arrays are invalid";
    }
    if (bucketCmdCounts.length !== DRAW_BUCKET_KEYS.length) {
        return `scenePackInput.bucketCmdCounts length mismatch expected=${DRAW_BUCKET_KEYS.length} got=${bucketCmdCounts.length}`;
    }
    if (bucketModelInfoLengths.length !== DRAW_BUCKET_KEYS.length) {
        return `scenePackInput.bucketModelInfoLengths length mismatch expected=${DRAW_BUCKET_KEYS.length} got=${bucketModelInfoLengths.length}`;
    }
    if (cmdOffsets.length !== cmdElements.length || cmdOffsets.length !== cmdInstanceCounts.length) {
        return "scenePackInput command array lengths mismatch";
    }

    let totalCmdCount = 0;
    for (let bucket = 0; bucket < bucketCmdCounts.length; bucket++) {
        const count = bucketCmdCounts[bucket] | 0;
        if (count < 0) {
            return `scenePackInput.bucketCmdCounts[${bucket}] must be >= 0`;
        }
        totalCmdCount += count;
    }
    if (totalCmdCount !== cmdOffsets.length) {
        return `scenePackInput total cmd count mismatch expected=${totalCmdCount} got=${cmdOffsets.length}`;
    }

    let totalInstances = 0;
    let cmdCursor = 0;
    for (let bucket = 0; bucket < bucketCmdCounts.length; bucket++) {
        const bucketCmdCount = bucketCmdCounts[bucket] | 0;
        let bucketInstances = 0;
        for (let i = 0; i < bucketCmdCount; i++) {
            const count = cmdInstanceCounts[cmdCursor + i] | 0;
            if (count < 0) {
                return `scenePackInput.cmdInstanceCounts[${cmdCursor + i}] must be >= 0`;
            }
            bucketInstances += count;
        }
        const expectedModelInfoLength = modelInfoLengthFromCounts(bucketCmdCount, bucketInstances);
        if ((bucketModelInfoLengths[bucket] | 0) !== expectedModelInfoLength) {
            return `scenePackInput.bucketModelInfoLengths[${bucket}] mismatch expected=${expectedModelInfoLength} got=${bucketModelInfoLengths[bucket] | 0}`;
        }
        cmdCursor += bucketCmdCount;
        totalInstances += bucketInstances;
    }
    if (packedInstances.length !== totalInstances * 8) {
        return `scenePackInput.packedInstances length mismatch expected=${totalInstances * 8} got=${packedInstances.length}`;
    }

    if (payload) {
        const payloadLevels = payload.tileRenderFlags?.length | 0;
        const payloadSizeX = payload.tileRenderFlags?.[0]?.length | 0;
        const payloadSizeY = payload.tileRenderFlags?.[0]?.[0]?.length | 0;
        if (payloadLevels > 0 && payloadLevels !== levels) {
            return `scenePackInput.levels mismatch expected=${payloadLevels} got=${levels}`;
        }
        if (payloadSizeX > 0 && payloadSizeX !== sizeX) {
            return `scenePackInput.sizeX mismatch expected=${payloadSizeX} got=${sizeX}`;
        }
        if (payloadSizeY > 0 && payloadSizeY !== sizeY) {
            return `scenePackInput.sizeY mismatch expected=${payloadSizeY} got=${sizeY}`;
        }
    }

    return undefined;
}

export const __mapRenderBridgeInternals = {
    modelInfoLengthFromCounts,
    validateScenePackInput,
};

function buildSceneWithWasm(backendModule, scenePackInput) {
    if ((backendModule.__rsCapabilities & CAP_SCENE_PACK) === 0) {
        return undefined;
    }
    if (typeof backendModule._rs_pack_scene_staging !== "function") {
        return undefined;
    }
    const tileHeights = scenePackInput.sceneTileHeights;
    const levels = scenePackInput.levels | 0;
    const sizeX = scenePackInput.sizeX | 0;
    const sizeY = scenePackInput.sizeY | 0;
    const unitsTileHeightBasis = scenePackInput.unitsTileHeightBasis | 0;
    const bucketCmdCounts = scenePackInput.bucketCmdCounts;
    const bucketModelInfoLengths = scenePackInput.bucketModelInfoLengths;
    const cmdOffsets = scenePackInput.cmdOffsets;
    const cmdElements = scenePackInput.cmdElements;
    const cmdInstanceCounts = scenePackInput.cmdInstanceCounts;
    const packedInstances = scenePackInput.packedInstances;
    const totalCmdCount = cmdOffsets.length | 0;
    const drawRangesLength = totalCmdCount * 3;
    let modelInfoConcatLength = 0;
    for (let i = 0; i < bucketModelInfoLengths.length; i++) {
        modelInfoConcatLength += bucketModelInfoLengths[i] | 0;
    }
    const outHeightMapLength = levels * sizeX * sizeY;
    prepareScenePackHeapScratch(backendModule);

    const inHeightsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "tileHeights",
        tileHeights.length,
        4,
    );
    const inBucketCountsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "bucketCounts",
        bucketCmdCounts.length,
        4,
    );
    const inOffsetsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "offsets",
        totalCmdCount,
        4,
    );
    const inElementsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "elements",
        totalCmdCount,
        4,
    );
    const inInstanceCountsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "instanceCounts",
        totalCmdCount,
        4,
    );
    const inPackedInstancesPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "packedInstances",
        packedInstances.length,
        4,
    );
    const outDrawRangesPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "outDrawRanges",
        drawRangesLength,
        4,
    );
    const outModelInfoConcatPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.u16,
        "outModelInfoConcat",
        modelInfoConcatLength,
        2,
    );
    const outHeightMapPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i16,
        "outHeightMap",
        outHeightMapLength,
        2,
    );
    if (
        !inHeightsPtr ||
        !inBucketCountsPtr ||
        (totalCmdCount > 0 && (!inOffsetsPtr || !inElementsPtr || !inInstanceCountsPtr)) ||
        (packedInstances.length > 0 && !inPackedInstancesPtr) ||
        (drawRangesLength > 0 && !outDrawRangesPtr) ||
        !outModelInfoConcatPtr ||
        !outHeightMapPtr
    ) {
        clearScenePackHeapScratch();
        return undefined;
    }

    backendModule.HEAP32.set(tileHeights, inHeightsPtr >> 2);
    backendModule.HEAP32.set(bucketCmdCounts, inBucketCountsPtr >> 2);
    if (totalCmdCount > 0) {
        backendModule.HEAP32.set(cmdOffsets, inOffsetsPtr >> 2);
        backendModule.HEAP32.set(cmdElements, inElementsPtr >> 2);
        backendModule.HEAP32.set(cmdInstanceCounts, inInstanceCountsPtr >> 2);
    }
    if (packedInstances.length > 0) {
        backendModule.HEAP32.set(packedInstances, inPackedInstancesPtr >> 2);
    }

    const ok = backendModule._rs_pack_scene_staging(
        inHeightsPtr,
        levels,
        sizeX,
        sizeY,
        unitsTileHeightBasis,
        inBucketCountsPtr,
        inOffsetsPtr,
        inElementsPtr,
        inInstanceCountsPtr,
        totalCmdCount,
        inPackedInstancesPtr,
        packedInstances.length | 0,
        outDrawRangesPtr,
        drawRangesLength,
        outModelInfoConcatPtr,
        modelInfoConcatLength | 0,
        outHeightMapPtr,
        outHeightMapLength,
    );
    if (ok !== 1) {
        return undefined;
    }

    const heightMapTextureData = new Int16Array(outHeightMapLength);
    heightMapTextureData.set(
        backendModule.HEAP16.subarray(outHeightMapPtr >> 1, (outHeightMapPtr >> 1) + outHeightMapLength),
    );

    const drawRangesPacked = new Int32Array(drawRangesLength);
    if (drawRangesLength > 0) {
        drawRangesPacked.set(
            backendModule.HEAP32.subarray(
                outDrawRangesPtr >> 2,
                (outDrawRangesPtr >> 2) + drawRangesLength,
            ),
        );
    }
    const modelInfoConcat = new Uint16Array(modelInfoConcatLength);
    modelInfoConcat.set(
        backendModule.HEAPU16.subarray(
            outModelInfoConcatPtr >> 1,
            (outModelInfoConcatPtr >> 1) + modelInfoConcatLength,
        ),
    );

    const drawRanges = {};
    const modelInfoTextures = {};
    let cmdCursor = 0;
    let modelInfoCursor = 0;
    for (let bucket = 0; bucket < DRAW_BUCKET_KEYS.length; bucket++) {
        const key = DRAW_BUCKET_KEYS[bucket];
        const cmdCount = bucketCmdCounts[bucket] | 0;
        const bucketRanges = new Array(cmdCount);
        for (let i = 0; i < cmdCount; i++) {
            const off = (cmdCursor + i) * 3;
            bucketRanges[i] = [
                drawRangesPacked[off + 0] | 0,
                drawRangesPacked[off + 1] | 0,
                drawRangesPacked[off + 2] | 0,
            ];
        }
        drawRanges[key] = bucketRanges;
        cmdCursor += cmdCount;

        const modelInfoLength = bucketModelInfoLengths[bucket] | 0;
        const bucketModelInfo = new Uint16Array(modelInfoLength);
        bucketModelInfo.set(
            modelInfoConcat.subarray(modelInfoCursor, modelInfoCursor + modelInfoLength),
        );
        modelInfoTextures[key] = bucketModelInfo;
        modelInfoCursor += modelInfoLength;
    }

    return {
        heightMapTextureData,
        drawRanges,
        modelInfoTextures,
    };
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

export const cppWasmMapRenderDataBridge = {
    async buildMapData(_input, tsPayloadResult) {
        const payload = tsPayloadResult?.data;
        if (!payload) {
            return tsPayloadResult;
        }
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return tsPayloadResult;
        }

        const scenePackInput = tsPayloadResult.scenePackInput;
        if (!scenePackInput) {
            return tsPayloadResult;
        }

        const scenePackError = validateScenePackInput(scenePackInput, payload);
        if (scenePackError) {
            console.warn(`[map-render-backend] invalid scene-pack input: ${scenePackError}`);
            return tsPayloadResult;
        }
        const scenePackResult = buildSceneWithWasm(backendModule, scenePackInput);
        if (scenePackResult) {
            return {
                data: {
                    ...payload,
                    heightMapTextureData: scenePackResult.heightMapTextureData,
                    drawRanges: scenePackResult.drawRanges,
                    modelInfoTextures: scenePackResult.modelInfoTextures,
                },
                scenePackInput: undefined,
            };
        }
        return tsPayloadResult;
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
        clearScenePackHeapScratch();
        backendModulePromise = undefined;
    },
};

export default cppWasmMapRenderDataBridge;
