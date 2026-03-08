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

export type WorldMapDeactivationInput = Readonly<{
    mapId: number;
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

    deactivateLoadedMap(input: WorldMapDeactivationInput): void {
        this.deps.worldRuntimePool.deactivateLoadedMap(input);
    }

    async applyWorldInput(input: WorldInput): Promise<number> {
        return await this.deps.worldRuntimePool.applyWorldInput(input);
    }
}
