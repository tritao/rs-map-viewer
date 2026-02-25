import type { SceneCommandStreamEntry } from "../../src/renderer/buffer/SceneBuffer";
import {
    DRAW_BUCKET_KEYS,
    type RuntimeDrawCommandBuckets,
    type RuntimeInputDimensions,
    buildRuntimeCommandStreamFromBuckets,
    buildRuntimeCommandStreamInput,
} from "../../src/renderer/buffer/SceneCommandBuilder";

// Legacy packed-runtime adapter kept for backward-compat tooling only.
// Active runtime path is command-stream based and should not expand packed usage.
export type SceneCommandPackedRuntimeInput = Readonly<{
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

export function buildPackedRuntimeInputFromCommandStream(
    sceneTileHeights: Int32Array,
    dimensions: RuntimeInputDimensions,
    commandStream: ReadonlyArray<SceneCommandStreamEntry>,
): SceneCommandPackedRuntimeInput {
    const streamInput = buildRuntimeCommandStreamInput(sceneTileHeights, dimensions, commandStream);
    const bucketCmdCounts = new Int32Array(DRAW_BUCKET_KEYS.length);
    for (let i = 0; i < streamInput.cmdBucketIndices.length; i++) {
        const bucketIndex = streamInput.cmdBucketIndices[i] | 0;
        if (bucketIndex < 0 || bucketIndex >= DRAW_BUCKET_KEYS.length) {
            continue;
        }
        bucketCmdCounts[bucketIndex]++;
    }

    const totalCmdCount = streamInput.cmdOffsets.length | 0;
    const cmdOffsets = new Int32Array(totalCmdCount);
    const cmdElements = new Int32Array(totalCmdCount);
    const cmdInstanceCounts = new Int32Array(totalCmdCount);
    const packedInstances = new Int32Array(streamInput.cmdPackedInstances.length);
    const cmdInstanceStarts = new Int32Array(totalCmdCount);

    let inInstanceCursor = 0;
    for (let i = 0; i < totalCmdCount; i++) {
        cmdInstanceStarts[i] = inInstanceCursor;
        inInstanceCursor += streamInput.cmdInstanceCounts[i] | 0;
    }

    let cmdCursor = 0;
    let instanceCursor = 0;
    for (let bucketIndex = 0; bucketIndex < DRAW_BUCKET_KEYS.length; bucketIndex++) {
        for (let i = 0; i < totalCmdCount; i++) {
            if ((streamInput.cmdBucketIndices[i] | 0) !== bucketIndex) {
                continue;
            }
            cmdOffsets[cmdCursor] = streamInput.cmdOffsets[i] | 0;
            cmdElements[cmdCursor] = streamInput.cmdElements[i] | 0;
            const instanceCount = streamInput.cmdInstanceCounts[i] | 0;
            cmdInstanceCounts[cmdCursor] = instanceCount;
            cmdCursor++;

            const inOffset = (cmdInstanceStarts[i] | 0) * 8;
            const copyLength = instanceCount * 8;
            for (let j = 0; j < copyLength; j++) {
                packedInstances[instanceCursor++] =
                    streamInput.cmdPackedInstances[inOffset + j] | 0;
            }
        }
    }

    return {
        sceneTileHeights,
        levels: dimensions.levels | 0,
        sizeX: dimensions.sizeX | 0,
        sizeY: dimensions.sizeY | 0,
        unitsTileHeightBasis: dimensions.unitsTileHeightBasis | 0,
        bucketCmdCounts,
        cmdOffsets,
        cmdElements,
        cmdInstanceCounts,
        packedInstances,
    };
}

export function buildPackedRuntimeInput(
    sceneTileHeights: Int32Array,
    dimensions: RuntimeInputDimensions,
    drawCommands: RuntimeDrawCommandBuckets,
): SceneCommandPackedRuntimeInput {
    return buildPackedRuntimeInputFromCommandStream(
        sceneTileHeights,
        dimensions,
        buildRuntimeCommandStreamFromBuckets(drawCommands),
    );
}
