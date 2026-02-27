import type { DrawCall } from "picogl";

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

const DRAW_RANGE_PATCH_STRIDE = 4;
const DRAW_RANGE_PATCH_INDEX_INDEX = 0;
const DRAW_RANGE_PATCH_OFFSET_INDEX = 1;
const DRAW_RANGE_PATCH_ELEMENTS_INDEX = 2;
const DRAW_RANGE_PATCH_INSTANCES_INDEX = 3;

export function applyDrawRangePatches(
    drawCall: DrawCall,
    drawRangesPacked: Int32Array,
    patchStreamPacked: Int32Array,
    patchCount: number,
): void {
    const maxPatchCountByStream = (patchStreamPacked.length / DRAW_RANGE_PATCH_STRIDE) | 0;
    const requestedPatchCount = patchCount | 0;
    const safePatchCount = Math.max(0, Math.min(requestedPatchCount, maxPatchCountByStream));
    const maxDrawRanges = Math.min(
        (drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0,
        drawCall.offsets.length | 0,
    );
    if (maxDrawRanges <= 0) {
        return;
    }

    for (let i = 0; i < safePatchCount; i++) {
        const patchOffset = i * DRAW_RANGE_PATCH_STRIDE;
        const drawRangeIndex = patchStreamPacked[patchOffset + DRAW_RANGE_PATCH_INDEX_INDEX] | 0;
        if (drawRangeIndex < 0 || drawRangeIndex >= maxDrawRanges) {
            continue;
        }

        const drawRangeOffset = drawRangeIndex * DRAW_RANGE_STRIDE;
        const offset = patchStreamPacked[patchOffset + DRAW_RANGE_PATCH_OFFSET_INDEX] | 0;
        const elements = patchStreamPacked[patchOffset + DRAW_RANGE_PATCH_ELEMENTS_INDEX] | 0;
        const instances = patchStreamPacked[patchOffset + DRAW_RANGE_PATCH_INSTANCES_INDEX] | 0;

        drawCall.offsets[drawRangeIndex] = offset;
        (drawCall as any).numElements[drawRangeIndex] = elements;
        (drawCall as any).numInstances[drawRangeIndex] = instances;

        drawRangesPacked[drawRangeOffset + DRAW_RANGE_OFFSET_INDEX] = offset;
        drawRangesPacked[drawRangeOffset + DRAW_RANGE_ELEMENTS_INDEX] = elements;
        drawRangesPacked[drawRangeOffset + DRAW_RANGE_INSTANCES_INDEX] = instances;
    }
}

