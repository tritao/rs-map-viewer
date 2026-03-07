import type { MapRuntimeBootstrap, MapRuntimeRegistration } from "../maprender/MapRenderPayload";
import type { NpcTypeAnimationEntry } from "./contracts/NpcTypeAnimationTable";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";

const EMPTY_NPC_ORDER_KEYS = new Int32Array(0);
const EMPTY_NPC_TYPE_ANIMATION_TABLE: ReadonlyArray<NpcTypeAnimationEntry> = [];

export async function registerMapRuntime(input: Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    mapId: number;
    maxLevel: number;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
    npcSlotCount: number;
    mapSimToken: number;
}>): Promise<void> {
    const mapId = input.mapId | 0;
    const mapSimToken = input.mapSimToken | 0;
    const npcOrderKeys = input.runtimeBootstrap.npcOrderKeys ?? EMPTY_NPC_ORDER_KEYS;
    if ((npcOrderKeys.length | 0) !== (input.npcSlotCount | 0)) {
        throw new Error(
            `[map-render][npc] npc slot metadata mismatch for mapId=${mapId}: ` +
                `orderKeys=${npcOrderKeys.length | 0} slots=${input.npcSlotCount | 0}`,
        );
    }
    const npcTypeAnimationTable =
        input.runtimeRegistration.npcTypeAnimationTable ?? EMPTY_NPC_TYPE_ANIMATION_TABLE;
    await input.renderWorkerPool.registerMapRuntime(
        mapId,
        input.runtimeRegistration.borderSize,
        input.runtimeRegistration.tileRenderFlagsLevel1,
        input.runtimeRegistration.locsAnimated,
        npcTypeAnimationTable,
        mapSimToken,
    );
    try {
        await input.simWorkerPool.registerMapRuntime(
            mapId,
            input.runtimeRegistration.borderSize,
            input.runtimeRegistration.locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        );
        await input.simWorkerPool.bootstrapMapRuntime(
            mapId,
            input.maxLevel,
            npcOrderKeys,
            mapSimToken,
        );
    } catch (error: unknown) {
        void input.renderWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
        void input.simWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
        throw error;
    }
}

export function unregisterMapRuntime(input: Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    mapId: number;
    mapSimToken: number;
}>): void {
    const mapId = input.mapId | 0;
    const mapSimToken = input.mapSimToken | 0;
    void input.simWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
    void input.renderWorkerPool.unregisterMapRuntime(mapId, mapSimToken);
}
