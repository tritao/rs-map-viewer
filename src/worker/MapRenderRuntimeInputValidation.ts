import type {
    MapRenderCommandStreamRuntimeInput,
    MapRenderDataPayload,
} from "./MapRenderDataContract";

export const DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
] as const;

export function validateCommandStreamRuntimeInput(
    runtimeCommandStreamInput: MapRenderCommandStreamRuntimeInput,
    payload?: MapRenderDataPayload,
): string | undefined {
    if (!runtimeCommandStreamInput || typeof runtimeCommandStreamInput !== "object") {
        return "missing runtimeCommandStreamInput";
    }
    const levels = runtimeCommandStreamInput.levels | 0;
    const sizeX = runtimeCommandStreamInput.sizeX | 0;
    const sizeY = runtimeCommandStreamInput.sizeY | 0;
    const unitsTileHeightBasis = runtimeCommandStreamInput.unitsTileHeightBasis | 0;
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return `invalid runtimeCommandStreamInput dimensions levels=${levels} sizeX=${sizeX} sizeY=${sizeY} basis=${unitsTileHeightBasis}`;
    }

    const sceneTileHeights = runtimeCommandStreamInput.sceneTileHeights;
    if (!(sceneTileHeights instanceof Int32Array)) {
        return "runtimeCommandStreamInput.sceneTileHeights must be Int32Array";
    }
    const expectedHeightsLength = levels * (sizeX + 1) * (sizeY + 1);
    if (sceneTileHeights.length !== expectedHeightsLength) {
        return `runtimeCommandStreamInput.sceneTileHeights length mismatch expected=${expectedHeightsLength} got=${sceneTileHeights.length}`;
    }

    const cmdBucketIndices = runtimeCommandStreamInput.cmdBucketIndices;
    const cmdOffsets = runtimeCommandStreamInput.cmdOffsets;
    const cmdElements = runtimeCommandStreamInput.cmdElements;
    const cmdInstanceCounts = runtimeCommandStreamInput.cmdInstanceCounts;
    const cmdPackedInstances = runtimeCommandStreamInput.cmdPackedInstances;
    if (!(cmdBucketIndices instanceof Int32Array)) {
        return "runtimeCommandStreamInput.cmdBucketIndices must be Int32Array";
    }
    if (!(cmdOffsets instanceof Int32Array)) {
        return "runtimeCommandStreamInput.cmdOffsets must be Int32Array";
    }
    if (!(cmdElements instanceof Int32Array)) {
        return "runtimeCommandStreamInput.cmdElements must be Int32Array";
    }
    if (!(cmdInstanceCounts instanceof Int32Array)) {
        return "runtimeCommandStreamInput.cmdInstanceCounts must be Int32Array";
    }
    if (!(cmdPackedInstances instanceof Int32Array)) {
        return "runtimeCommandStreamInput.cmdPackedInstances must be Int32Array";
    }
    const totalCmdCount = cmdOffsets.length | 0;
    if (
        cmdBucketIndices.length !== totalCmdCount ||
        cmdElements.length !== totalCmdCount ||
        cmdInstanceCounts.length !== totalCmdCount
    ) {
        return `runtimeCommandStreamInput command lengths mismatch bucketIndices=${cmdBucketIndices.length} offsets=${cmdOffsets.length} elements=${cmdElements.length} instanceCounts=${cmdInstanceCounts.length}`;
    }
    let totalInstances = 0;
    for (let i = 0; i < totalCmdCount; i++) {
        const bucket = cmdBucketIndices[i] | 0;
        if (bucket < 0 || bucket >= DRAW_BUCKET_KEYS.length) {
            return `runtimeCommandStreamInput.cmdBucketIndices[${i}] out of range`;
        }
        if ((cmdOffsets[i] | 0) < 0 || (cmdElements[i] | 0) < 0) {
            return `runtimeCommandStreamInput command[${i}] has negative offset/elements`;
        }
        const instanceCount = cmdInstanceCounts[i] | 0;
        if (instanceCount < 0) {
            return `runtimeCommandStreamInput.cmdInstanceCounts[${i}] negative`;
        }
        totalInstances += instanceCount;
    }
    const expectedPackedInstancesLength = totalInstances * 8;
    if (cmdPackedInstances.length !== expectedPackedInstancesLength) {
        return `runtimeCommandStreamInput.cmdPackedInstances length mismatch expected=${expectedPackedInstancesLength} got=${cmdPackedInstances.length}`;
    }

    if (payload) {
        const payloadLevels = payload.tileRenderFlags?.length | 0;
        const payloadSizeX = payload.tileRenderFlags?.[0]?.length | 0;
        const payloadSizeY = payload.tileRenderFlags?.[0]?.[0]?.length | 0;
        if (payloadLevels > 0 && payloadLevels !== levels) {
            return `runtimeCommandStreamInput.levels mismatch expected=${payloadLevels} got=${levels}`;
        }
        if (payloadSizeX > 0 && payloadSizeX !== sizeX) {
            return `runtimeCommandStreamInput.sizeX mismatch expected=${payloadSizeX} got=${sizeX}`;
        }
        if (payloadSizeY > 0 && payloadSizeY !== sizeY) {
            return `runtimeCommandStreamInput.sizeY mismatch expected=${payloadSizeY} got=${sizeY}`;
        }
    }
    return undefined;
}
