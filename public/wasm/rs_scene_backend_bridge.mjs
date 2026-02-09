let backendModulePromise;

const CAP_SCENE_BUILD = 1 << 0;
const MAP_SQUARE_SIZE = 64;
const SCENE_LEVELS = 4;
const LOC_PLACEMENT_STRIDE = 7;

function createWasmModuleLocator(path) {
    return new URL(path, import.meta.url).href;
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

function collectMapInput(input, mapBytesProvider) {
    const bounds = computeSceneBuildMapBounds(input.baseX, input.baseY, input.sizeX, input.sizeY);

    const mapSquareIds = [];
    const terrainOffsets = [];
    const terrainLengths = [];
    const locOffsets = [];
    const locLengths = [];
    const terrainChunks = [];
    const locChunks = [];
    let terrainLength = 0;
    let locLength = 0;

    for (let mapX = bounds.mapStartX; mapX < bounds.mapEndX; mapX++) {
        for (let mapY = bounds.mapStartY; mapY < bounds.mapEndY; mapY++) {
            const terrain = mapBytesProvider.getTerrainBytes(mapX, mapY);
            const loc = mapBytesProvider.getLocBytes(mapX, mapY);
            if (!terrain && !loc) {
                continue;
            }
            mapSquareIds.push(getMapSquareId(mapX, mapY));

            if (terrain && terrain.length > 0) {
                terrainOffsets.push(terrainLength);
                terrainLengths.push(terrain.length | 0);
                terrainChunks.push(terrain);
                terrainLength += terrain.length | 0;
            } else {
                terrainOffsets.push(-1);
                terrainLengths.push(-1);
            }

            if (loc && loc.length > 0) {
                locOffsets.push(locLength);
                locLengths.push(loc.length | 0);
                locChunks.push(loc);
                locLength += loc.length | 0;
            } else {
                locOffsets.push(-1);
                locLengths.push(-1);
            }
        }
    }

    return {
        mapSquareIds: Int32Array.from(mapSquareIds),
        terrainOffsets: Int32Array.from(terrainOffsets),
        terrainLengths: Int32Array.from(terrainLengths),
        terrainBytes: concatByteChunks(terrainChunks, terrainLength),
        locOffsets: Int32Array.from(locOffsets),
        locLengths: Int32Array.from(locLengths),
        locBytes: concatByteChunks(locChunks, locLength),
    };
}

function ensureHeapBuffer(module, typedArray) {
    if (!typedArray || typedArray.length === 0) {
        return 0;
    }
    const ptr = module._malloc(typedArray.byteLength);
    if (!ptr) {
        return 0;
    }
    if (typedArray instanceof Uint8Array) {
        module.HEAPU8.set(typedArray, ptr);
    } else if (typedArray instanceof Uint16Array) {
        module.HEAPU16.set(typedArray, ptr >> 1);
    } else if (typedArray instanceof Int16Array) {
        module.HEAP16.set(typedArray, ptr >> 1);
    } else {
        module.HEAP32.set(typedArray, ptr >> 2);
    }
    return ptr;
}

function allocHeapBuffer(module, length, bytesPerElement) {
    if (length <= 0) {
        return 0;
    }
    return module._malloc(length * bytesPerElement);
}

async function tryLoadBackendModule() {
    if (backendModulePromise) {
        return backendModulePromise;
    }
    backendModulePromise = (async () => {
        try {
            const mod = await import("./rs_scene_backend.js");
            const createModule = mod.default;
            if (typeof createModule !== "function") {
                console.warn("[scene-backend] wasm module factory export missing");
                return undefined;
            }
            const backendModule = await createModule({
                locateFile: createWasmModuleLocator,
            });
            if (
                typeof backendModule._rs_scene_bridge_abi_version !== "function" ||
                typeof backendModule._rs_scene_bridge_capabilities !== "function" ||
                typeof backendModule._rs_build_scene_data_from_map_squares !== "function" ||
                typeof backendModule._malloc !== "function" ||
                typeof backendModule._free !== "function"
            ) {
                console.warn("[scene-backend] wasm module missing required exports");
                return undefined;
            }
            const abiVersion = backendModule._rs_scene_bridge_abi_version() | 0;
            if (abiVersion !== 1) {
                console.warn(`[scene-backend] unsupported wasm ABI version: ${abiVersion}`);
                return undefined;
            }
            backendModule.__rsCapabilities = backendModule._rs_scene_bridge_capabilities() | 0;
            if ((backendModule.__rsCapabilities & CAP_SCENE_BUILD) === 0) {
                console.warn("[scene-backend] scene build capability missing");
                return undefined;
            }
            return backendModule;
        } catch (e) {
            console.warn(`[scene-backend] failed to load wasm backend: ${String(e)}`);
            return undefined;
        }
    })();
    return backendModulePromise;
}

export const cppWasmSceneBridge = {
    async buildSceneData(input, deps) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        if (!input || !deps?.mapBytesProvider || !deps?.sceneBuilder) {
            return undefined;
        }
        const sizeX = input.sizeX | 0;
        const sizeY = input.sizeY | 0;
        if (sizeX <= 0 || sizeY <= 0) {
            return undefined;
        }

        const packed = collectMapInput(input, deps.mapBytesProvider);
        const mapCount = packed.mapSquareIds.length | 0;

        const tileCount = SCENE_LEVELS * sizeX * sizeY;
        const heightCount = SCENE_LEVELS * (sizeX + 1) * (sizeY + 1);
        const locPlacementIntsCapacity =
            packed.locBytes.length > 0 ? (packed.locBytes.length * LOC_PLACEMENT_STRIDE) | 0 : 0;

        let mapSquareIdsPtr = 0;
        let terrainOffsetsPtr = 0;
        let terrainLengthsPtr = 0;
        let terrainBytesPtr = 0;
        let locOffsetsPtr = 0;
        let locLengthsPtr = 0;
        let locBytesPtr = 0;
        let outTileHeightsPtr = 0;
        let outTileRenderFlagsPtr = 0;
        let outTileUnderlaysPtr = 0;
        let outTileOverlaysPtr = 0;
        let outTileShapesPtr = 0;
        let outTileRotationsPtr = 0;
        let outBlockedByFloorPtr = 0;
        let outLocPlacementsPtr = 0;

        try {
            mapSquareIdsPtr = ensureHeapBuffer(backendModule, packed.mapSquareIds);
            terrainOffsetsPtr = ensureHeapBuffer(backendModule, packed.terrainOffsets);
            terrainLengthsPtr = ensureHeapBuffer(backendModule, packed.terrainLengths);
            terrainBytesPtr = ensureHeapBuffer(backendModule, packed.terrainBytes);
            locOffsetsPtr = ensureHeapBuffer(backendModule, packed.locOffsets);
            locLengthsPtr = ensureHeapBuffer(backendModule, packed.locLengths);
            locBytesPtr = ensureHeapBuffer(backendModule, packed.locBytes);

            outTileHeightsPtr = allocHeapBuffer(backendModule, heightCount, 4);
            outTileRenderFlagsPtr = allocHeapBuffer(backendModule, tileCount, 1);
            outTileUnderlaysPtr = allocHeapBuffer(backendModule, tileCount, 2);
            outTileOverlaysPtr = allocHeapBuffer(backendModule, tileCount, 2);
            outTileShapesPtr = allocHeapBuffer(backendModule, tileCount, 1);
            outTileRotationsPtr = allocHeapBuffer(backendModule, tileCount, 1);
            outBlockedByFloorPtr = allocHeapBuffer(backendModule, tileCount, 1);
            outLocPlacementsPtr = allocHeapBuffer(backendModule, locPlacementIntsCapacity, 4);

            if (
                !outTileHeightsPtr ||
                !outTileRenderFlagsPtr ||
                !outTileUnderlaysPtr ||
                !outTileOverlaysPtr ||
                !outTileShapesPtr ||
                !outTileRotationsPtr ||
                !outBlockedByFloorPtr ||
                (locPlacementIntsCapacity > 0 && !outLocPlacementsPtr)
            ) {
                return undefined;
            }

            const cacheInfo = deps.sceneBuilder.cacheInfo;
            const cacheGame = cacheInfo?.game ?? 1;
            const cacheRevision = cacheInfo?.revision ?? 0;
            const locLoadType = input.locLoadType | 0;

            const locPlacementCount = backendModule._rs_build_scene_data_from_map_squares(
                input.baseX | 0,
                input.baseY | 0,
                sizeX,
                sizeY,
                locLoadType,
                cacheGame | 0,
                cacheRevision | 0,
                mapCount,
                mapSquareIdsPtr,
                terrainOffsetsPtr,
                terrainLengthsPtr,
                terrainBytesPtr,
                packed.terrainBytes.length | 0,
                locOffsetsPtr,
                locLengthsPtr,
                locBytesPtr,
                packed.locBytes.length | 0,
                outTileHeightsPtr,
                heightCount,
                outTileRenderFlagsPtr,
                tileCount,
                outTileUnderlaysPtr,
                tileCount,
                outTileOverlaysPtr,
                tileCount,
                outTileShapesPtr,
                tileCount,
                outTileRotationsPtr,
                tileCount,
                outBlockedByFloorPtr,
                tileCount,
                outLocPlacementsPtr,
                locPlacementIntsCapacity,
            );
            if ((locPlacementCount | 0) < 0) {
                return undefined;
            }

            const tileHeights = new Int32Array(heightCount);
            tileHeights.set(
                backendModule.HEAP32.subarray(
                    outTileHeightsPtr >> 2,
                    (outTileHeightsPtr >> 2) + heightCount,
                ),
            );
            const tileRenderFlags = new Uint8Array(tileCount);
            tileRenderFlags.set(
                backendModule.HEAPU8.subarray(
                    outTileRenderFlagsPtr,
                    outTileRenderFlagsPtr + tileCount,
                ),
            );
            const tileUnderlays = new Uint16Array(tileCount);
            tileUnderlays.set(
                backendModule.HEAPU16.subarray(
                    outTileUnderlaysPtr >> 1,
                    (outTileUnderlaysPtr >> 1) + tileCount,
                ),
            );
            const tileOverlays = new Int16Array(tileCount);
            tileOverlays.set(
                backendModule.HEAP16.subarray(
                    outTileOverlaysPtr >> 1,
                    (outTileOverlaysPtr >> 1) + tileCount,
                ),
            );
            const tileShapes = new Uint8Array(tileCount);
            tileShapes.set(
                backendModule.HEAPU8.subarray(
                    outTileShapesPtr,
                    outTileShapesPtr + tileCount,
                ),
            );
            const tileRotations = new Uint8Array(tileCount);
            tileRotations.set(
                backendModule.HEAPU8.subarray(
                    outTileRotationsPtr,
                    outTileRotationsPtr + tileCount,
                ),
            );
            const blockedByFloor = new Uint8Array(tileCount);
            blockedByFloor.set(
                backendModule.HEAPU8.subarray(
                    outBlockedByFloorPtr,
                    outBlockedByFloorPtr + tileCount,
                ),
            );

            const locPlacementIntsLength = (locPlacementCount | 0) * LOC_PLACEMENT_STRIDE;
            const locPlacements = new Int32Array(locPlacementIntsLength);
            if (locPlacementIntsLength > 0) {
                locPlacements.set(
                    backendModule.HEAP32.subarray(
                        outLocPlacementsPtr >> 2,
                        (outLocPlacementsPtr >> 2) + locPlacementIntsLength,
                    ),
                );
            }

            return {
                levels: SCENE_LEVELS,
                sizeX,
                sizeY,
                tileHeights,
                tileRenderFlags,
                tileUnderlays,
                tileOverlays,
                tileShapes,
                tileRotations,
                blockedByFloor,
                locPlacements,
            };
        } finally {
            if (mapSquareIdsPtr) backendModule._free(mapSquareIdsPtr);
            if (terrainOffsetsPtr) backendModule._free(terrainOffsetsPtr);
            if (terrainLengthsPtr) backendModule._free(terrainLengthsPtr);
            if (terrainBytesPtr) backendModule._free(terrainBytesPtr);
            if (locOffsetsPtr) backendModule._free(locOffsetsPtr);
            if (locLengthsPtr) backendModule._free(locLengthsPtr);
            if (locBytesPtr) backendModule._free(locBytesPtr);
            if (outTileHeightsPtr) backendModule._free(outTileHeightsPtr);
            if (outTileRenderFlagsPtr) backendModule._free(outTileRenderFlagsPtr);
            if (outTileUnderlaysPtr) backendModule._free(outTileUnderlaysPtr);
            if (outTileOverlaysPtr) backendModule._free(outTileOverlaysPtr);
            if (outTileShapesPtr) backendModule._free(outTileShapesPtr);
            if (outTileRotationsPtr) backendModule._free(outTileRotationsPtr);
            if (outBlockedByFloorPtr) backendModule._free(outBlockedByFloorPtr);
            if (outLocPlacementsPtr) backendModule._free(outLocPlacementsPtr);
        }
    },
    reset() {
        backendModulePromise = undefined;
    },
};

export default cppWasmSceneBridge;
