export type NpcGpuFrameData = Readonly<{
    width: number;
    height: number;
    data: Uint16Array;
}>;

// Ring size shared across:
// - GPU texture ring (WebGL)
// - per-map offset rings
// - worker-side NPC sim state
export const NPC_DATA_TEXTURE_RING_SIZE = 5;
