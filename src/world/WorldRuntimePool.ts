import type { StaticMapPacket } from "../shared/StaticMapPacket";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import type { WorldMapObjUpdate } from "../runtime/packets/WorldDeltaPacket";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";

type WorldRuntimePoolDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
}>;

export class WorldRuntimePool {
    private loadEpoch: number = 1;
    private readonly mapRuntimeTokenByMapId = new Map<number, number>();
    private nextMapRuntimeToken: number = 1;

    constructor(private readonly deps: WorldRuntimePoolDeps) {}

    reset(): void {
        this.loadEpoch = (this.loadEpoch + 1) | 0;
        this.mapRuntimeTokenByMapId.clear();
        this.nextMapRuntimeToken = 1;
    }

    captureLoadEpoch(): number {
        return this.loadEpoch | 0;
    }

    hasLoadEpoch(epoch: number): boolean {
        return (this.loadEpoch | 0) === (epoch | 0);
    }

    async activateLoadedMap(
        packet: StaticMapPacket,
        loadEpoch: number,
    ): Promise<boolean> {
        const mapId = packet.mapData.mapId | 0;
        const mapSimToken = await this.activateLoadedMapRuntime(packet);
        if (!this.hasLoadEpoch(loadEpoch) || !this.hasToken(mapId, mapSimToken)) {
            this.deactivateLoadedMap(mapId);
            return false;
        }
        return true;
    }

    deactivateLoadedMap(mapId: number): void {
        this.deactivateLoadedMapRuntime(mapId | 0);
    }

    private hasToken(mapId: number, token: number): boolean {
        return (this.mapRuntimeTokenByMapId.get(mapId | 0) ?? 0) === (token | 0);
    }

    private async activateLoadedMapRuntime(packet: StaticMapPacket): Promise<number> {
        const mapSimToken = this.reserveToken(packet.mapData.mapId | 0);
        const mapId = packet.mapData.mapId | 0;
        await this.deps.renderWorkerPool.frame.activateLoadedMap(packet, mapSimToken);
        try {
            await this.deps.simWorkerPool.world.activateLoadedMap(packet, mapSimToken);
        } catch (error: unknown) {
            void this.deps.renderWorkerPool.frame.deactivateLoadedMap(mapId, mapSimToken);
            void this.deps.simWorkerPool.world.deactivateLoadedMap(mapId, mapSimToken);
            throw error;
        }
        return mapSimToken | 0;
    }

    private deactivateLoadedMapRuntime(mapId: number): void {
        const mapSimToken = this.invalidateToken(mapId | 0);
        void this.deps.simWorkerPool.world.deactivateLoadedMap(mapId, mapSimToken);
        void this.deps.renderWorkerPool.frame.deactivateLoadedMap(mapId, mapSimToken);
    }

    applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        return this.deps.simWorkerPool.world.applyNpcLifecycleEvents(events);
    }

    applyMapObjStateUpdates(updates: ReadonlyArray<WorldMapObjUpdate>): Promise<number> {
        return this.deps.simWorkerPool.world.applyMapObjStateUpdates(updates);
    }

    private reserveToken(mapId: number): number {
        const token = this.nextMapRuntimeToken | 0;
        this.nextMapRuntimeToken = (token + 1) | 0;
        this.mapRuntimeTokenByMapId.set(mapId | 0, token);
        return token | 0;
    }

    private invalidateToken(mapId: number): number {
        return this.reserveToken(mapId | 0);
    }
}
