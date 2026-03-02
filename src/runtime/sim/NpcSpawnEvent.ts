import type { AnimationFrames } from "../contracts/AnimationFrames";

export type NpcSpawnEvent = Readonly<{
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
