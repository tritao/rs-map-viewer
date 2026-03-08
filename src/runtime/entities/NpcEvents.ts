import type { NpcUpdateDelta } from "../sim/NpcSimMovement";

export type NpcSpawnEvent = Readonly<{
    kind: "spawn";
    mapId: number;
    npcInstanceId: number;
    npcTypeId: number;
    tileX: number;
    tileY: number;
    level: number;
    orderKey?: number;
}>;

export type NpcUpdateEvent = Readonly<{
    kind: "update";
    mapId: number;
    npcInstanceId: number;
    seq: number;
    delta: NpcUpdateDelta;
}>;

export type NpcDespawnEvent = Readonly<{
    kind: "despawn";
    mapId: number;
    npcInstanceId: number;
    seq: number;
}>;

export type NpcRuntimeEvent = NpcUpdateEvent | NpcDespawnEvent;
export type NpcEvent = NpcSpawnEvent | NpcRuntimeEvent;
