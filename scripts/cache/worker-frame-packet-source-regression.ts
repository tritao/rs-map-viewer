import assert from "node:assert/strict";

import { buildFramePacket, type FramePacket } from "../../src/runtime/contracts/FramePacket";
import { WorkerMapViewerFramePacketSource } from "../../src/mapviewer/MapViewerFramePacketSource";

function makePacket(
    frameCount: number,
    tickMapIdsVersion: number,
    tickViewStateVersion: number,
): FramePacket {
    return buildFramePacket({
        frameCount: frameCount | 0,
        tickMapIdsVersion: tickMapIdsVersion | 0,
        tickViewStateVersion: tickViewStateVersion | 0,
        npcRingWriteIndex: 0,
        npcGpuFrameData: { data: new Uint16Array(4), width: 1, height: 1 },
        npcRangesByMapIdPacked: new Int32Array(0),
        renderListPacked: new Int32Array(0),
        tickPatchCountsByMapId: new Int32Array(0),
        tickPatchStreamsByMap: [],
    });
}

async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function testMapChangeTriggersTickWithZeroElapsed(): Promise<void> {
    const visibleMaps = [{ mapId: 13106 }] as unknown as { mapId: number }[];
    const mapManager = {
        visibleMapCount: 1,
        visibleMaps,
    };
    const camera = {
        getMapX: () => 50,
        getMapY: () => 50,
    };
    let tickMapIdsVersion = 0;
    let tickViewStateVersion = 0;
    let tickSimCalls = 0;
    let buildFramePacketCalls = 0;
    let setTickMapCalls = 0;
    const simWorkerPool = {
        setTickMapIds: async (_mapIds: Int32Array) => {
            setTickMapCalls = (setTickMapCalls + 1) | 0;
            tickMapIdsVersion = (tickMapIdsVersion + 1) | 0;
        },
        setTickViewState: async (_x: number, _y: number, _lod: number) => {
            tickViewStateVersion = (tickViewStateVersion + 1) | 0;
        },
        setTickHoveredMapIds: async (_hovered: Int32Array) => {},
        tickSim: async (
            frameCount: number,
            _ticksElapsed: number,
            _clientTicksElapsed: number,
            _cycle: number,
            _hovered: Int32Array,
        ) => {
            tickSimCalls = (tickSimCalls + 1) | 0;
            return {
                frameCount: frameCount | 0,
                tickMapIdsVersion: tickMapIdsVersion | 0,
                tickViewStateVersion: tickViewStateVersion | 0,
                eventCount: 0,
                spawnsPacked: new Int32Array(0),
                updatesPacked: new Int32Array(0),
                despawnsPacked: new Int32Array(0),
            };
        },
    };
    const renderWorkerPool = {
        setFrameTickMapIds: async (_mapIds: Int32Array) => {},
        setFrameTickViewState: async (_x: number, _y: number, _lod: number) => {},
        setFrameTickHoveredMapIds: async (_hovered: Int32Array) => {},
        applyNpcStateDeltaPacket: async (_packet: unknown) => 0,
        buildFramePacketFromRenderState: async (frameCount: number, _cycle: number) => {
            buildFramePacketCalls = (buildFramePacketCalls + 1) | 0;
            return makePacket(frameCount | 0, tickMapIdsVersion | 0, tickViewStateVersion | 0);
        },
    };
    const source = new WorkerMapViewerFramePacketSource({
        simWorkerPool: simWorkerPool as any,
        renderWorkerPool: renderWorkerPool as any,
        getLodDistance: () => 4,
        getHoveredMapIdsPacked: () => new Int32Array(0),
        isSeamTelemetryEnabled: () => false,
        getMapManager: () => mapManager as any,
        getCamera: () => camera as any,
    });

    source.nextPacket({ frameCount: 1, cycle: 0, ticksElapsed: 0, clientTicksElapsed: 0 });
    await flushAsync();
    source.nextPacket({ frameCount: 1, cycle: 0, ticksElapsed: 0, clientTicksElapsed: 0 });
    assert.equal(tickSimCalls, 1);
    assert.equal(buildFramePacketCalls, 1);
    assert.equal(setTickMapCalls, 1);

    visibleMaps[0]!.mapId = 13107;
    source.nextPacket({ frameCount: 2, cycle: 0, ticksElapsed: 0, clientTicksElapsed: 0 });
    await flushAsync();
    source.nextPacket({ frameCount: 2, cycle: 0, ticksElapsed: 0, clientTicksElapsed: 0 });
    assert.equal(tickSimCalls, 2);
    assert.equal(buildFramePacketCalls, 2);
    assert.equal(setTickMapCalls, 2);
}

