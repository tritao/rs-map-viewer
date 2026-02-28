import type { NpcGpuFrameData } from "../npc/NpcGpuData";

// Packed NPC movement snapshot used to sync renderer-side NPC objects and to build GPU instance data.
// Per NPC stride: x, y, orientation, rotation, pathLength, movementSeqId.
export const NPC_MOVE_STATE_STRIDE = 6;

// Meta triplets: [mapId, npcCount, stateOffsetInts]
export const NPC_MOVE_META_STRIDE = 3;

// Meta pairs: [mapId, npcDataOffset]
export const NPC_OFFSETS_BY_MAP_ID_STRIDE = 2;

// Per-map tick patch counts cover:
// 8 loc variants (base/alpha/lod/lodAlpha/interact/interactAlpha/interactLod/interactLodAlpha)
// 2 npc variants (base/alpha)
export const TICK_PATCH_STREAM_COUNT = 10;

// Meta tuples: [mapId, <10 counts in the stream order above>]
export const TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE = 1 + TICK_PATCH_STREAM_COUNT;

// Patch tuples are packed as: [drawRangeIndex, offset, elements, instances]
export const TICK_PATCH_ENTRY_STRIDE = 4;

export type FramePacket = Readonly<{
    frameCount: number;

    // Packed NPC info texture for the npc shader (x,y,rotationAndPlane,typeId).
    npcGpuFrameData: NpcGpuFrameData;

    // Pairs of [mapId, offset] for the current frame's NPC upload (offset is npc index into the gpu data).
    npcOffsetsByMapIdPairs: Int32Array;

    // Movement state snapshot (for syncing main-thread NPC objects before animation tick).
    npcMoveStateMeta: Int32Array;
    npcMoveStatePacked: Int32Array;

    // Draw-range tick patches for animated locs + NPCs.
    // Patches are concatenated by map, and within each map by stream index [0..9].
    tickPatchCountsByMapId: Int32Array;
    tickPatchPacked: Int32Array;
}>;

export function framePacketTransferables(packet: FramePacket): Transferable[] {
    const out: Transferable[] = [];
    out.push(packet.npcGpuFrameData.data.buffer as Transferable);
    out.push(packet.npcOffsetsByMapIdPairs.buffer as Transferable);
    out.push(packet.npcMoveStateMeta.buffer as Transferable);
    out.push(packet.npcMoveStatePacked.buffer as Transferable);
    out.push(packet.tickPatchCountsByMapId.buffer as Transferable);
    out.push(packet.tickPatchPacked.buffer as Transferable);
    return out;
}
