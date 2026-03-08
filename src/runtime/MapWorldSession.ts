import type { ObjRenderData } from "../maprender/MapRenderPayload";
import type { MapObjRenderPacket } from "./contracts/MapObjRenderPacket";
import type { DecodedStaticMapPacket } from "./contracts/StaticMapWireCodec";
import { createMapObjRenderPacket, createNpcLifecyclePacket, dispatchMapObjRenderPacket, dispatchNpcLifecyclePacketBytes } from "./MapRuntime";
import { type MapRuntimeSession, type RegisteredMapRuntime } from "./MapRuntimeSession";
import type { NpcEvent } from "./entities/NpcEvents";

type MapWorldSessionDeps = Readonly<{
    runtimeSession: MapRuntimeSession;
    requestFrameRefresh(): void;
}>;

export class MapWorldSession {
    constructor(private readonly deps: MapWorldSessionDeps) {}

    reset(): void {
        this.deps.runtimeSession.reset();
    }

    hasToken(mapId: number, token: number): boolean {
        return this.deps.runtimeSession.hasToken(mapId, token);
    }

    registerLoadedMap(packet: DecodedStaticMapPacket): Promise<RegisteredMapRuntime> {
        return this.deps.runtimeSession.registerLoadedMap(packet);
    }

    unregisterLoadedMap(mapId: number): void {
        this.deps.runtimeSession.unregisterLoadedMap(mapId);
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

    applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): void {
        void dispatchMapObjRenderPacket({
            renderWorkerPool: this.deps.runtimeSession.renderWorkerPool,
            packet,
            requestRefresh: () => this.deps.requestFrameRefresh(),
        });
    }

    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | ArrayBufferView): Promise<number> {
        return await dispatchNpcLifecyclePacketBytes({
            simWorkerPool: this.deps.runtimeSession.simWorkerPool,
            packet,
        });
    }
}
