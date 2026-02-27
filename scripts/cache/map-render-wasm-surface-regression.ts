import path from "path";
import { pathToFileURL } from "url";

type WasmBackendModule = {
    _rs_map_render_bridge_abi_version(): number;
    _rs_build_scene_pack_payload_from_command_stream_input?: unknown;
    _rs_build_scene_pack_payload_from_packed_seed_input?: unknown;
};

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function loadWasmBackendModule(): Promise<WasmBackendModule> {
    const root = process.cwd();
    const wasmDir = path.resolve(root, process.env.RS_MAP_RENDER_WASM_DIR ?? "src/wasm");
    const moduleUrl = pathToFileURL(path.join(wasmDir, "rs_map_render_backend.js")).href;
    const mod = (await import(moduleUrl)) as {
        default: (opts: unknown) => Promise<WasmBackendModule>;
    };
    const createModule = mod.default;
    return createModule({
        locateFile: (file: string) => pathToFileURL(path.join(wasmDir, file)).href,
    });
}

async function main(): Promise<void> {
    const module = await loadWasmBackendModule();
    const abi = module._rs_map_render_bridge_abi_version() | 0;

    assert(abi === 2, `Unexpected ABI version ${abi}`);
    assert(
        typeof module._rs_build_scene_pack_payload_from_command_stream_input !== "function",
        "Unexpected export present: _rs_build_scene_pack_payload_from_command_stream_input",
    );
    assert(
        typeof module._rs_build_scene_pack_payload_from_packed_seed_input !== "function",
        "Unexpected export present: _rs_build_scene_pack_payload_from_packed_seed_input",
    );

    console.log(`map-render-wasm-surface-regression: abi=${abi} ok`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
