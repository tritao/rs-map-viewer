import type { SdMapData, SdMapLoaderInput } from "../MapRenderPayload";
import type { MapRenderBuildDeps } from "../MapRenderBuildDeps";
import { sdMapDataTransferables } from "../MapRenderTransferables";
import type { MapRenderDataBackend, MapRenderDataBackendKind, RenderDataResult } from "../MapRenderDataBackend";
import { MapRenderTsBackend } from "./MapRenderTsBackend";

export class TsMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "ts";
    private readonly backend: MapRenderTsBackend;

    constructor(deps: MapRenderBuildDeps) {
        this.backend = new MapRenderTsBackend(deps);
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const data = await this.backend.buildMapData(input);
        return {
            data,
            transferables: data ? sdMapDataTransferables(data) : [],
        };
    }

    reset(): void {
        this.backend.reset();
    }
}

