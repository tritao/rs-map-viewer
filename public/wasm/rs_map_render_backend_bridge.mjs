let backendModulePromise;
const CAP_HEIGHTMAP = 1 << 0;
const CAP_NPC_DECODE = 1 << 1;
const CAP_DRAW_PACK = 1 << 2;

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
                typeof backendModule._rs_heightmap_from_scene_tile_heights !== "function" ||
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
                (backendModule.__rsCapabilities & CAP_DRAW_PACK) !== 0 &&
                typeof backendModule._rs_pack_draw_commands !== "function"
            ) {
                console.warn(
                    "[map-render-backend] draw-pack capability advertised but export is missing",
                );
                backendModule.__rsCapabilities &= ~CAP_DRAW_PACK;
            }
            return backendModule;
        } catch (e) {
            console.warn(`[map-render-backend] failed to load wasm backend: ${String(e)}`);
            return undefined;
        }
    })();
    return backendModulePromise;
}

function buildHeightMapWithWasm(backendModule, staging) {
    if ((backendModule.__rsCapabilities & CAP_HEIGHTMAP) === 0) {
        return undefined;
    }
    const tileHeights = staging.sceneTileHeights;
    const levels = staging.levels | 0;
    const sizeX = staging.sizeX | 0;
    const sizeY = staging.sizeY | 0;
    const unitsTileHeightBasis = staging.unitsTileHeightBasis | 0;
    const outLength = (levels * sizeX * sizeY) | 0;
    if (
        !(tileHeights instanceof Int32Array) ||
        levels <= 0 ||
        sizeX <= 0 ||
        sizeY <= 0 ||
        unitsTileHeightBasis <= 0 ||
        outLength <= 0
    ) {
        return undefined;
    }

    const inBytes = tileHeights.length * 4;
    const outBytes = outLength * 2;
    const inPtr = backendModule._malloc(inBytes);
    const outPtr = backendModule._malloc(outBytes);
    if (!inPtr || !outPtr) {
        if (inPtr) backendModule._free(inPtr);
        if (outPtr) backendModule._free(outPtr);
        return undefined;
    }

    try {
        backendModule.HEAP32.set(tileHeights, inPtr >> 2);
        const ok = backendModule._rs_heightmap_from_scene_tile_heights(
            inPtr,
            levels,
            sizeX,
            sizeY,
            unitsTileHeightBasis,
            outPtr,
            outLength,
        );
        if (ok !== 1) {
            return undefined;
        }
        const heightMap = new Int16Array(outLength);
        heightMap.set(backendModule.HEAP16.subarray(outPtr >> 1, (outPtr >> 1) + outLength));
        return heightMap;
    } finally {
        backendModule._free(inPtr);
        backendModule._free(outPtr);
    }
}

