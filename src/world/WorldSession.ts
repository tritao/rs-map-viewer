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

export type WorldInput = Readonly<{
    npc?: NpcLifecycleEventsInput;
    obj?: MapObjStateUpdatesInput;
}>;

export type WorldMapActivationInput = Readonly<{
    staticMap: StaticMapPacket;
    activationVersion: number;
}>;

export class WorldSession {
    constructor(private readonly deps: WorldSessionDeps) {}

    reset(): void {
        this.deps.worldRuntimePool.reset();
    }

    captureActivationVersion(): number {
        return this.deps.worldRuntimePool.captureActivationVersion();
    }

    isActivationVersionCurrent(version: number): boolean {
        return this.deps.worldRuntimePool.isActivationVersionCurrent(version);
    }

    async activateLoadedMap(input: WorldMapActivationInput): Promise<boolean> {
        return await this.deps.worldRuntimePool.activateLoadedMap(input);
    }

    deactivateLoadedMap(mapId: number): void {
        this.deps.worldRuntimePool.deactivateLoadedMap(mapId | 0);
    }

    async applyWorldInput(input: WorldInput): Promise<number> {
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
}
