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

function modelInfoLengthFromDrawCommands(drawCommands) {
    let totalInstances = 0;
    for (let i = 0; i < drawCommands.length; i++) {
        totalInstances += drawCommands[i].instances.length | 0;
    }
    const dataLength = Math.ceil((drawCommands.length * 4 + totalInstances) / 16) * 16;
    return Math.max(dataLength, 16) * 4;
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

const scenePackFlattenScratch = {
    offsets: new Int32Array(0),
    elements: new Int32Array(0),
    instanceCounts: new Int32Array(0),
    packedInstances: new Int32Array(0),
};

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

function ensureInt32Scratch(name, minLength) {
    const current = scenePackFlattenScratch[name];
    if (current.length >= minLength) {
        return current;
    }
    const nextLength = Math.max(minLength, current.length * 2, 16);
    const next = new Int32Array(nextLength);
    scenePackFlattenScratch[name] = next;
    return next;
}

function validateStagingDrawCommands(staging) {
    const drawCommands = staging.drawCommands;
    if (!drawCommands) {
        return undefined;
    }
    for (const key of DRAW_BUCKET_KEYS) {
        const bucket = drawCommands[key];
        if (!Array.isArray(bucket)) {
            return `drawCommands.${key} must be an array`;
        }
        for (let i = 0; i < bucket.length; i++) {
            const command = bucket[i];
            if (!command || !Array.isArray(command.instances)) {
                return `drawCommands.${key}[${i}] missing instances array`;
            }
            if (!Number.isFinite(command.offset) || !Number.isFinite(command.elements)) {
                return `drawCommands.${key}[${i}] offset/elements must be finite numbers`;
            }
            for (let j = 0; j < command.instances.length; j++) {
                const instance = command.instances[j];
                if (
                    !instance ||
                    !Number.isFinite(instance.sceneX) ||
                    !Number.isFinite(instance.sceneZ) ||
                    !Number.isFinite(instance.heightOffset) ||
                    !Number.isFinite(instance.level) ||
                    !Number.isFinite(instance.contourGround) ||
                    !Number.isFinite(instance.priority) ||
                    !Number.isFinite(instance.interactType) ||
                    !Number.isFinite(instance.interactId)
                ) {
                    return `drawCommands.${key}[${i}].instances[${j}] contains non-numeric fields`;
                }
            }
        }
    }
    return undefined;
}

function flattenStagingDrawCommands(drawCommands) {
    const bucketCmdCounts = new Int32Array(DRAW_BUCKET_KEYS.length);
    const bucketModelInfoLengths = new Int32Array(DRAW_BUCKET_KEYS.length);

    let totalCmdCount = 0;
    let totalInstances = 0;
    let modelInfoConcatLength = 0;
    for (let bucket = 0; bucket < DRAW_BUCKET_KEYS.length; bucket++) {
        const key = DRAW_BUCKET_KEYS[bucket];
        const commands = drawCommands[key];
        const cmdCount = commands.length | 0;
        bucketCmdCounts[bucket] = cmdCount;
        totalCmdCount += cmdCount;
        for (let i = 0; i < cmdCount; i++) {
            totalInstances += commands[i].instances.length | 0;
        }
        const modelInfoLength = modelInfoLengthFromDrawCommands(commands) | 0;
        bucketModelInfoLengths[bucket] = modelInfoLength;
        modelInfoConcatLength += modelInfoLength;
    }

    const offsetsScratch = ensureInt32Scratch("offsets", totalCmdCount);
    const elementsScratch = ensureInt32Scratch("elements", totalCmdCount);
    const countsScratch = ensureInt32Scratch("instanceCounts", totalCmdCount);
    const packedInstancesScratch = ensureInt32Scratch("packedInstances", totalInstances * 8);
    const offsets = offsetsScratch.subarray(0, totalCmdCount);
    const elements = elementsScratch.subarray(0, totalCmdCount);
    const instanceCounts = countsScratch.subarray(0, totalCmdCount);
    const packedInstances = packedInstancesScratch.subarray(0, totalInstances * 8);

    let cmdOffset = 0;
    let instanceOffset = 0;
    for (let bucket = 0; bucket < DRAW_BUCKET_KEYS.length; bucket++) {
        const key = DRAW_BUCKET_KEYS[bucket];
        const commands = drawCommands[key];
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            offsets[cmdOffset] = command.offset | 0;
            elements[cmdOffset] = command.elements | 0;
            const count = command.instances.length | 0;
            instanceCounts[cmdOffset] = count;
            cmdOffset++;
            for (let j = 0; j < count; j++) {
                const instance = command.instances[j];
                packedInstances[instanceOffset++] = instance.sceneX | 0;
                packedInstances[instanceOffset++] = instance.sceneZ | 0;
                packedInstances[instanceOffset++] = instance.heightOffset | 0;
                packedInstances[instanceOffset++] = instance.level | 0;
                packedInstances[instanceOffset++] = instance.contourGround | 0;
                packedInstances[instanceOffset++] = instance.priority | 0;
                packedInstances[instanceOffset++] = instance.interactType | 0;
                packedInstances[instanceOffset++] = instance.interactId | 0;
            }
        }
    }

    return {
        bucketCmdCounts,
        bucketModelInfoLengths,
        totalCmdCount,
        modelInfoConcatLength,
        offsets,
        elements,
        instanceCounts,
        packedInstances,
    };
}

