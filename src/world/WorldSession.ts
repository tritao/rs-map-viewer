import {
    type StaticMapPacket,
} from "../shared/StaticMapPacket";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import { type WorldMapObjUpdate } from "../runtime/packets/WorldDeltaPacket";
import type { WorldRuntimePool } from "./WorldRuntimePool";

type WorldSessionDeps = Readonly<{
    worldRuntimePool: WorldRuntimePool;
}>;

export type NpcLifecycleEventsInput = Readonly<{
    lifecycleEvents: ReadonlyArray<NpcEvent>;
}>;

export type MapObjStateUpdatesInput = Readonly<{
    updates: ReadonlyArray<WorldMapObjUpdate>;
}>;

export type WorldEventsInput = Readonly<{
    npc?: NpcLifecycleEventsInput;
    obj?: MapObjStateUpdatesInput;
}>;

export class WorldSession {
    private loadEpoch: number = 1;

    constructor(private readonly deps: WorldSessionDeps) {}

    reset(): void {
        this.loadEpoch = (this.loadEpoch + 1) | 0;
        this.deps.worldRuntimePool.reset();
    }

    captureLoadEpoch(): number {
        return this.loadEpoch | 0;
    }

    hasLoadEpoch(epoch: number): boolean {
        return (this.loadEpoch | 0) === (epoch | 0);
    }

    async registerActiveLoadedMap(
        packet: StaticMapPacket,
        loadEpoch: number,
    ): Promise<boolean> {
        const mapId = packet.mapData.mapId | 0;
        const mapSimToken = await this.registerMapRuntime(packet);
        if (
            !this.hasLoadEpoch(loadEpoch) ||
            !this.deps.worldRuntimePool.hasToken(mapId, mapSimToken)
        ) {
            this.unregisterMapRuntime(mapId);
            return false;
        }
        return true;
    }

    unregisterLoadedMap(mapId: number): void {
        const normalizedMapId = mapId | 0;
        this.unregisterMapRuntime(normalizedMapId);
    }

    async applyWorldEvents(input: WorldEventsInput): Promise<number> {
        let applied = 0;
        const npcLifecycleEvents = input.npc?.lifecycleEvents;
        if (npcLifecycleEvents && (npcLifecycleEvents.length | 0) > 0) {
            applied =
                (applied +
                    (await this.deps.worldRuntimePool.applyNpcLifecycleEvents(npcLifecycleEvents))) |
                0;
        }
        const objUpdates = input.obj?.updates;
        if (objUpdates && (objUpdates.length | 0) > 0) {
            applied =
                (applied + (await this.deps.worldRuntimePool.applyMapObjStateUpdates(objUpdates))) |
                0;
        }
        return applied | 0;
    }

    private async registerMapRuntime(packet: StaticMapPacket): Promise<number> {
        return await this.deps.worldRuntimePool.activateLoadedMap(packet);
    }

    private unregisterMapRuntime(mapId: number): void {
        this.deps.worldRuntimePool.deactivateLoadedMap(mapId);
    }
}
