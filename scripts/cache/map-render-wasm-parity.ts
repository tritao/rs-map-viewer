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
};

const CAP_HEIGHTMAP = 1 << 0;
const CAP_NPC_DECODE = 1 << 1;

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
        // Match runtime payload contract ordering: level -> y -> x.
        for (let y = 0; y < sizeY; y++) {
            for (let x = 0; x < sizeX; x++) {
                const src = levelOffset + x * (sizeY + 1) + y;
                out[outI++] = (-tileHeights[src] / unitsTileHeightBasis) | 0;
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

async function loadWasmBackendModule(): Promise<WasmBackendModule> {
    const root = process.cwd();
    const wasmDir = path.resolve(root, process.env.RS_MAP_RENDER_WASM_DIR ?? "src/wasm");
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
    assert(abi === 2, `Unexpected ABI version ${abi}`);
    assert((caps & CAP_HEIGHTMAP) !== 0, "WASM capability missing: heightmap");
    assert((caps & CAP_NPC_DECODE) !== 0, "WASM capability missing: npc decode");

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
                    throw new Error(
                        `heightmap mismatch at ${k}: wasm=${wasmOut[k]} ts=${tsOut[k]}`,
                    );
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

    console.log(
        `map-render-wasm-parity: abi=${abi} caps=${caps} heightmapCases=${heightmapCases} npcCases=${npcCases} ok`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
