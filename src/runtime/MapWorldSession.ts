import type { ObjRenderData } from "../maprender/MapRenderPayload";
import {
    type DecodedStaticMapPacket,
    getValidatedStaticMapNpcOrderKeys,
} from "./packets/StaticMapPacket";
import type { NpcEvent } from "./entities/NpcEvents";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";
import type { NpcTypeAnimationEntry } from "./NpcTypeAnimationTable";

type MapWorldSessionDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    requestFrameRefresh(): void;
}>;

const EMPTY_NPC_TYPE_ANIMATION_TABLE: ReadonlyArray<NpcTypeAnimationEntry> = [];

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
        packet: DecodedStaticMapPacket,
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

    async applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        return await this.deps.simWorkerPool.applyNpcLifecycleEvents(events);
    }

    replaceMapObjRenderData(mapId: number, objRenderData: ObjRenderData | undefined): void {
        void this.dispatchMapObjRenderData(mapId, objRenderData);
    }

    attachLoadedMapRuntime(packet: DecodedStaticMapPacket): void {
        this.replaceMapObjRenderData(packet.mapData.mapId | 0, packet.runtimeBootstrap.objRenderData);
    }

    private async dispatchMapObjRenderData(
        mapId: number,
        objRenderData: ObjRenderData | undefined,
    ): Promise<void> {
        try {
            const applied = await this.deps.renderWorkerPool.replaceMapObjRenderData(
                mapId,
                objRenderData,
            );
            if ((applied | 0) > 0) {
                this.deps.requestFrameRefresh();
            }
        } catch (error: unknown) {
            console.error(`[map-render] failed to replace obj render data for mapId=${mapId | 0}`, error);
        }
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
        packet: DecodedStaticMapPacket,
        mapSimToken: number,
    ): Promise<void> {
        const mapId = packet.mapData.mapId | 0;
        const maxLevel = packet.mapData.maxLevel | 0;
        const npcOrderKeys = getValidatedStaticMapNpcOrderKeys(packet);
        const npcTypeAnimationTable =
            packet.runtimeRegistration.npcTypeAnimationTable ?? EMPTY_NPC_TYPE_ANIMATION_TABLE;
        await this.deps.renderWorkerPool.registerMapRuntime(
            mapId,
            packet.runtimeRegistration.borderSize,
            packet.runtimeRegistration.tileRenderFlagsLevel1,
            packet.runtimeRegistration.locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        );
        try {
            await this.deps.simWorkerPool.registerMapRuntime(
                mapId,
                packet.runtimeRegistration.borderSize,
                packet.runtimeRegistration.locsAnimated,
                npcTypeAnimationTable,
                mapSimToken,
            );
            await this.deps.simWorkerPool.bootstrapMapRuntime(
                mapId,
                maxLevel,
                npcOrderKeys,
                mapSimToken,
            );
        } catch (error: unknown) {
            void this.deps.renderWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
            void this.deps.simWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
            throw error;
        }
    }

    private unregisterMapRuntime(mapId: number, mapSimToken: number): void {
        void this.deps.simWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
        void this.deps.renderWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
    }
}
