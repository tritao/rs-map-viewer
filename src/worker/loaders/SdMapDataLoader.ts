import type { RenderDataLoader, RenderDataResult } from "../RenderDataLoader";
import type { WorkerState } from "../RenderDataWorkerTypes";
import { SdMapData } from "../../maprender/payload/SdMapData";
import { SdMapLoaderInput } from "../../maprender/payload/SdMapLoaderInput";

export class SdMapDataLoader implements RenderDataLoader<SdMapLoaderInput, SdMapData | undefined> {
    __type = "sdMapDataLoader" as const;

    init(): void {}

    async load(
        state: WorkerState,
        input: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        return state.mapRenderDataBackend.buildMapData(input);
    }

    reset(): void {}
}
