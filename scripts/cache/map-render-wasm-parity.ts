import path from "path";
import { pathToFileURL } from "url";

import { decodeNpcSpawnsFromBytes } from "../../src/rs/scene/decodeNpcSpawns";

type WasmBackendModule = {
    HEAP32: Int32Array;
    HEAP16: Int16Array;
    HEAPU16: Uint16Array;
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
    _rs_map_render_bridge_abi_version(): number;
    _rs_map_render_bridge_capabilities(): number;
    _rs_heightmap_from_scene_tile_heights(
        tileHeightsPtr: number,
        levels: number,
        sizeX: number,
        sizeY: number,
        unitsTileHeightBasis: number,
        outHeightMapPtr: number,
        outLength: number,
    ): number;
    _rs_decode_npc_spawns_from_bytes(
        flagsPtr: number,
        flagsWidth: number,
        flagsLength: number,
        borderSize: number,
        mapX: number,
        mapY: number,
        dataPtr: number,
        dataLength: number,
        npcLoginScreenPropsByIdPtr: number,
        npcLoginScreenPropsByIdLength: number,
        requiredLoginScreenPropsMask: number,
        outPackedPtr: number,
        outPackedIntLength: number,
    ): number;
    _rs_pack_scene_pack_input(
        tileHeightsPtr: number,
        levels: number,
        sizeX: number,
        sizeY: number,
        unitsTileHeightBasis: number,
        bucketCmdCountsPtr: number,
        cmdOffsetsPtr: number,
        cmdElementsPtr: number,
        cmdInstanceCountsPtr: number,
        totalCmdCount: number,
        packedInstancesPtr: number,
        packedInstancesLength: number,
        outDrawRangesPtr: number,
        outDrawRangesLength: number,
        outModelInfoConcatPtr: number,
        outModelInfoConcatLength: number,
        outHeightMapPtr: number,
        outHeightMapLength: number,
    ): number;
};

const CAP_HEIGHTMAP = 1 << 0;
const CAP_NPC_DECODE = 1 << 1;
const CAP_SCENE_PACK = 1 << 3;

function parseArgs(argv: string[]): { iterations: number } {
    let iterations = 40;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--iterations") {
            iterations = Number(argv[++i]);
        }
    }
    if (!Number.isFinite(iterations) || iterations <= 0) {
        throw new Error("Invalid --iterations");
    }
    return { iterations: iterations | 0 };
}

function randomInt(maxExclusive: number): number {
    return (Math.random() * maxExclusive) | 0;
}

function buildTsHeightMap(
    tileHeights: Int32Array,
    levels: number,
    sizeX: number,
    sizeY: number,
    unitsTileHeightBasis: number,
): Int16Array {
    const out = new Int16Array(levels * sizeX * sizeY);
    let outI = 0;
    for (let level = 0; level < levels; level++) {
        const levelOffset = level * (sizeX + 1) * (sizeY + 1);
        for (let x = 0; x < sizeX; x++) {
            for (let y = 0; y < sizeY; y++) {
                const src = levelOffset + x * (sizeY + 1) + y;
                out[outI++] = ((-tileHeights[src]) / unitsTileHeightBasis) | 0;
            }
        }
    }
    return out;
}

function buildRandomNpcBytes(spawnCount: number): Uint8Array {
    const out = new Uint8Array(spawnCount * 4);
    let i = 0;
    for (let s = 0; s < spawnCount; s++) {
        const level = randomInt(4);
        const x = randomInt(64);
        const y = randomInt(64);
        const id = randomInt(65536);
        const packed = (level << 14) | (x << 7) | y;
        out[i++] = (packed >> 8) & 0xff;
        out[i++] = packed & 0xff;
        out[i++] = (id >> 8) & 0xff;
        out[i++] = id & 0xff;
    }
    return out;
}

function buildRandomFlags(size: number): Uint8Array[] {
    const flags: Uint8Array[] = new Array(size);
    for (let x = 0; x < size; x++) {
        const col = new Uint8Array(size);
        for (let y = 0; y < size; y++) {
            col[y] = (Math.random() < 0.2 ? 0x2 : 0) | (Math.random() < 0.2 ? 0x1 : 0);
        }
        flags[x] = col;
    }
    return flags;
}

function filterNpcSpawnsByLoginScreenProps(
    spawns: ReturnType<typeof decodeNpcSpawnsFromBytes>,
    loginScreenPropsById: Uint8Array,
    requiredMask: number,
): ReturnType<typeof decodeNpcSpawnsFromBytes> {
    const out: ReturnType<typeof decodeNpcSpawnsFromBytes> = [];
    for (const spawn of spawns) {
        const id = spawn.id | 0;
        if (id < 0 || id >= loginScreenPropsById.length) {
            continue;
        }
        if ((loginScreenPropsById[id] & requiredMask) === 0) {
            continue;
        }
        out.push(spawn);
    }
    return out;
}

