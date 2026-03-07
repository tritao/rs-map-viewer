import type { BackendKind } from "../util/BackendKind";
import type { MapRenderRuntimeHandle } from "../wasm/MapRenderRuntimeBridgeAbi";
import type { MapRenderBuildDeps } from "./MapRenderBuildDeps";
import type { SdMapData, SdMapLoaderInput } from "./MapRenderPayload";
import { collectSdMapDataTransferables } from "./MapRenderTransferables";
import { MapRenderTsBackend } from "./ts/MapRenderTsBackend";
import { WasmMapRenderBackend } from "./wasm/WasmMapRenderBackend";

export type RenderDataResult<T> = Readonly<{
    data: T;
    transferables: Transferable[];
}>;

export type MapRenderBackendKind = BackendKind;

export type MapRenderBackendOptions = Readonly<{
    telemetry?: boolean;
}>;

export interface MapRenderBackend {
    readonly kind: MapRenderBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
    // Exposes the underlying C++ wasm runtime handle when this backend is "cpp-wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getCppWasmRuntimeHandle?(): MapRenderRuntimeHandle | undefined;
}

class TsMapRenderBackend implements MapRenderBackend {
    readonly kind: MapRenderBackendKind = "ts";
    private readonly backend: MapRenderTsBackend;

    constructor(deps: MapRenderBuildDeps) {
        this.backend = new MapRenderTsBackend(deps);
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const result = await this.backend.buildMapData(input);
        const data = result.data;
        return {
            data,
            transferables: data ? collectSdMapDataTransferables(data) : [],
        };
    }

    reset(): void {
        this.backend.reset();
    }
}

export function createMapRenderBackend(
    kind: MapRenderBackendKind,
    deps: MapRenderBuildDeps,
    options?: MapRenderBackendOptions,
): MapRenderBackend {
    if (kind === "cpp-wasm") {
        return new WasmMapRenderBackend(deps, options);
    }
    return new TsMapRenderBackend({
        ...deps,
        telemetry: options?.telemetry,
    });
}