function modelInfoLengthFromInstanceCounts(instanceCounts, cmdCount) {
    let totalInstances = 0;
    for (let i = 0; i < instanceCounts.length; i++) {
        totalInstances += instanceCounts[i] | 0;
    }
    const dataLength = Math.ceil((cmdCount * 4 + totalInstances) / 16) * 16;
    return Math.max(dataLength, 16) * 4;
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

const drawPackScratch = {
    offsets: new Int32Array(0),
    elements: new Int32Array(0),
    instanceCounts: new Int32Array(0),
    packedInstances: new Int32Array(0),
};

function ensureInt32Scratch(name, minLength) {
    const current = drawPackScratch[name];
    if (current.length >= minLength) {
        return current;
    }
    const nextLength = Math.max(minLength, current.length * 2, 16);
    const next = new Int32Array(nextLength);
    drawPackScratch[name] = next;
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

function packDrawBucketWithWasm(backendModule, drawCommands) {
    const cmdCount = drawCommands.length | 0;
    if (cmdCount === 0) {
        return {
            drawRanges: [],
            modelInfo: new Uint16Array(64),
        };
    }

    const offsetsScratch = ensureInt32Scratch("offsets", cmdCount);
    const elementsScratch = ensureInt32Scratch("elements", cmdCount);
    const countsScratch = ensureInt32Scratch("instanceCounts", cmdCount);
    const offsets = offsetsScratch.subarray(0, cmdCount);
    const elements = elementsScratch.subarray(0, cmdCount);
    const instanceCounts = countsScratch.subarray(0, cmdCount);
    let totalInstances = 0;
    for (let i = 0; i < cmdCount; i++) {
        const command = drawCommands[i];
        offsets[i] = command.offset | 0;
        elements[i] = command.elements | 0;
        const instanceCount = command.instances.length | 0;
        instanceCounts[i] = instanceCount;
        totalInstances += instanceCount;
    }
    const packedInstancesLength = totalInstances * 8;
    const packedInstancesScratch = ensureInt32Scratch("packedInstances", packedInstancesLength);
    const packedInstances = packedInstancesScratch.subarray(0, packedInstancesLength);
    let instanceOffset = 0;
    for (let i = 0; i < cmdCount; i++) {
        const command = drawCommands[i];
        for (let j = 0; j < command.instances.length; j++) {
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

    const expectedModelInfoLength = modelInfoLengthFromInstanceCounts(instanceCounts, cmdCount);
    const drawRangesLength = cmdCount * 3;
    const inOffsetsPtr = backendModule._malloc(cmdCount * 4);
    const inElementsPtr = backendModule._malloc(cmdCount * 4);
    const inCountsPtr = backendModule._malloc(cmdCount * 4);
    const inInstancesPtr = packedInstances.length > 0 ? backendModule._malloc(packedInstances.length * 4) : 0;
    const outDrawRangesPtr = backendModule._malloc(drawRangesLength * 4);
    const outModelInfoPtr = backendModule._malloc(expectedModelInfoLength * 2);
    if (
        !inOffsetsPtr ||
        !inElementsPtr ||
        !inCountsPtr ||
        (packedInstances.length > 0 && !inInstancesPtr) ||
        !outDrawRangesPtr ||
        !outModelInfoPtr
    ) {
        if (inOffsetsPtr) backendModule._free(inOffsetsPtr);
        if (inElementsPtr) backendModule._free(inElementsPtr);
        if (inCountsPtr) backendModule._free(inCountsPtr);
        if (inInstancesPtr) backendModule._free(inInstancesPtr);
        if (outDrawRangesPtr) backendModule._free(outDrawRangesPtr);
        if (outModelInfoPtr) backendModule._free(outModelInfoPtr);
        return undefined;
    }

    try {
        backendModule.HEAP32.set(offsets, inOffsetsPtr >> 2);
        backendModule.HEAP32.set(elements, inElementsPtr >> 2);
        backendModule.HEAP32.set(instanceCounts, inCountsPtr >> 2);
        if (packedInstances.length > 0) {
            backendModule.HEAP32.set(packedInstances, inInstancesPtr >> 2);
        }

        const ok = backendModule._rs_pack_draw_commands(
            inOffsetsPtr,
            inElementsPtr,
            inCountsPtr,
            cmdCount,
            inInstancesPtr,
            packedInstances.length | 0,
            outDrawRangesPtr,
            drawRangesLength,
            outModelInfoPtr,
            expectedModelInfoLength,
        );
        if (ok !== 1) {
            return undefined;
        }

        const drawRangesPacked = backendModule.HEAP32.subarray(
            outDrawRangesPtr >> 2,
            (outDrawRangesPtr >> 2) + drawRangesLength,
        );
        const drawRanges = new Array(cmdCount);
        for (let i = 0; i < cmdCount; i++) {
            const off = i * 3;
            drawRanges[i] = [
                drawRangesPacked[off + 0] | 0,
                drawRangesPacked[off + 1] | 0,
                drawRangesPacked[off + 2] | 0,
            ];
        }

        const modelInfo = new Uint16Array(expectedModelInfoLength);
        modelInfo.set(
            backendModule.HEAPU16.subarray(
                outModelInfoPtr >> 1,
                (outModelInfoPtr >> 1) + expectedModelInfoLength,
            ),
        );

        return {
            drawRanges,
            modelInfo,
        };
    } finally {
        backendModule._free(inOffsetsPtr);
        backendModule._free(inElementsPtr);
        backendModule._free(inCountsPtr);
        backendModule._free(inInstancesPtr);
        backendModule._free(outDrawRangesPtr);
        backendModule._free(outModelInfoPtr);
    }
}

export const __mapRenderBridgeInternals = {
    modelInfoLengthFromDrawCommands,
    validateStagingAgainstPayload,
    validateStagingDrawCommands,
};

function buildDrawRangesAndModelInfoWithWasm(backendModule, staging) {
    if ((backendModule.__rsCapabilities & CAP_DRAW_PACK) === 0) {
        return undefined;
    }
    if (typeof backendModule._rs_pack_draw_commands !== "function") {
        return undefined;
    }
    if (!staging.drawCommands) {
        return undefined;
    }

    const drawRanges = {};
    const modelInfoTextures = {};
    for (const key of DRAW_BUCKET_KEYS) {
        const packed = packDrawBucketWithWasm(backendModule, staging.drawCommands[key]);
        if (!packed) {
            return undefined;
        }
        drawRanges[key] = packed.drawRanges;
        modelInfoTextures[key] = packed.modelInfo;
    }

    return {
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
        const heightMapTextureData = buildHeightMapWithWasm(backendModule, tsPayloadResult.data.staging);
        if (!heightMapTextureData) {
            return tsPayloadResult;
        }
        const drawPackResult = buildDrawRangesAndModelInfoWithWasm(
            backendModule,
            tsPayloadResult.data.staging,
        );
        if (!drawPackResult) {
            return tsPayloadResult;
        }
        return {
            data: {
                ...tsPayloadResult.data,
                heightMapTextureData,
                drawRanges: drawPackResult.drawRanges,
                modelInfoTextures: drawPackResult.modelInfoTextures,
                staging: undefined,
            },
        };
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
        backendModulePromise = undefined;
    },
};

export default cppWasmMapRenderDataBridge;
