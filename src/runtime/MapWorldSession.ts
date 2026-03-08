import type { ObjRenderData } from "../maprender/MapRenderPayload";
import type { MapObjRenderPacket } from "./contracts/MapObjRenderPacket";
import type { DecodedStaticMapPacket } from "./contracts/StaticMapWireCodec";
import {
    createMapObjRenderPacket,
    createNpcLifecyclePacket,
    dispatchMapObjRenderPacket,
    dispatchNpcLifecyclePacketBytes,
    registerMapRuntime,
    unregisterMapRuntime,
} from "./MapRuntime";
import type { NpcEvent } from "./entities/NpcEvents";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";

type MapWorldSessionDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    requestFrameRefresh(): void;
}>;

const DRAW_RANGE_STRIDE = 3;

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
        await registerMapRuntime({
            renderWorkerPool: this.deps.renderWorkerPool,
            simWorkerPool: this.deps.simWorkerPool,
            mapId,
            maxLevel: packet.mapData.maxLevel,
            runtimeRegistration: packet.runtimeRegistration,
            runtimeBootstrap: packet.runtimeBootstrap,
            npcSlotCount: this.getNpcSlotCount(packet),
            mapSimToken,
        });
        if (
            !this.hasLoadEpoch(loadEpoch) ||
            !this.hasToken(mapId, mapSimToken)
        ) {
            unregisterMapRuntime({
                renderWorkerPool: this.deps.renderWorkerPool,
                simWorkerPool: this.deps.simWorkerPool,
                mapId,
                mapSimToken,
            });
            return false;
        }
        return true;
    }

    unregisterLoadedMap(mapId: number): void {
        unregisterMapRuntime({
            renderWorkerPool: this.deps.renderWorkerPool,
            simWorkerPool: this.deps.simWorkerPool,
            mapId: mapId | 0,
            mapSimToken: this.invalidateToken(mapId),
        });
    }

    async applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        const packet = createNpcLifecyclePacket(events);
        if (!packet) {
            return 0;
        }
        return this.applyNpcLifecyclePacketBytes(packet);
    }

    replaceMapObjRenderData(mapId: number, objRenderData: ObjRenderData | undefined): void {
        void this.applyMapObjRenderPacket(createMapObjRenderPacket(mapId, objRenderData));
    }

    attachLoadedMapRuntime(packet: DecodedStaticMapPacket): void {
        this.replaceMapObjRenderData(packet.mapData.mapId | 0, packet.runtimeBootstrap.objRenderData);
    }

    applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): void {
        void dispatchMapObjRenderPacket({
            renderWorkerPool: this.deps.renderWorkerPool,
            packet,
            requestRefresh: () => this.deps.requestFrameRefresh(),
        });
    }

    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | ArrayBufferView): Promise<number> {
        return await dispatchNpcLifecyclePacketBytes({
            simWorkerPool: this.deps.simWorkerPool,
            packet,
        });
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

    private getNpcSlotCount(packet: DecodedStaticMapPacket): number {
        const mapData = packet.mapData;
        const npcDrawRangeInts = mapData.npcDrawRangesBase?.length ?? 0;
        if (npcDrawRangeInts % DRAW_RANGE_STRIDE !== 0) {
            throw new Error(
                `[map-render][npc] invalid npcDrawRangesBase length for map ${mapData.mapX},${mapData.mapY}: ` +
                    `len=${npcDrawRangeInts} stride=${DRAW_RANGE_STRIDE}`,
            );
        }
        return (npcDrawRangeInts / DRAW_RANGE_STRIDE) | 0;
    }
}
