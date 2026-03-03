import type { MapRenderBuildDeps } from "./MapRenderBuildDeps";
import type { SdMapData, SdMapLoaderInput } from "./MapRenderPayload";
import type { BackendKind } from "../util/BackendKind";
import type { MapRenderRuntimeHandle } from "../wasm/MapRenderRuntimeBridgeAbi";
import { TsMapRenderDataBackend } from "./ts/TsMapRenderDataBackend";
import { WasmMapRenderDataBackend } from "./wasm/WasmMapRenderDataBackend";

export type RenderDataResult<T> = Readonly<{
    data: T;
    transferables: Transferable[];
}>;

export type MapRenderDataBackendKind = BackendKind;

export type MapRenderDataBackendOptions = Readonly<{
    telemetry?: boolean;
}>;

export interface MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
    // Exposes the underlying C++ wasm runtime handle when this backend is "cpp-wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getCppWasmRuntimeHandle?(): MapRenderRuntimeHandle | undefined;
}

export function createMapRenderDataBackend(
    kind: MapRenderDataBackendKind,
    deps: MapRenderBuildDeps,
    options?: MapRenderDataBackendOptions,
): MapRenderDataBackend {
    if (kind === "cpp-wasm") {
        return new WasmMapRenderDataBackend(deps, options);
    }
    return new TsMapRenderDataBackend({
        ...deps,
        telemetry: options?.telemetry,
    });
}

