import type { MapRuntimeBootstrap, MapRuntimeRegistration } from "../maprender/MapRenderPayload";
import type { NpcTypeAnimationEntry } from "./contracts/NpcTypeAnimationTable";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";

const EMPTY_NPC_ORDER_KEYS = new Int32Array(0);
const EMPTY_NPC_TYPE_ANIMATION_TABLE: ReadonlyArray<NpcTypeAnimationEntry> = [];

export class MapRuntimeController {
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private nextMapSimToken: number = 1;

    constructor(
        private readonly renderWorkerPool: RenderDataWorkerPool,
        private readonly simWorkerPool: SimWorkerPool,
    ) {}

    private reserveMapSimToken(mapId: number): number {
        const token = this.nextMapSimToken | 0;
        this.nextMapSimToken = (token + 1) | 0;
        this.mapSimTokenByMapId.set(mapId | 0, token);
        return token;
    }

    private invalidateMapSimToken(mapId: number): number {
        return this.reserveMapSimToken(mapId | 0);
    }

    hasMapSimToken(mapId: number, token: number): boolean {
        return (this.mapSimTokenByMapId.get(mapId | 0) ?? 0) === (token | 0);
    }

    async registerMapRuntime(
        mapId: number,
        runtimeRegistration: MapRuntimeRegistration,
        runtimeBootstrap: MapRuntimeBootstrap,
        npcSlotCount: number,
    ): Promise<number> {
        const npcOrderKeys = runtimeBootstrap.npcOrderKeys ?? EMPTY_NPC_ORDER_KEYS;
        if ((npcOrderKeys.length | 0) !== (npcSlotCount | 0)) {
            throw new Error(
                `[map-render][npc] npc slot metadata mismatch for mapId=${mapId | 0}: ` +
                    `orderKeys=${npcOrderKeys.length | 0} slots=${npcSlotCount | 0}`,
            );
        }
        const npcTypeAnimationTable =
            runtimeRegistration.npcTypeAnimationTable ?? EMPTY_NPC_TYPE_ANIMATION_TABLE;
        const mapSimToken = this.reserveMapSimToken(mapId | 0);
        await this.renderWorkerPool.registerMapRuntime(
            mapId | 0,
            runtimeRegistration.borderSize,
            runtimeRegistration.tileRenderFlagsLevel1,
            runtimeRegistration.locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        );
        try {
            await this.simWorkerPool.registerMapRuntime(
                mapId | 0,
                runtimeRegistration.borderSize,
                runtimeRegistration.locsAnimated,
                npcTypeAnimationTable,
                mapSimToken,
            );
            await this.simWorkerPool.bootstrapMapRuntime(
                mapId | 0,
                runtimeBootstrap.maxLevel,
                npcOrderKeys,
                mapSimToken,
            );
        } catch (error: unknown) {
            void this.renderWorkerPool.unregisterMapRuntime(mapId | 0, mapSimToken);
            void this.simWorkerPool.unregisterMapRuntime(mapId | 0, mapSimToken);
            throw error;
        }
        return mapSimToken;
    }

    unregisterMapRuntime(mapId: number): void {
        const mapSimToken = this.invalidateMapSimToken(mapId | 0);
        void this.simWorkerPool.unregisterMapRuntime(mapId | 0, mapSimToken);
        void this.renderWorkerPool.unregisterMapRuntime(mapId | 0, mapSimToken);
    }

    reset(): void {
        this.mapSimTokenByMapId.clear();
        this.nextMapSimToken = 1;
    }
}
