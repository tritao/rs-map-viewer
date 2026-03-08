export const TICK_PATCH_STREAM_COUNT = 10;
export const LOC_TICK_PATCH_STREAM_BASE = 0;
export const LOC_TICK_PATCH_STREAM_COUNT = 8;
export const NPC_TICK_PATCH_STREAM_BASE = LOC_TICK_PATCH_STREAM_BASE + LOC_TICK_PATCH_STREAM_COUNT;
export const NPC_TICK_PATCH_STREAM_COUNT = 2;

export const TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE = 1 + TICK_PATCH_STREAM_COUNT;
export const TICK_PATCH_ENTRY_STRIDE = 4;

export function getLocTickPatchStreamIndex(
    isAlpha: boolean,
    isInteract: boolean,
    isLod: boolean,
): number {
    const interactBit = isInteract ? 4 : 0;
    const lodBit = isLod ? 2 : 0;
    const alphaBit = isAlpha ? 1 : 0;
    return (LOC_TICK_PATCH_STREAM_BASE + interactBit + lodBit + alphaBit) | 0;
}

export function getNpcTickPatchStreamIndex(isAlpha: boolean): number {
    return (NPC_TICK_PATCH_STREAM_BASE + (isAlpha ? 1 : 0)) | 0;
}
