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
        npcRingWriteIndex: 0,
        npcGpuFrameData: makeNpcGpuData(),
        readyMapIdsPacked: new Int32Array([100, 200]),
        npcRangesByMapIdPacked: new Int32Array([100, 0, 0]),
        renderListPacked: new Int32Array([100, 0]),
        tickPatchCountsByMapId: makeTickCountsPacked([100]),
        tickPatchStreamsByMap: makeEmptyTickStreamsByMap(1),
    });
    const parsed = parseFramePacket(packet)!;
    assert.equal(parsed.readyMapIds.has(100), true);
    assert.equal(parsed.readyMapIds.has(200), true);
}

function testRenderMapMustBeReady(): void {
    assert.throws(
        () =>
            buildFramePacket({
                frameCount: 1,
                tickMapIdsVersion: 1,
                npcRingWriteIndex: 0,
                npcGpuFrameData: makeNpcGpuData(),
                readyMapIdsPacked: new Int32Array([200]),
                npcRangesByMapIdPacked: new Int32Array([100, 0, 0]),
                renderListPacked: new Int32Array([100, 0]),
                tickPatchCountsByMapId: makeTickCountsPacked([100]),
                tickPatchStreamsByMap: makeEmptyTickStreamsByMap(1),
            }),
        /render map missing from readyMapIdsPacked/,
    );
}

function testReadyMapSetMustBeSortedUnique(): void {
    assert.throws(
        () =>
            buildFramePacket({
                frameCount: 1,
                tickMapIdsVersion: 1,
                npcRingWriteIndex: 0,
                npcGpuFrameData: makeNpcGpuData(),
                readyMapIdsPacked: new Int32Array([200, 100]),
                npcRangesByMapIdPacked: new Int32Array([100, 0, 0]),
                renderListPacked: new Int32Array([100, 0]),
                tickPatchCountsByMapId: makeTickCountsPacked([100]),
                tickPatchStreamsByMap: makeEmptyTickStreamsByMap(1),
            }),
        /readyMapIdsPacked must be unique sorted asc/,
    );
}

function testBuilderProducesSortedUniqueReadySet(): void {
    const emptyCounts = new Int32Array(TICK_PATCH_STREAM_COUNT);
    const emptyStreams = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
    const packet = buildFramePacketFromMapEntries({
        frameCount: 2,
        tickMapIdsVersion: 3,
        npcRingWriteIndex: 1,
        npcGpuFrameData: makeNpcGpuData(),
        entries: [
            {
                mapId: 200,
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

    assert.deepEqual(Array.from(packet.readyMapIdsPacked), [100, 200]);
}

async function main(): Promise<void> {
    testReadySupersetAccepted();
    testRenderMapMustBeReady();
    testReadyMapSetMustBeSortedUnique();
    testBuilderProducesSortedUniqueReadySet();
    console.log("frame-packet-ready-set-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