function flattenFlags(flags: Uint8Array[]): { flat: Uint8Array; width: number } {
    const width = flags[0].length | 0;
    const flat = new Uint8Array(flags.length * width);
    for (let x = 0; x < flags.length; x++) {
        flat.set(flags[x], x * width);
    }
    return { flat, width };
}

function modelInfoLengthFromInstanceCounts(instanceCounts: Int32Array, cmdCount: number): number {
    let totalInstances = 0;
    for (let i = 0; i < instanceCounts.length; i++) {
        totalInstances += instanceCounts[i] | 0;
    }
    const dataLength = Math.ceil((cmdCount * 4 + totalInstances) / 16) * 16;
    return Math.max(dataLength, 16) * 4;
}

function buildExpectedModelInfo(
    cmdCount: number,
    instanceCounts: Int32Array,
    packedInstances: Int32Array,
): Uint16Array {
    const outLength = modelInfoLengthFromInstanceCounts(instanceCounts, cmdCount);
    const out = new Uint16Array(outLength);
    let dataOffset = 0;
    for (let i = 0; i < cmdCount; i++) {
        out[i * 4] = (cmdCount + dataOffset) & 0xffff;
        dataOffset += instanceCounts[i] | 0;
    }
    let inOffset = 0;
    for (let i = 0; i < packedInstances.length / 8; i++) {
        const sceneX = packedInstances[inOffset++] | 0;
        const sceneZ = packedInstances[inOffset++] | 0;
        const heightOffset = packedInstances[inOffset++] | 0;
        const level = packedInstances[inOffset++] | 0;
        const contourGround = packedInstances[inOffset++] | 0;
        const priority = packedInstances[inOffset++] | 0;
        const interactType = packedInstances[inOffset++] | 0;
        const interactId = packedInstances[inOffset++] | 0;

        const outOffset = cmdCount * 4 + i * 4;
        out[outOffset + 0] = (sceneX | (level << 14)) & 0xffff;
        out[outOffset + 1] = (sceneZ | (contourGround << 14)) & 0xffff;
        out[outOffset + 2] =
            ((priority & 0x7) |
                ((interactId >> 16) << 3) |
                (interactType << 4) |
                (Math.round(heightOffset / 8) << 6)) &
            0xffff;
        out[outOffset + 3] = interactId & 0xffff;
    }
    return out;
}

function buildExpectedModelInfoConcat(
    bucketCmdCounts: Int32Array,
    cmdInstanceCounts: Int32Array,
    packedInstances: Int32Array,
): Uint16Array {
    let totalLength = 0;
    let cmdCursor = 0;
    for (let bucket = 0; bucket < bucketCmdCounts.length; bucket++) {
        const cmdCount = bucketCmdCounts[bucket] | 0;
        const counts = cmdInstanceCounts.subarray(cmdCursor, cmdCursor + cmdCount);
        totalLength += modelInfoLengthFromInstanceCounts(counts, cmdCount);
        cmdCursor += cmdCount;
    }
    const out = new Uint16Array(totalLength);

    cmdCursor = 0;
    let instanceCursor = 0;
    let outCursor = 0;
    for (let bucket = 0; bucket < bucketCmdCounts.length; bucket++) {
        const cmdCount = bucketCmdCounts[bucket] | 0;
        const counts = cmdInstanceCounts.subarray(cmdCursor, cmdCursor + cmdCount);
        let bucketInstances = 0;
        for (let i = 0; i < counts.length; i++) {
            bucketInstances += counts[i] | 0;
        }
        const bucketPacked = packedInstances.subarray(
            instanceCursor * 8,
            (instanceCursor + bucketInstances) * 8,
        );
        const bucketModelInfo = buildExpectedModelInfo(cmdCount, counts, bucketPacked);
        out.set(bucketModelInfo, outCursor);
        outCursor += bucketModelInfo.length;
        cmdCursor += cmdCount;
        instanceCursor += bucketInstances;
    }
    return out;
}

