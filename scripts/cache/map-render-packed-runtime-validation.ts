import type { MapRenderDataPayload } from "../../src/worker/MapRenderDataContract";
import { DRAW_BUCKET_KEYS } from "../../src/worker/MapRenderRuntimeInputValidation";

// Legacy helper for packed-runtime payload validation.
// Runtime cache-v2 parity and regressions should use command-stream input validation instead.
export type MapRenderPackedRuntimeInput = Readonly<{
    sceneTileHeights: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    bucketCmdCounts: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    packedInstances: Int32Array;
}>;

export function validatePackedRuntimeInput(
    runtimePackedInput: MapRenderPackedRuntimeInput,
    payload?: MapRenderDataPayload,
): string | undefined {
    if (!runtimePackedInput || typeof runtimePackedInput !== "object") {
        return "missing runtimePackedInput";
    }
    const levels = runtimePackedInput.levels | 0;
    const sizeX = runtimePackedInput.sizeX | 0;
    const sizeY = runtimePackedInput.sizeY | 0;
    const unitsTileHeightBasis = runtimePackedInput.unitsTileHeightBasis | 0;
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return `invalid runtimePackedInput dimensions levels=${levels} sizeX=${sizeX} sizeY=${sizeY} basis=${unitsTileHeightBasis}`;
    }

    const sceneTileHeights = runtimePackedInput.sceneTileHeights;
    if (!(sceneTileHeights instanceof Int32Array)) {
        return "runtimePackedInput.sceneTileHeights must be Int32Array";
    }
    const expectedHeightsLength = levels * (sizeX + 1) * (sizeY + 1);
    if (sceneTileHeights.length !== expectedHeightsLength) {
        return `runtimePackedInput.sceneTileHeights length mismatch expected=${expectedHeightsLength} got=${sceneTileHeights.length}`;
    }

    const bucketCmdCounts = runtimePackedInput.bucketCmdCounts;
    if (
        !(bucketCmdCounts instanceof Int32Array) ||
        bucketCmdCounts.length !== DRAW_BUCKET_KEYS.length
    ) {
        return `runtimePackedInput.bucketCmdCounts length mismatch expected=${DRAW_BUCKET_KEYS.length}`;
    }
    const cmdOffsets = runtimePackedInput.cmdOffsets;
    const cmdElements = runtimePackedInput.cmdElements;
    const cmdInstanceCounts = runtimePackedInput.cmdInstanceCounts;
    const packedInstances = runtimePackedInput.packedInstances;
    if (!(cmdOffsets instanceof Int32Array)) {
        return "runtimePackedInput.cmdOffsets must be Int32Array";
    }
    if (!(cmdElements instanceof Int32Array)) {
        return "runtimePackedInput.cmdElements must be Int32Array";
    }
    if (!(cmdInstanceCounts instanceof Int32Array)) {
        return "runtimePackedInput.cmdInstanceCounts must be Int32Array";
    }
    if (!(packedInstances instanceof Int32Array)) {
        return "runtimePackedInput.packedInstances must be Int32Array";
    }
    const totalCmdCount = cmdOffsets.length | 0;
    if (cmdElements.length !== totalCmdCount || cmdInstanceCounts.length !== totalCmdCount) {
        return `runtimePackedInput command lengths mismatch offsets=${cmdOffsets.length} elements=${cmdElements.length} instanceCounts=${cmdInstanceCounts.length}`;
    }
    let cmdCountFromBuckets = 0;
    let totalInstances = 0;
    for (let bucket = 0; bucket < bucketCmdCounts.length; bucket++) {
        const cmdCount = bucketCmdCounts[bucket] | 0;
        if (cmdCount < 0) {
            return `runtimePackedInput.bucketCmdCounts[${bucket}] negative`;
        }
        cmdCountFromBuckets += cmdCount;
    }
    if (cmdCountFromBuckets !== totalCmdCount) {
        return `runtimePackedInput totalCmdCount mismatch expected=${cmdCountFromBuckets} got=${totalCmdCount}`;
    }
    for (let i = 0; i < totalCmdCount; i++) {
        if ((cmdOffsets[i] | 0) < 0 || (cmdElements[i] | 0) < 0) {
            return `runtimePackedInput command[${i}] has negative offset/elements`;
        }
        const instanceCount = cmdInstanceCounts[i] | 0;
        if (instanceCount < 0) {
            return `runtimePackedInput.cmdInstanceCounts[${i}] negative`;
        }
        totalInstances += instanceCount;
    }
    const expectedPackedInstanceLength = totalInstances * 8;
    if (packedInstances.length !== expectedPackedInstanceLength) {
        return `runtimePackedInput.packedInstances length mismatch expected=${expectedPackedInstanceLength} got=${packedInstances.length}`;
    }

    if (payload) {
        const payloadLevels = payload.tileRenderFlags?.length | 0;
        const payloadSizeX = payload.tileRenderFlags?.[0]?.length | 0;
        const payloadSizeY = payload.tileRenderFlags?.[0]?.[0]?.length | 0;
        if (payloadLevels > 0 && payloadLevels !== levels) {
            return `runtimePackedInput.levels mismatch expected=${payloadLevels} got=${levels}`;
        }
        if (payloadSizeX > 0 && payloadSizeX !== sizeX) {
            return `runtimePackedInput.sizeX mismatch expected=${payloadSizeX} got=${sizeX}`;
        }
        if (payloadSizeY > 0 && payloadSizeY !== sizeY) {
            return `runtimePackedInput.sizeY mismatch expected=${payloadSizeY} got=${sizeY}`;
        }
    }
    return undefined;
}
