import type { ObjRenderData } from "../maprender/MapRenderPayload";
import type { MapObjRenderPacket } from "./contracts/MapObjRenderPacket";
import { buildMapObjRenderPacket } from "./contracts/MapObjRenderPacket";
import { encodeNpcLifecyclePacketFromEvents } from "./contracts/NpcLifecyclePacket";
import type { DecodedStaticMapPacket } from "./contracts/StaticMapWireCodec";
import type { NpcEvent } from "./entities/NpcEvents";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";
import type { NpcTypeAnimationEntry } from "./contracts/NpcTypeAnimationTable";

type MapWorldSessionDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    requestFrameRefresh(): void;
}>;

const DRAW_RANGE_STRIDE = 3;
const EMPTY_NPC_ORDER_KEYS = new Int32Array(0);
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
        void this.dispatchMapObjRenderPacket(packet);
    }

    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | ArrayBufferView): Promise<number> {
        const bytes = normalizePacketBytes(packet);
        return await this.deps.simWorkerPool.applyNpcLifecyclePacketBytes(bytes);
    }

    private async dispatchMapObjRenderPacket(packet: MapObjRenderPacket | undefined): Promise<void> {
        if (!packet) {
            return;
        }
        const applied = await this.deps.renderWorkerPool.applyMapObjRenderPacket(packet);
        if ((applied | 0) > 0) {
            this.deps.requestFrameRefresh();
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
        const npcSlotCount = this.getNpcSlotCount(packet);
        const npcOrderKeys = packet.runtimeBootstrap.npcOrderKeys ?? EMPTY_NPC_ORDER_KEYS;
        if ((npcOrderKeys.length | 0) !== (npcSlotCount | 0)) {
            throw new Error(
                `[map-render][npc] npc slot metadata mismatch for mapId=${mapId}: ` +
                    `orderKeys=${npcOrderKeys.length | 0} slots=${npcSlotCount | 0}`,
            );
        }
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

function createMapObjRenderPacket(
    mapId: number,
    objRenderData: ObjRenderData | undefined,
): MapObjRenderPacket {
    return buildMapObjRenderPacket([
        {
            mapId: mapId | 0,
            objRenderData,
        },
    ]);
}

function createNpcLifecyclePacket(events: ReadonlyArray<NpcEvent>): Uint8Array | undefined {
    if ((events.length | 0) <= 0) {
        return undefined;
    }
    return encodeNpcLifecyclePacketFromEvents(events);
}

function normalizePacketBytes(packet: ArrayBuffer | ArrayBufferView): Uint8Array {
    return packet instanceof Uint8Array
        ? packet
        : packet instanceof ArrayBuffer
        ? new Uint8Array(packet)
        : new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength);
}
