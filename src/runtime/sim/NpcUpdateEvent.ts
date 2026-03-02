import type { NpcUpdateDelta } from "./NpcSimMovement";

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

export type NpcRuntimeEvent = NpcUpdateEvent | NpcDespawnEvent;
