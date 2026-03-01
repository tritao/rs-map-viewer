import { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import { SdMapData } from "../maprender/payload/SdMapData";
import type { NpcGpuDataTarget } from "./entities/NpcGpuData";
import { applyNpcServerDeltas, type NpcServerDelta } from "./sim/NpcSimMovement";
import { MapSquareTickState } from "./tick/MapSquareTickState";
import { buildMapSquareTickState } from "./tick/MapSquareTickStateBuilder";

export type MapRuntimeStateStoreDeps = Readonly<{
    seqTypeLoader: SeqTypeLoader;
    seqFrameLoader: SeqFrameLoader;
    npcTypeLoader: NpcTypeLoader;
    basTypeLoader: BasTypeLoader;
    onMapRemoved?: (mapId: number) => void;
}>;

export class MapRuntimeStateStore {
    private readonly tickStates = new Map<number, MapSquareTickState>();

    constructor(private readonly deps: MapRuntimeStateStoreDeps) {}

    clear(): void {
        if (this.deps.onMapRemoved) {
            for (const mapId of this.tickStates.keys()) {
                this.deps.onMapRemoved(mapId | 0);
            }
        }
        this.tickStates.clear();
    }

    removeMap(mapId: number): void {
        const id = mapId | 0;
        if (this.tickStates.delete(id) && this.deps.onMapRemoved) {
            this.deps.onMapRemoved(id);
        }
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

    applyNpcServerDeltas(mapId: number, deltas: ReadonlyArray<NpcServerDelta>): number {
        if ((deltas.length | 0) <= 0) {
            return 0;
        }
        const tickState = this.tickStates.get(mapId | 0);
        if (!tickState) {
            return 0;
        }
        const npcs = tickState.getNpcs();
        const npcIndexByOrderKey = new Map<number, number>();
        for (let i = 0; i < npcs.length; i++) {
            const orderKey = npcs[i]?.orderKey;
            if (orderKey !== undefined) {
                npcIndexByOrderKey.set(orderKey | 0, i | 0);
            }
        }
        return applyNpcServerDeltas(npcs, deltas, npcIndexByOrderKey);
    }
}
