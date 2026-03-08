import type { StaticMapPacket } from "../shared/StaticMapPacket";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";
import type {
    WorldInput,
    WorldMapActivationInput,
    WorldMapDeactivationInput,
} from "./WorldSession";

type WorldRuntimePoolDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
}>;

export class WorldRuntimePool {
    private activationVersion: number = 1;
    private readonly mapRuntimeTokenByMapId = new Map<number, number>();
    private nextMapRuntimeToken: number = 1;

    constructor(private readonly deps: WorldRuntimePoolDeps) {}

    reset(): void {
        this.activationVersion = (this.activationVersion + 1) | 0;
        this.mapRuntimeTokenByMapId.clear();
        this.nextMapRuntimeToken = 1;
    }

    captureActivationVersion(): number {
        return this.activationVersion | 0;
    }

    isActivationVersionCurrent(version: number): boolean {
        return (this.activationVersion | 0) === (version | 0);
    }

    async activateLoadedMap(input: WorldMapActivationInput): Promise<boolean> {
        const packet = input.staticMap;
        const mapId = packet.mapData.mapId | 0;
        const mapSimToken = await this.activateLoadedMapRuntime(packet);
        if (
            !this.isActivationVersionCurrent(input.activationVersion) ||
            !this.hasToken(mapId, mapSimToken)
        ) {
            this.deactivateLoadedMap({ mapId });
            return false;
        }
        return true;
    }

    deactivateLoadedMap(input: WorldMapDeactivationInput): void {
        this.deactivateLoadedMapRuntime(input.mapId | 0);
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

    async applyWorldInput(input: WorldInput): Promise<number> {
        let applied = 0;
        const npcLifecycleEvents = input.npc?.lifecycleEvents;
        if (npcLifecycleEvents && (npcLifecycleEvents.length | 0) > 0) {
            applied =
                (applied +
                    (await this.deps.simWorkerPool.world.applyNpcLifecycleEvents(npcLifecycleEvents))) |
                0;
        }
        const objUpdates = input.obj?.updates;
        if (objUpdates && (objUpdates.length | 0) > 0) {
            applied =
                (applied + (await this.deps.simWorkerPool.world.applyMapObjStateUpdates(objUpdates))) |
                0;
        }
        return applied | 0;
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
