import { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import { SdMapData } from "../renderer/loader/SdMapData";
import type { NpcGpuDataTarget } from "./entities/NpcGpuData";
import { MapSquareTickState } from "./tick/MapSquareTickState";
import { buildMapSquareTickState } from "./tick/MapSquareTickStateBuilder";

export type MapRuntimeStateStoreDeps = Readonly<{
    seqTypeLoader: SeqTypeLoader;
    seqFrameLoader: SeqFrameLoader;
    npcTypeLoader: NpcTypeLoader;
    basTypeLoader: BasTypeLoader;
}>;

export class MapRuntimeStateStore {
    private readonly tickStates = new Map<number, MapSquareTickState>();

    constructor(private readonly deps: MapRuntimeStateStoreDeps) {}

    clear(): void {
        this.tickStates.clear();
    }

    removeMap(mapId: number): void {
        this.tickStates.delete(mapId | 0);
    }

    buildAndStoreMap(mapId: number, data: SdMapData, timeSec: number): void {
        const { tickState } = buildMapSquareTickState(
            mapId | 0,
            data,
            this.deps.seqTypeLoader,
            this.deps.seqFrameLoader,
            this.deps.npcTypeLoader,
            this.deps.basTypeLoader,
            timeSec,
        );
        this.tickStates.set(mapId | 0, tickState);
    }

    getTickState(mapId: number): MapSquareTickState | undefined {
        return this.tickStates.get(mapId | 0);
    }

    createNpcGpuDataTarget(
        mapId: number,
        getTileRenderFlag: (level: number, tileX: number, tileY: number) => number,
    ): NpcGpuDataTarget | undefined {
        const tickState = this.tickStates.get(mapId | 0);
        if (!tickState) {
            return undefined;
        }
        return {
            id: mapId | 0,
            getNpcs: () => tickState.getNpcs(),
            getTileRenderFlag,
        };
    }
}

