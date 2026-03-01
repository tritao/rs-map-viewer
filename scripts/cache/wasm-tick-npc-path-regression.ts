import assert from "node:assert/strict";

import {
    ensureDrawRangePatchBackendInit,
    isDrawRangePatchBackendReady,
    registerDrawRangeTickState,
    resetDrawRangePatchBackend,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
    updateDrawRangeTickStateNpcPathPacked,
} from "../../src/wasm/DrawRangePatchBackend";
import type { DrawRangeTickStateInput } from "../../src/wasm/DrawRangeTickState";

function makeTickInputOneNpc(): DrawRangeTickStateInput {
    return {
        locFrameIds: new Int32Array(0),
        locCycleStartsFixed: new Int32Array(0),
        locFrameSteps: new Int32Array(0),
        locHasAnimMaya: new Int32Array(0),
        locAnimMayaDurations: new Int32Array(0),
        locFrameLengthOffsets: new Int32Array(0),
        locFrameLengthCounts: new Int32Array(0),
        locSeqIds: new Int32Array(0),
        locFrameLengthsPacked: new Int32Array(0),
        locOutActiveFlags: new Int32Array(0),
        locDrawRangeIndicesBase: new Int32Array(0),
        locAnimFrameOffsetsBase: new Int32Array(0),
        locAnimFrameCountsBase: new Int32Array(0),
        locAnimFramesBasePacked: new Int32Array(0),
        outLocPatchesPacked: new Int32Array(0),
        locDrawRangeIndicesAlpha: new Int32Array(0),
        locDrawRangeIndicesLod: new Int32Array(0),
        locDrawRangeIndicesLodAlpha: new Int32Array(0),
        locDrawRangeIndicesInteract: new Int32Array(0),
        locDrawRangeIndicesInteractAlpha: new Int32Array(0),
        locDrawRangeIndicesInteractLod: new Int32Array(0),
        locDrawRangeIndicesInteractLodAlpha: new Int32Array(0),
        locAnimFrameOffsetsAlpha: new Int32Array(0),
        locAnimFrameCountsAlpha: new Int32Array(0),
        locAnimFramesAlphaPacked: new Int32Array(0),
        outLocAlphaPatchesPacked: new Int32Array(0),
        outLocLodPatchesPacked: new Int32Array(0),
        outLocLodAlphaPatchesPacked: new Int32Array(0),
        outLocInteractPatchesPacked: new Int32Array(0),
        outLocInteractAlphaPatchesPacked: new Int32Array(0),
        outLocInteractLodPatchesPacked: new Int32Array(0),
        outLocInteractLodAlphaPatchesPacked: new Int32Array(0),

        npcX: Int32Array.of(64),
        npcY: Int32Array.of(64),
        npcOrientation: Int32Array.of(0),
        npcRotation: Int32Array.of(0),
        npcPathLength: Int32Array.of(1),
        npcMovementSeqId: Int32Array.of(-1),
        npcPathXPacked: Int32Array.of(2, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        npcPathYPacked: Int32Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        npcPathMovementTypePacked: Int32Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        npcSize: Int32Array.of(1),
        npcIsClickable: Int32Array.of(1),
        npcRotationSpeed: Int32Array.of(32),
        npcIdleSeqId: Int32Array.of(-1),
        npcWalkSeqId: Int32Array.of(-1),
        npcHasWalkAnim: Int32Array.of(0),
        npcFrameIds: Int32Array.of(0),
        npcFrameTicks: Int32Array.of(0),
        npcMovementLoops: Int32Array.of(0),
        npcIdleSeqValid: Int32Array.of(0),
        npcIdleSeqHasAnimMaya: Int32Array.of(0),
        npcIdleSeqAnimMayaDurations: Int32Array.of(0),
        npcIdleSeqFrameSteps: Int32Array.of(-1),
        npcIdleSeqLooping: Int32Array.of(0),
        npcIdleSeqMaxLoops: Int32Array.of(0),
        npcIdleSeqFrameIdCounts: Int32Array.of(0),
        npcIdleSeqFrameLengthOffsets: Int32Array.of(-1),
        npcIdleSeqFrameLengthCounts: Int32Array.of(0),
        npcWalkSeqValid: Int32Array.of(0),
        npcWalkSeqHasAnimMaya: Int32Array.of(0),
        npcWalkSeqAnimMayaDurations: Int32Array.of(0),
        npcWalkSeqFrameSteps: Int32Array.of(-1),
        npcWalkSeqLooping: Int32Array.of(0),
        npcWalkSeqMaxLoops: Int32Array.of(0),
        npcWalkSeqFrameIdCounts: Int32Array.of(0),
        npcWalkSeqFrameLengthOffsets: Int32Array.of(-1),
        npcWalkSeqFrameLengthCounts: Int32Array.of(0),
        npcSeqFrameLengthsPacked: new Int32Array(0),
        npcDrawRangeIndices: Int32Array.of(-1),
        npcIdleAnimFrameOffsetsBase: Int32Array.of(-1),
        npcIdleAnimFrameCountsBase: Int32Array.of(0),
        npcWalkAnimFrameOffsetsBase: Int32Array.of(-1),
        npcWalkAnimFrameCountsBase: Int32Array.of(0),
        npcAnimFramesBasePacked: new Int32Array(0),
        outNpcPatchesPacked: new Int32Array(4),
        npcIdleAnimFrameOffsetsAlpha: Int32Array.of(-1),
        npcIdleAnimFrameCountsAlpha: Int32Array.of(0),
        npcWalkAnimFrameOffsetsAlpha: Int32Array.of(-1),
        npcWalkAnimFrameCountsAlpha: Int32Array.of(0),
        npcAnimFramesAlphaPacked: Int32Array.of(-1, 0, 0),
        npcNullAlphaFrameOffset: 0,
        outNpcAlphaPatchesPacked: new Int32Array(4),
    };
}

function buildPathOnlyNpcPathPacked(): Int32Array {
    // version=1, npcCount=1, then: pathLength[1], pathX[10], pathY[10], pathMovementType[10]
    const out = new Int32Array(2 + 1 + 10 + 10 + 10);
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    // Move toward tile x=2, y=0 (target world x=320, y=64 for size=1)
    out[3] = 2;
    out[13] = 0;
    out[23] = 1;
    return out;
}

async function waitForBackendReady(timeoutMs = 10000): Promise<void> {
    ensureDrawRangePatchBackendInit();
    const start = Date.now();
    while (!isDrawRangePatchBackendReady()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("timed out waiting for draw-range patch backend init");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

async function main(): Promise<void> {
    await waitForBackendReady();

    const stateKey = 991337;
    const input = makeTickInputOneNpc();

    try {
        const registered = registerDrawRangeTickState(stateKey, input);
        assert.equal(registered, true, "failed to register initial tick state");

        const updated = updateDrawRangeTickStateNpcPathPacked(
            stateKey,
            buildPathOnlyNpcPathPacked(),
        );
        assert.equal(updated, true, "failed to apply path-only npc update");

        const beforeX = input.npcX[0] | 0;
        const beforePathLength = input.npcPathLength[0] | 0;
        for (let i = 0; i < 20; i++) {
            const tick = tickAdvanceAndEmitBasePatchesForState(stateKey, i * 1024, 1);
            assert.ok(tick, `tick failed at step ${i}`);
        }

        const afterX = input.npcX[0] | 0;
        const afterPathLength = input.npcPathLength[0] | 0;
        assert.ok(afterX > beforeX, `expected npc to move on x axis (${beforeX} -> ${afterX})`);
        assert.ok(
            afterPathLength <= beforePathLength,
            `expected path length not to grow (${beforePathLength} -> ${afterPathLength})`,
        );
        console.log("wasm-tick-npc-path-regression: ok");
    } finally {
        unregisterDrawRangeTickState(stateKey);
        resetDrawRangePatchBackend();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
