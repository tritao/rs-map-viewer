import type { MovementType } from "./Npc";

export type NpcUpdatePathDelta = Readonly<{
    length?: number;
    pathX: ArrayLike<number>;
    pathY: ArrayLike<number>;
    pathMovementType?: ArrayLike<MovementType | number>;
}>;

export type NpcUpdateDelta = Readonly<{
    clearServerPath?: boolean;
    snapTileX?: number;
    snapTileY?: number;
    snapWorldX?: number;
    snapWorldY?: number;
    orientation?: number;
    rotation?: number;
    movementSeqId?: number;
    movementFrame?: number;
    movementFrameTick?: number;
    movementLoop?: number;
    path?: NpcUpdatePathDelta;
}>;
