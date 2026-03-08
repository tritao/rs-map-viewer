import {
    type StaticMapPacket,
} from "../shared/StaticMapPacket";
import type { NpcEvent } from "./entities/NpcEvents";
import { type WorldMapObjUpdate } from "./packets/WorldDeltaPacket";
import type { WorldRuntimePool } from "../worker/WorldRuntimePool";

type MapWorldSessionDeps = Readonly<{
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

export class MapWorldSession {
    private loadEpoch: number = 1;
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private nextMapSimToken: number = 1;

    constructor(private readonly deps: MapWorldSessionDeps) {}

    reset(): void {
        this.loadEpoch = (this.loadEpoch + 1) | 0;
        this.mapSimTokenByMapId.clear();
        this.nextMapSimToken = 1;
    }

    captureLoadEpoch(): number {
        return this.loadEpoch | 0;
    }

    hasLoadEpoch(epoch: number): boolean {
        return (this.loadEpoch | 0) === (epoch | 0);
    }

    hasToken(mapId: number, token: number): boolean {
        return (this.mapSimTokenByMapId.get(mapId | 0) ?? 0) === (token | 0);
    }

    async registerActiveLoadedMap(
        packet: StaticMapPacket,
        loadEpoch: number,
    ): Promise<boolean> {
        const mapId = packet.mapData.mapId | 0;
        const mapSimToken = this.reserveToken(mapId);
        await this.registerMapRuntime(packet, mapSimToken);
        if (
            !this.hasLoadEpoch(loadEpoch) ||
            !this.hasToken(mapId, mapSimToken)
        ) {
            this.unregisterMapRuntime(mapId, mapSimToken);
            return false;
        }
        return true;
    }

    unregisterLoadedMap(mapId: number): void {
        const normalizedMapId = mapId | 0;
        const mapSimToken = this.invalidateToken(normalizedMapId);
        this.unregisterMapRuntime(normalizedMapId, mapSimToken);
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

    private reserveToken(mapId: number): number {
        const token = this.nextMapSimToken | 0;
        this.nextMapSimToken = (token + 1) | 0;
        this.mapSimTokenByMapId.set(mapId | 0, token);
        return token;
    }

    private invalidateToken(mapId: number): number {
        return this.reserveToken(mapId | 0);
    }

    private async registerMapRuntime(
        packet: StaticMapPacket,
        mapSimToken: number,
    ): Promise<void> {
        await this.deps.worldRuntimePool.activateLoadedMap(packet, mapSimToken);
    }

    private unregisterMapRuntime(mapId: number, mapSimToken: number): void {
        this.deps.worldRuntimePool.deactivateLoadedMap(mapId, mapSimToken);
    }
}
