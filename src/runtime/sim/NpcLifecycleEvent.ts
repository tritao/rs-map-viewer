import type { AnimationFrames } from "../../renderer/AnimationFrames";
import type { NpcUpdateDelta } from "./NpcSimMovement";

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

export type NpcUpdateEvent = Readonly<{
    kind: "update";
    mapId: number;
    delta: NpcUpdateDelta;
}>;

export type NpcDespawnEvent = Readonly<{
    kind: "despawn";
    mapId: number;
    npcOrderKey?: number;
    npcIndex?: number;
}>;

export type NpcLifecycleEvent = NpcSpawnEvent | NpcUpdateEvent | NpcDespawnEvent;