async function loadWasmBackendModule(): Promise<WasmBackendModule> {
    const root = process.cwd();
    const wasmDir = path.resolve(root, "public/wasm");
    const moduleUrl = pathToFileURL(path.join(wasmDir, "rs_map_render_backend.js")).href;
    const mod = (await import(moduleUrl)) as { default: (opts: any) => Promise<WasmBackendModule> };
    const createModule = mod.default;
    const module = await createModule({
        locateFile: (file: string) => pathToFileURL(path.join(wasmDir, file)).href,
    });
    return module;
}

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const { iterations } = parseArgs(process.argv.slice(2));
    const module = await loadWasmBackendModule();

    const abi = module._rs_map_render_bridge_abi_version() | 0;
    const caps = module._rs_map_render_bridge_capabilities() | 0;
    assert(abi === 1, `Unexpected ABI version ${abi}`);
    assert((caps & CAP_HEIGHTMAP) !== 0, "WASM capability missing: heightmap");
    assert((caps & CAP_NPC_DECODE) !== 0, "WASM capability missing: npc decode");
    assert((caps & CAP_SCENE_PACK) !== 0, "WASM capability missing: scene pack");

    let heightmapCases = 0;
    for (let i = 0; i < iterations; i++) {
        const levels = 4;
        const sizeX = 72;
        const sizeY = 72;
        const basis = 8;
        const tileHeights = new Int32Array(levels * (sizeX + 1) * (sizeY + 1));
        for (let j = 0; j < tileHeights.length; j++) {
            tileHeights[j] = ((Math.random() * 4000) | 0) - 2000;
        }

        const outLength = levels * sizeX * sizeY;
        const inPtr = module._malloc(tileHeights.length * 4);
        const outPtr = module._malloc(outLength * 2);
        assert(inPtr !== 0 && outPtr !== 0, "malloc failed");
        try {
            module.HEAP32.set(tileHeights, inPtr >> 2);
            const ok = module._rs_heightmap_from_scene_tile_heights(
                inPtr,
                levels,
                sizeX,
                sizeY,
                basis,
                outPtr,
                outLength,
            );
            assert(ok === 1, "heightmap wasm call failed");
            const wasmOut = new Int16Array(outLength);
            wasmOut.set(module.HEAP16.subarray(outPtr >> 1, (outPtr >> 1) + outLength));
            const tsOut = buildTsHeightMap(tileHeights, levels, sizeX, sizeY, basis);
            assert(wasmOut.length === tsOut.length, "heightmap length mismatch");
            for (let k = 0; k < tsOut.length; k++) {
                if (wasmOut[k] !== tsOut[k]) {
                    throw new Error(`heightmap mismatch at ${k}: wasm=${wasmOut[k]} ts=${tsOut[k]}`);
                }
            }
            heightmapCases++;
        } finally {
            module._free(inPtr);
            module._free(outPtr);
        }
    }

    let npcCases = 0;
    for (let i = 0; i < iterations; i++) {
        const borderSize = 6;
        const flags = buildRandomFlags(76);
        const mapX = randomInt(256);
        const mapY = randomInt(256);
        const data = buildRandomNpcBytes(1 + randomInt(80));

        const tsDecoded = decodeNpcSpawnsFromBytes(flags, borderSize, mapX, mapY, data);
        const loginScreenPropsById = new Uint8Array(1 << 16);
        for (let j = 0; j < loginScreenPropsById.length; j++) {
            loginScreenPropsById[j] = Math.random() < 0.5 ? 0x1 : 0x0;
        }
        const requiredLoginScreenPropsMask = 0x1;
        const tsFiltered = filterNpcSpawnsByLoginScreenProps(
            tsDecoded,
            loginScreenPropsById,
            requiredLoginScreenPropsMask,
        );
        const flatFlags = flattenFlags(flags);
        const maxCount = data.length >>> 2;
        const outPackedInts = maxCount * 4;
        const flagsPtr = module._malloc(flatFlags.flat.length);
        const dataPtr = module._malloc(data.length);
        const propsPtr = module._malloc(loginScreenPropsById.length);
        const outPtr = module._malloc(outPackedInts * 4);
        assert(flagsPtr !== 0 && dataPtr !== 0 && propsPtr !== 0 && outPtr !== 0, "malloc failed");
        try {
            module.HEAPU8.set(flatFlags.flat, flagsPtr);
            module.HEAPU8.set(data, dataPtr);
            module.HEAPU8.set(loginScreenPropsById, propsPtr);
            const count = module._rs_decode_npc_spawns_from_bytes(
                flagsPtr,
                flatFlags.width,
                flatFlags.flat.length,
                borderSize,
                mapX,
                mapY,
                dataPtr,
                data.length,
                propsPtr,
                loginScreenPropsById.length,
                requiredLoginScreenPropsMask,
                outPtr,
                outPackedInts,
            );
            assert(count >= 0, `npc decode wasm failed code=${count}`);
            assert(
                count === tsFiltered.length,
                `npc decode count mismatch wasm=${count} ts=${tsFiltered.length}`,
            );
            const packed = module.HEAP32.subarray(outPtr >> 2, (outPtr >> 2) + count * 4);
            for (let n = 0; n < count; n++) {
                const off = n * 4;
                const id = packed[off + 0] | 0;
                const x = packed[off + 1] | 0;
                const y = packed[off + 2] | 0;
                const level = packed[off + 3] | 0;
                const t = tsFiltered[n];
                if (id !== t.id || x !== t.x || y !== t.y || level !== t.level) {
                    throw new Error(
                        `npc mismatch at ${n}: wasm=(${id},${x},${y},${level}) ts=(${t.id},${t.x},${t.y},${t.level})`,
                    );
                }
            }
            npcCases++;
        } finally {
            module._free(flagsPtr);
            module._free(dataPtr);
            module._free(propsPtr);
            module._free(outPtr);
        }
    }

    let scenePackCases = 0;
    for (let i = 0; i < iterations; i++) {
        const levels = 4;
        const sizeX = 32;
        const sizeY = 32;
        const basis = 8;
        const tileHeights = new Int32Array(levels * (sizeX + 1) * (sizeY + 1));
        for (let j = 0; j < tileHeights.length; j++) {
            tileHeights[j] = ((Math.random() * 4000) | 0) - 2000;
        }

        const bucketCmdCounts = new Int32Array(8);
        let totalCmdCount = 0;
        for (let bucket = 0; bucket < bucketCmdCounts.length; bucket++) {
            const n = randomInt(5);
            bucketCmdCounts[bucket] = n;
            totalCmdCount += n;
        }

        const cmdOffsets = new Int32Array(totalCmdCount);
        const cmdElements = new Int32Array(totalCmdCount);
        const cmdInstanceCounts = new Int32Array(totalCmdCount);
        let totalInstances = 0;
        for (let j = 0; j < totalCmdCount; j++) {
            cmdOffsets[j] = randomInt(200000);
            cmdElements[j] = randomInt(50000);
            const count = randomInt(8);
            cmdInstanceCounts[j] = count;
            totalInstances += count;
        }
        const packedInstances = new Int32Array(totalInstances * 8);
        for (let p = 0; p < totalInstances; p++) {
            const off = p * 8;
            packedInstances[off + 0] = randomInt(16384);
            packedInstances[off + 1] = randomInt(16384);
            packedInstances[off + 2] = randomInt(8192) - 4096;
            packedInstances[off + 3] = randomInt(4);
            packedInstances[off + 4] = randomInt(3);
            packedInstances[off + 5] = randomInt(8);
            packedInstances[off + 6] = randomInt(8);
            packedInstances[off + 7] = randomInt(1 << 20);
        }

        const expectedHeightMap = buildTsHeightMap(tileHeights, levels, sizeX, sizeY, basis);
        const expectedDrawRanges = new Int32Array(totalCmdCount * 3);
        for (let j = 0; j < totalCmdCount; j++) {
            const off = j * 3;
            expectedDrawRanges[off + 0] = cmdOffsets[j] | 0;
            expectedDrawRanges[off + 1] = cmdElements[j] | 0;
            expectedDrawRanges[off + 2] = cmdInstanceCounts[j] | 0;
        }
        const expectedModelInfoConcat = buildExpectedModelInfoConcat(
            bucketCmdCounts,
            cmdInstanceCounts,
            packedInstances,
        );

        const inHeightsPtr = module._malloc(tileHeights.length * 4);
        const inBucketCountsPtr = module._malloc(bucketCmdCounts.length * 4);
        const inOffsetsPtr = cmdOffsets.length > 0 ? module._malloc(cmdOffsets.length * 4) : 0;
        const inElementsPtr = cmdElements.length > 0 ? module._malloc(cmdElements.length * 4) : 0;
        const inInstanceCountsPtr =
            cmdInstanceCounts.length > 0 ? module._malloc(cmdInstanceCounts.length * 4) : 0;
        const inPackedInstancesPtr =
            packedInstances.length > 0 ? module._malloc(packedInstances.length * 4) : 0;
        const outDrawRangesPtr =
            expectedDrawRanges.length > 0 ? module._malloc(expectedDrawRanges.length * 4) : 0;
        const outModelInfoConcatPtr = module._malloc(expectedModelInfoConcat.length * 2);
        const outHeightMapPtr = module._malloc(expectedHeightMap.length * 2);
        assert(
            inHeightsPtr !== 0 &&
                inBucketCountsPtr !== 0 &&
                (cmdOffsets.length === 0 || inOffsetsPtr !== 0) &&
                (cmdElements.length === 0 || inElementsPtr !== 0) &&
                (cmdInstanceCounts.length === 0 || inInstanceCountsPtr !== 0) &&
                (packedInstances.length === 0 || inPackedInstancesPtr !== 0) &&
                (expectedDrawRanges.length === 0 || outDrawRangesPtr !== 0) &&
                outModelInfoConcatPtr !== 0 &&
                outHeightMapPtr !== 0,
            "malloc failed",
        );

        try {
            module.HEAP32.set(tileHeights, inHeightsPtr >> 2);
            module.HEAP32.set(bucketCmdCounts, inBucketCountsPtr >> 2);
            if (cmdOffsets.length > 0) {
                module.HEAP32.set(cmdOffsets, inOffsetsPtr >> 2);
                module.HEAP32.set(cmdElements, inElementsPtr >> 2);
                module.HEAP32.set(cmdInstanceCounts, inInstanceCountsPtr >> 2);
            }
            if (packedInstances.length > 0) {
                module.HEAP32.set(packedInstances, inPackedInstancesPtr >> 2);
            }
            const ok = module._rs_pack_scene_pack_input(
                inHeightsPtr,
                levels,
                sizeX,
                sizeY,
                basis,
                inBucketCountsPtr,
                inOffsetsPtr,
                inElementsPtr,
                inInstanceCountsPtr,
                totalCmdCount,
                inPackedInstancesPtr,
                packedInstances.length,
                outDrawRangesPtr,
                expectedDrawRanges.length,
                outModelInfoConcatPtr,
                expectedModelInfoConcat.length,
                outHeightMapPtr,
                expectedHeightMap.length,
            );
            assert(ok === 1, "scene pack wasm call failed");

            const wasmHeightMap = new Int16Array(expectedHeightMap.length);
            wasmHeightMap.set(
                module.HEAP16.subarray(
                    outHeightMapPtr >> 1,
                    (outHeightMapPtr >> 1) + expectedHeightMap.length,
                ),
            );
            for (let k = 0; k < expectedHeightMap.length; k++) {
                if (wasmHeightMap[k] !== expectedHeightMap[k]) {
                    throw new Error(
                        `scene pack heightmap mismatch at ${k}: wasm=${wasmHeightMap[k]} ts=${expectedHeightMap[k]}`,
                    );
                }
            }

            const wasmDrawRanges = new Int32Array(expectedDrawRanges.length);
            if (expectedDrawRanges.length > 0) {
                wasmDrawRanges.set(
                    module.HEAP32.subarray(
                        outDrawRangesPtr >> 2,
                        (outDrawRangesPtr >> 2) + expectedDrawRanges.length,
                    ),
                );
            }
            for (let k = 0; k < expectedDrawRanges.length; k++) {
                if (wasmDrawRanges[k] !== expectedDrawRanges[k]) {
                    throw new Error(
                        `scene pack draw range mismatch at ${k}: wasm=${wasmDrawRanges[k]} ts=${expectedDrawRanges[k]}`,
                    );
                }
            }

            const wasmModelInfoConcat = new Uint16Array(expectedModelInfoConcat.length);
            wasmModelInfoConcat.set(
                module.HEAPU16.subarray(
                    outModelInfoConcatPtr >> 1,
                    (outModelInfoConcatPtr >> 1) + expectedModelInfoConcat.length,
                ),
            );
            for (let k = 0; k < expectedModelInfoConcat.length; k++) {
                if (wasmModelInfoConcat[k] !== expectedModelInfoConcat[k]) {
                    throw new Error(
                        `scene pack model info mismatch at ${k}: wasm=${wasmModelInfoConcat[k]} ts=${expectedModelInfoConcat[k]}`,
                    );
                }
            }

            scenePackCases++;
        } finally {
            module._free(inHeightsPtr);
            module._free(inBucketCountsPtr);
            if (inOffsetsPtr) module._free(inOffsetsPtr);
            if (inElementsPtr) module._free(inElementsPtr);
            if (inInstanceCountsPtr) module._free(inInstanceCountsPtr);
            if (inPackedInstancesPtr) module._free(inPackedInstancesPtr);
            if (outDrawRangesPtr) module._free(outDrawRangesPtr);
            module._free(outModelInfoConcatPtr);
            module._free(outHeightMapPtr);
        }
    }

    console.log(
        `map-render-wasm-parity: abi=${abi} caps=${caps} heightmapCases=${heightmapCases} npcCases=${npcCases} scenePackCases=${scenePackCases} ok`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
