import type { Npc } from "./Npc";

export type NpcGpuFrameData = Readonly<{
    width: number;
    height: number;
    data: Uint16Array;
}>;

export type NpcGpuDataTarget = Readonly<{
    id: number;
    getNpcs(): ReadonlyArray<Npc>;
    getTileRenderFlag(level: number, tileX: number, tileY: number): number;
}>;

// Ring size shared across:
// - GPU texture ring (WebGL)
// - per-map offset rings
// - worker-side NPC sim state
export const NPC_DATA_TEXTURE_RING_SIZE = 5;
