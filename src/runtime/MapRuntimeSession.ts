import type { DecodedStaticMapPacket } from "./contracts/StaticMapWireCodec";
import { registerMapRuntime, unregisterMapRuntime } from "./MapRuntime";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";

const DRAW_RANGE_STRIDE = 3;

export type RegisteredMapRuntime = Readonly<{
    mapId: number;
    mapSimToken: number;
}>;

type MapRuntimeSessionDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
}>;

export class MapRuntimeSession {
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private nextMapSimToken: number = 1;

    constructor(private readonly deps: MapRuntimeSessionDeps) {}

    reset(): void {
        this.mapSimTokenByMapId.clear();
        this.nextMapSimToken = 1;
    }

    hasToken(mapId: number, token: number): boolean {
        return (this.mapSimTokenByMapId.get(mapId | 0) ?? 0) === (token | 0);
    }

    async registerLoadedMap(packet: DecodedStaticMapPacket): Promise<RegisteredMapRuntime> {
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
        return { mapId, mapSimToken };
    }

    unregisterLoadedMap(mapId: number): void {
        unregisterMapRuntime({
            renderWorkerPool: this.deps.renderWorkerPool,
            simWorkerPool: this.deps.simWorkerPool,
            mapId: mapId | 0,
            mapSimToken: this.invalidateToken(mapId),
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