export const __mapRenderBridgeInternals = {
    modelInfoLengthFromDrawCommands,
    validateStagingAgainstPayload,
    validateStagingDrawCommands,
};

function buildSceneWithWasm(backendModule, staging) {
    if ((backendModule.__rsCapabilities & CAP_SCENE_PACK) === 0) {
        return undefined;
    }
    if (typeof backendModule._rs_pack_scene_staging !== "function") {
        return undefined;
    }
    if (!staging.drawCommands) {
        return undefined;
    }
    const tileHeights = staging.sceneTileHeights;
    const levels = staging.levels | 0;
    const sizeX = staging.sizeX | 0;
    const sizeY = staging.sizeY | 0;
    const unitsTileHeightBasis = staging.unitsTileHeightBasis | 0;
    if (
        !(tileHeights instanceof Int32Array) ||
        levels <= 0 ||
        sizeX <= 0 ||
        sizeY <= 0 ||
        unitsTileHeightBasis <= 0
    ) {
        return undefined;
    }

    const flattened = flattenStagingDrawCommands(staging.drawCommands);
    const drawRangesLength = flattened.totalCmdCount * 3;
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
        flattened.bucketCmdCounts.length,
        4,
    );
    const inOffsetsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "offsets",
        flattened.totalCmdCount,
        4,
    );
    const inElementsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "elements",
        flattened.totalCmdCount,
        4,
    );
    const inInstanceCountsPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "instanceCounts",
        flattened.totalCmdCount,
        4,
    );
    const inPackedInstancesPtr = ensureScenePackHeapBuffer(
        backendModule,
        scenePackHeapScratch.i32,
        "packedInstances",
        flattened.packedInstances.length,
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
        flattened.modelInfoConcatLength,
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
        (flattened.totalCmdCount > 0 && (!inOffsetsPtr || !inElementsPtr || !inInstanceCountsPtr)) ||
        (flattened.packedInstances.length > 0 && !inPackedInstancesPtr) ||
        (drawRangesLength > 0 && !outDrawRangesPtr) ||
        !outModelInfoConcatPtr ||
        !outHeightMapPtr
    ) {
        clearScenePackHeapScratch();
        return undefined;
    }

    backendModule.HEAP32.set(tileHeights, inHeightsPtr >> 2);
    backendModule.HEAP32.set(flattened.bucketCmdCounts, inBucketCountsPtr >> 2);
    if (flattened.totalCmdCount > 0) {
        backendModule.HEAP32.set(flattened.offsets, inOffsetsPtr >> 2);
        backendModule.HEAP32.set(flattened.elements, inElementsPtr >> 2);
        backendModule.HEAP32.set(flattened.instanceCounts, inInstanceCountsPtr >> 2);
    }
    if (flattened.packedInstances.length > 0) {
        backendModule.HEAP32.set(flattened.packedInstances, inPackedInstancesPtr >> 2);
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
        flattened.totalCmdCount | 0,
        inPackedInstancesPtr,
        flattened.packedInstances.length | 0,
        outDrawRangesPtr,
        drawRangesLength,
        outModelInfoConcatPtr,
        flattened.modelInfoConcatLength | 0,
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
    const modelInfoConcat = new Uint16Array(flattened.modelInfoConcatLength);
    modelInfoConcat.set(
        backendModule.HEAPU16.subarray(
            outModelInfoConcatPtr >> 1,
            (outModelInfoConcatPtr >> 1) + flattened.modelInfoConcatLength,
        ),
    );

    const drawRanges = {};
    const modelInfoTextures = {};
    let cmdCursor = 0;
    let modelInfoCursor = 0;
    for (let bucket = 0; bucket < DRAW_BUCKET_KEYS.length; bucket++) {
        const key = DRAW_BUCKET_KEYS[bucket];
        const cmdCount = flattened.bucketCmdCounts[bucket] | 0;
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

        const modelInfoLength = flattened.bucketModelInfoLengths[bucket] | 0;
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

function validateStagingAgainstPayload(payload) {
    const staging = payload?.staging;
    if (!staging) {
        return "missing staging payload";
    }
    const levels = staging.levels | 0;
    const sizeX = staging.sizeX | 0;
    const sizeY = staging.sizeY | 0;
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0) {
        return `invalid staging dimensions levels=${levels} sizeX=${sizeX} sizeY=${sizeY}`;
    }
    const expectedSceneHeightsLength = levels * (sizeX + 1) * (sizeY + 1);
    if (!(staging.sceneTileHeights instanceof Int32Array)) {
        return "staging.sceneTileHeights must be Int32Array";
    }
    if (staging.sceneTileHeights.length !== expectedSceneHeightsLength) {
        return `staging.sceneTileHeights length mismatch expected=${expectedSceneHeightsLength} got=${staging.sceneTileHeights.length}`;
    }
    const drawCommandError = validateStagingDrawCommands(staging);
    if (drawCommandError) {
        return drawCommandError;
    }
    if (staging.drawCommands) {
        for (const key of DRAW_BUCKET_KEYS) {
            const expectedDrawRangeCount = staging.drawCommands[key].length | 0;
            const drawRangeLength = payload.drawRanges[key]?.length | 0;
            if (drawRangeLength !== expectedDrawRangeCount && drawRangeLength !== 0) {
                return `drawRanges.${key} length mismatch expected=${expectedDrawRangeCount} got=${drawRangeLength}`;
            }
            const expectedModelInfoLength = modelInfoLengthFromDrawCommands(staging.drawCommands[key]);
            const modelInfoLength = payload.modelInfoTextures[key]?.length | 0;
            if (modelInfoLength !== expectedModelInfoLength && modelInfoLength !== 0) {
                return `modelInfoTextures.${key} length mismatch expected=${expectedModelInfoLength} got=${modelInfoLength}`;
            }
        }
    }

    return undefined;
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
        if (!tsPayloadResult?.data?.staging) {
            return tsPayloadResult;
        }
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return tsPayloadResult;
        }
        const stagingError = validateStagingAgainstPayload(tsPayloadResult.data);
        if (stagingError) {
            console.warn(`[map-render-backend] invalid staging payload: ${stagingError}`);
            return tsPayloadResult;
        }
        const scenePackResult = buildSceneWithWasm(backendModule, tsPayloadResult.data.staging);
        if (scenePackResult) {
            return {
                data: {
                    ...tsPayloadResult.data,
                    heightMapTextureData: scenePackResult.heightMapTextureData,
                    drawRanges: scenePackResult.drawRanges,
                    modelInfoTextures: scenePackResult.modelInfoTextures,
                    staging: undefined,
                },
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
