import assert from "node:assert/strict";

import { TICK_PATCH_STREAM_COUNT } from "../../src/runtime/contracts/FramePacket";
import { applyNpcMovementStep } from "../../src/runtime/sim/NpcSimMovement";
import type { NpcSimMapState } from "../../src/runtime/sim/NpcSimStateStore";
import {
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "../../src/runtime/sim/TickPatchStreamsBuilder";

function makeCountsForOneMap(mapId: number): Int32Array {
    const out = new Int32Array(1 + TICK_PATCH_STREAM_COUNT);
    out[0] = mapId | 0;
    return out;
}

function testReadWasmPatchStreamsForMap(): void {
    const mapId = 13106;
    const counts = makeCountsForOneMap(mapId);
    counts[1 + 0] = 1;
    counts[1 + 2] = 1;
    const packed = new Int32Array([10, 20, 30, 40, 50, 60, 70, 80]);

    const ok = readWasmPatchStreamsForMap(mapId, 0, 0, counts, packed);
    assert.equal(ok.hasWasmCountsForMap, true);
    assert.equal(ok.useWasmLocStreams, true);
    assert.equal(ok.nextReadOff, 8);
    assert.deepEqual(Array.from(ok.streamsForMap[0] ?? []), [10, 20, 30, 40]);
    assert.deepEqual(Array.from(ok.streamsForMap[2] ?? []), [50, 60, 70, 80]);

    const mismatchMap = readWasmPatchStreamsForMap(mapId + 1, 0, 0, counts, packed);
    assert.equal(mismatchMap.hasWasmCountsForMap, true);
    assert.equal(mismatchMap.useWasmLocStreams, false);
    assert.equal(mismatchMap.nextReadOff, 8);
    assert.equal(mismatchMap.streamsForMap[0], undefined);
    assert.equal(mismatchMap.streamsForMap[2], undefined);

    assert.throws(
        () => readWasmPatchStreamsForMap(mapId, 0, 0, counts, new Int32Array(4)),
        /wasm patch stream OOB/,
    );
}

function makeTestState(): NpcSimMapState {
    let serverPathChecks = 0;
    let transformMoves = 0;
    let seqMoves = 0;
    let flagsSet = 0;
    let queuedPaths = 0;

    const npc = {
        orderKey: 0,
        level: 0,
        spawnX: 3,
        spawnY: 4,
        x: 3 * 128,
        y: 4 * 128,
        orientation: 0,
        rotation: 0,
        pathX: [3],
        pathY: [4],
        pathLength: 0,
        pathMovementType: [0],
        serverPathX: new Array<number>(25).fill(0),
        serverPathY: new Array<number>(25).fill(0),
        serverPathMovementType: new Array<number>(25).fill(0),
        serverPathLength: 0,
        canWalk: () => {
            serverPathChecks++;
            return false;
        },
        queuePath: () => {
            queuedPaths++;
        },
        getSize: () => 1,
        movementFrame: 0,
        getAnimationFrames: () => ({
            frames: [[30, 31, 1]],
            framesAlpha: [[40, 41, 1]],
        }),
        updateMovementTransformOnly: () => {
            transformMoves++;
        },
        updateMovementSeq: () => {
            seqMoves++;
        },
        debugCounts: () => ({
            serverPathChecks,
            transformMoves,
            seqMoves,
            flagsSet,
            queuedPaths,
        }),
    };

    const loc = {
        frame: 0,
        update: () => {
            // Keep frame deterministic for test.
        },
        anim: {
            frames: [[10, 11, 1]],
            framesAlpha: [[20, 21, 1]],
        },
        drawRangeIndex: 0,
        drawRangeAlphaIndex: 1,
        drawRangeLodIndex: 2,
        drawRangeLodAlphaIndex: 3,
        drawRangeInteractIndex: 4,
        drawRangeInteractAlphaIndex: 5,
        drawRangeInteractLodIndex: 6,
        drawRangeInteractLodAlphaIndex: 7,
    };

    return {
        borderSize: 0,
        tileRenderFlagsLevel1: [],
        collisionMaps: [
            {
                flag: () => {
                    flagsSet++;
                },
            } as any,
        ],
        seededNpcFlags: false,
        npcs: [npc as any],
        npcIndexByInstanceId: new Map<number, number>(),
        npcIndexByOrderKey: new Map(),
        lastSeqByInstanceId: new Map<number, number>(),
        npcTypeAnimationByNpcTypeId: new Map<number, any>(),
        locsAnimated: [loc as any],
        locTickPatchesByVariant: Array.from({ length: 8 }, () => new Int32Array(4)),
        locTickPatchCountsByVariant: new Int32Array(8),
        npcTickPatchesByVariant: [new Int32Array(4), new Int32Array(4)],
        npcTickPatchCountsByVariant: new Int32Array(2),
        nextSyntheticOrderKey: -1,
    };
}

function testApplyNpcMovementStep(): void {
    const state = makeTestState();
    const pathfinder = {} as any;

    applyNpcMovementStep(state, pathfinder, 2, 3, {} as any, {} as any);
    let counts = (state.npcs[0] as any).debugCounts();
    assert.equal(state.seededNpcFlags, true);
    assert.equal(counts.flagsSet, 1);
    assert.equal(counts.serverPathChecks, 2);
    assert.equal(counts.transformMoves, 3);
    assert.equal(counts.seqMoves, 3);
    assert.equal(counts.queuedPaths, 0);

    applyNpcMovementStep(state, pathfinder, 1, 1, {} as any, {} as any);
    counts = (state.npcs[0] as any).debugCounts();
    assert.equal(counts.flagsSet, 1, "collision flags should seed only once");
    assert.equal(counts.serverPathChecks, 3);
    assert.equal(counts.transformMoves, 4);
    assert.equal(counts.seqMoves, 4);
    assert.equal(counts.queuedPaths, 0);
}

function testBuildTickPatchStreamsForMap(): void {
    const state = makeTestState();

    const tsOnly = buildTickPatchStreamsForMap({
        mapId: 13106,
        mapEntryIndex: 0,
        cycleNow: 0,
        state,
        seqFrameLoader: {} as any,
        includeTsLocTickPatches: true,
        useWasmLocStreams: false,
        hasWasmCountsForMap: false,
        wasmLocStreamsForMap: new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT),
        wasmCountsByMapId: undefined,
    });

    for (let i = 0; i < 8; i++) {
        assert.equal(tsOnly.streamCounts[i], 1);
    }
    assert.equal(tsOnly.streamCounts[8], 1);
    assert.equal(tsOnly.streamCounts[9], 1);
    assert.equal(tsOnly.streamsForMap[0], state.locTickPatchesByVariant[0]);
    assert.equal(tsOnly.streamsForMap[8], state.npcTickPatchesByVariant[0]);

    const wasmCounts = makeCountsForOneMap(13106);
    for (let i = 0; i < 8; i++) {
        wasmCounts[1 + i] = 2;
    }
    const wasmStreams = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
    for (let i = 0; i < 8; i++) {
        wasmStreams[i] = new Int32Array([i, i, i, i]);
    }
    const withWasm = buildTickPatchStreamsForMap({
        mapId: 13106,
        mapEntryIndex: 0,
        cycleNow: 0,
        state,
        seqFrameLoader: {} as any,
        includeTsLocTickPatches: false,
        useWasmLocStreams: true,
        hasWasmCountsForMap: true,
        wasmLocStreamsForMap: wasmStreams,
        wasmCountsByMapId: wasmCounts,
    });

    for (let i = 0; i < 8; i++) {
        assert.equal(withWasm.streamCounts[i], 2);
        assert.equal(withWasm.streamsForMap[i], wasmStreams[i]);
    }
    assert.equal(withWasm.streamCounts[8], 1);
    assert.equal(withWasm.streamCounts[9], 1);
    assert.equal(withWasm.streamsForMap[8], state.npcTickPatchesByVariant[0]);
}

async function main(): Promise<void> {
    testReadWasmPatchStreamsForMap();
    testApplyNpcMovementStep();
    testBuildTickPatchStreamsForMap();
    console.log("worker-tick-frame-helpers-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
