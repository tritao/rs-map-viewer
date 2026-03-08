import type { StaticMapPacket } from "../shared/StaticMapPacket";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import type { WorldMapObjUpdate } from "../runtime/packets/WorldDeltaPacket";
import type { RenderDataWorkerPool } from "./RenderDataWorkerPool";
import type { SimWorkerPool } from "./SimWorkerPool";

type WorldRuntimePoolDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
}>;

export class WorldRuntimePool {
    constructor(private readonly deps: WorldRuntimePoolDeps) {}

    async activateLoadedMap(packet: StaticMapPacket, mapSimToken: number): Promise<void> {
        const mapId = packet.mapData.mapId | 0;
        await this.deps.renderWorkerPool.frame.activateLoadedMap(packet, mapSimToken);
        try {
            await this.deps.simWorkerPool.world.activateLoadedMap(packet, mapSimToken);
        } catch (error: unknown) {
            void this.deps.renderWorkerPool.frame.deactivateLoadedMap(mapId, mapSimToken);
            void this.deps.simWorkerPool.world.deactivateLoadedMap(mapId, mapSimToken);
            throw error;
        }
    }

    deactivateLoadedMap(mapId: number, mapSimToken: number): void {
        void this.deps.simWorkerPool.world.deactivateLoadedMap(mapId, mapSimToken);
        void this.deps.renderWorkerPool.frame.deactivateLoadedMap(mapId, mapSimToken);
    }

    applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        return this.deps.simWorkerPool.world.applyNpcLifecycleEvents(events);
    }

    applyMapObjStateUpdates(updates: ReadonlyArray<WorldMapObjUpdate>): Promise<number> {
        return this.deps.simWorkerPool.world.applyMapObjStateUpdates(updates);
    }
}