async function testStaleViewVersionPacketIsDropped(): Promise<void> {
    const mapManager = {
        visibleMapCount: 1,
        visibleMaps: [{ mapId: 13106 }],
    };
    let cameraMapX = 50;
    const camera = {
        getMapX: () => cameraMapX | 0,
        getMapY: () => 50,
    };
    let tickMapIdsVersion = 0;
    let tickViewStateVersion = 0;
    let staleViewOnce = true;
    const simWorkerPool = {
        setTickMapIds: async (_mapIds: Int32Array) => {
            tickMapIdsVersion = (tickMapIdsVersion + 1) | 0;
        },
        setTickViewState: async (_x: number, _y: number, _lod: number) => {
            tickViewStateVersion = (tickViewStateVersion + 1) | 0;
        },
        setTickHoveredMapIds: async (_hovered: Int32Array) => {},
        tickSim: async (
            frameCount: number,
            _ticksElapsed: number,
            _clientTicksElapsed: number,
            _cycle: number,
            _hovered: Int32Array,
        ) => {
            return {
                frameCount: frameCount | 0,
                tickMapIdsVersion: tickMapIdsVersion | 0,
                tickViewStateVersion: tickViewStateVersion | 0,
                eventCount: 0,
                spawnsPacked: new Int32Array(0),
                updatesPacked: new Int32Array(0),
                despawnsPacked: new Int32Array(0),
            };
        },
    };
    const renderWorkerPool = {
        setFrameTickMapIds: async (_mapIds: Int32Array) => {},
        setFrameTickViewState: async (_x: number, _y: number, _lod: number) => {},
        setFrameTickHoveredMapIds: async (_hovered: Int32Array) => {},
        applyNpcStateDeltaPacket: async (_packet: unknown) => 0,
        buildFramePacketFromRenderState: async (frameCount: number, _cycle: number) => {
            const shouldEmitStale = staleViewOnce && (frameCount | 0) >= 2;
            const packetViewVersion = shouldEmitStale
                ? ((tickViewStateVersion - 1) | 0)
                : (tickViewStateVersion | 0);
            if (shouldEmitStale) {
                staleViewOnce = false;
            }
            return makePacket(frameCount | 0, tickMapIdsVersion | 0, packetViewVersion | 0);
        },
    };
    const source = new WorkerMapViewerFramePacketSource({
        simWorkerPool: simWorkerPool as any,
        renderWorkerPool: renderWorkerPool as any,
        getLodDistance: () => 4,
        getHoveredMapIdsPacked: () => new Int32Array(0),
        isSeamTelemetryEnabled: () => false,
        getMapManager: () => mapManager as any,
        getCamera: () => camera as any,
    });

    source.nextPacket({ frameCount: 1, cycle: 0, ticksElapsed: 0, clientTicksElapsed: 0 });
    await flushAsync();
    const firstPacket = source.nextPacket({
        frameCount: 1,
        cycle: 0,
        ticksElapsed: 0,
        clientTicksElapsed: 0,
    });
    assert.ok(firstPacket);

    cameraMapX = 51;
    source.nextPacket({ frameCount: 2, cycle: 0, ticksElapsed: 0, clientTicksElapsed: 0 });
    await flushAsync();
    const staleDropped = source.nextPacket({
        frameCount: 2,
        cycle: 0,
        ticksElapsed: 0,
        clientTicksElapsed: 0,
    });
    assert.equal(staleDropped, undefined);
}

async function main(): Promise<void> {
    await testMapChangeTriggersTickWithZeroElapsed();
    await testStaleViewVersionPacketIsDropped();
    console.log("worker-frame-packet-source-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
