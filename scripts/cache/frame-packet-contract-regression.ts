import assert from "node:assert/strict";

import {
    TICK_PATCH_STREAM_COUNT,
    buildFramePacket,
    parseFramePacket,
} from "../../src/runtime/contracts/FramePacket";
import { buildFramePacketFromMapEntries } from "../../src/runtime/contracts/FramePacketBuilder";

function makeTickCountsPacked(mapIds: readonly number[]): Int32Array {
    const stride = 1 + TICK_PATCH_STREAM_COUNT;
    const out = new Int32Array((mapIds.length | 0) * stride);
    for (let i = 0; i < mapIds.length; i++) {
        out[(i * stride) | 0] = mapIds[i] | 0;
    }
    return out;
}

function makeEmptyTickStreamsByMap(mapCount: number): (Int32Array | undefined)[][] {
    const out = new Array<(Int32Array | undefined)[]>(mapCount | 0);
    for (let i = 0; i < mapCount; i++) {
        out[i] = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
    }
    return out;
}

function makeNpcGpuData(): Readonly<{ data: Uint16Array; width: number; height: number }> {
    const width = 8;
    const height = 1;
    return {
        data: new Uint16Array(width * height * 4),
        width,
        height,
    };
}

function testReadySupersetAccepted(): void {
    const packet = buildFramePacket({
        frameCount: 1,
        tickMapIdsVersion: 1,
        tickViewStateVersion: 1,
        npcRingWriteIndex: 0,
        npcGpuFrameData: makeNpcGpuData(),
        npcRangesByMapIdPacked: new Int32Array([100, 0, 0]),
        renderListPacked: new Int32Array([100, 0]),
        tickPatchCountsByMapId: makeTickCountsPacked([100]),
        tickPatchStreamsByMap: makeEmptyTickStreamsByMap(1),
    });
    const parsed = parseFramePacket(packet)!;
    assert.deepEqual(Array.from(parsed.renderListPacked), [100, 0]);
}

function testDuplicateRenderMapRejected(): void {
    assert.throws(
        () =>
            buildFramePacket({
                frameCount: 1,
                tickMapIdsVersion: 1,
                tickViewStateVersion: 1,
                npcRingWriteIndex: 0,
                npcGpuFrameData: makeNpcGpuData(),
                npcRangesByMapIdPacked: new Int32Array([100, 0, 0, 100, 0, 0]),
                renderListPacked: new Int32Array([100, 0, 100, 0]),
                tickPatchCountsByMapId: makeTickCountsPacked([100, 100]),
                tickPatchStreamsByMap: makeEmptyTickStreamsByMap(2),
            }),
        /duplicate render map entry/,
    );
}

function testMapOrderMismatchRejected(): void {
    assert.throws(
        () =>
            buildFramePacket({
                frameCount: 1,
                tickMapIdsVersion: 1,
                tickViewStateVersion: 1,
                npcRingWriteIndex: 0,
                npcGpuFrameData: makeNpcGpuData(),
                npcRangesByMapIdPacked: new Int32Array([100, 0, 0]),
                renderListPacked: new Int32Array([100, 0]),
                tickPatchCountsByMapId: makeTickCountsPacked([200]),
                tickPatchStreamsByMap: makeEmptyTickStreamsByMap(1),
            }),
        /mapId order mismatch/,
    );
}

function testBuilderProducesAlignedMapEntries(): void {
    const emptyCounts = new Int32Array(TICK_PATCH_STREAM_COUNT);
    const emptyStreams = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
    const packet = buildFramePacketFromMapEntries({
        frameCount: 2,
        tickMapIdsVersion: 3,
        tickViewStateVersion: 4,
        npcRingWriteIndex: 1,
        npcGpuFrameData: makeNpcGpuData(),
        entries: [
            {
                mapId: 150,
                renderFlags: 0,
                npcRangeStart: 0,
                npcRangeCount: 0,
                tickPatchCounts: emptyCounts,
                tickPatchStreams: emptyStreams,
            },
            {
                mapId: 100,
                renderFlags: 0,
                npcRangeStart: 0,
                npcRangeCount: 0,
                tickPatchCounts: emptyCounts,
                tickPatchStreams: emptyStreams,
            },
            {
                mapId: 200,
                renderFlags: 0,
                npcRangeStart: 0,
                npcRangeCount: 0,
                tickPatchCounts: emptyCounts,
                tickPatchStreams: emptyStreams,
            },
        ],
    });

    assert.deepEqual(Array.from(packet.renderListPacked), [150, 0, 100, 0, 200, 0]);
    assert.deepEqual(Array.from(packet.npcRangesByMapIdPacked), [150, 0, 0, 100, 0, 0, 200, 0, 0]);
}

async function main(): Promise<void> {
    testReadySupersetAccepted();
    testDuplicateRenderMapRejected();
    testMapOrderMismatchRejected();
    testBuilderProducesAlignedMapEntries();
    console.log("frame-packet-contract-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
