import type { AnimationFrames } from "../../runtime/contracts/AnimationFrames";
import type { NpcRuntimeEvent } from "../../runtime/sim/NpcUpdateEvent";

export type NpcBootstrapSpawnEvent = Readonly<{
    kind: "spawn";
    mapId: number;
    npcTypeId: number;
    tileX: number;
    tileY: number;
    level: number;
    orderKey?: number;
    idleAnim?: AnimationFrames;
    walkAnim?: AnimationFrames;
}>;

export type WorkerNpcLifecycleEvent = NpcBootstrapSpawnEvent | NpcRuntimeEvent;
