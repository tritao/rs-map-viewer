let backendModulePromise;
const CAP_HEIGHTMAP = 1 << 0;
const CAP_NPC_DECODE = 1 << 1;

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

    const drawRanges = payload.drawRanges;
    const drawRangeCounts = staging.drawRangeCounts;
    if (!drawRanges || !drawRangeCounts) {
        return "missing draw range metadata";
    }
    const drawRangeKeys = [
        "base",
        "alpha",
        "lod",
        "lodAlpha",
        "interact",
        "interactAlpha",
        "interactLod",
        "interactLodAlpha",
    ];
    for (const key of drawRangeKeys) {
        const ranges = drawRanges[key];
        if (!Array.isArray(ranges)) {
            return `drawRanges.${key} must be an array`;
        }
        const expected = drawRangeCounts[key] | 0;
        if (ranges.length !== expected) {
            return `drawRanges.${key} length mismatch expected=${expected} got=${ranges.length}`;
        }
    }

    const modelInfoTextures = payload.modelInfoTextures;
    const modelInfoLengths = staging.modelInfoLengths;
    if (!modelInfoTextures || !modelInfoLengths) {
        return "missing model info metadata";
    }
    const modelInfoKeys = [
        "base",
        "alpha",
        "lod",
        "lodAlpha",
        "interact",
        "interactAlpha",
        "interactLod",
        "interactLodAlpha",
    ];
    for (const key of modelInfoKeys) {
        const values = modelInfoTextures[key];
        if (!values || typeof values.length !== "number") {
            return `modelInfoTextures.${key} must be typed array`;
        }
        const expected = modelInfoLengths[key] | 0;
        if ((values.length | 0) !== expected) {
            return `modelInfoTextures.${key} length mismatch expected=${expected} got=${values.length}`;
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
        return {
            data: {
                ...tsPayloadResult.data,
                heightMapTextureData,
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
