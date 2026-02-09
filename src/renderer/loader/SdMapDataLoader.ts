import type { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import type { WorkerState } from "../../worker/RenderDataWorker";
import { SdMapData } from "./SdMapData";
import { SdMapLoaderInput } from "./SdMapLoaderInput";

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
