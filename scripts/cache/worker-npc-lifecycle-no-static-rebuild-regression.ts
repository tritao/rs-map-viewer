import assert from "node:assert/strict";

import type { RenderDataResult } from "../../src/maprender/MapRenderBackend";
import type { SdMapData } from "../../src/maprender/MapRenderPayload";
import { parseFramePacket } from "../../src/runtime/contracts/FramePacket";
import {
    encodeNpcLifecyclePacketFromEvents,
} from "../../src/runtime/contracts/NpcLifecyclePacket";
import type { NpcEvent } from "../../src/runtime/sim/NpcEvents";
import { WorkerTickRuntime } from "../../src/worker/tick/WorkerTickRuntime";

function createFakeWorkerState(staticBuildCounterRef: { count: number }) {
    const fakeNpcType = {
        id: 9001,
        size: 1,
        spawnDirection: 0,
        isClickable: true,
        rotationSpeed: 32,
        loginScreenProps: 0,
        cacheInfo: { revision: 667 },
        getIdleSeqId: () => -1,
        getWalkSeqId: () => -1,
    };

    return {
        session: {
            loaders: {
                npcTypeLoader: {
                    tryLoad: () => ({ ok: true, value: fakeNpcType }),
                },
                basTypeLoader: {},
                seqTypeLoader: {
                    tryLoad: () => ({ ok: false }),
                },
                seqFrameLoader: {},
            },
        },
        mapBytesProvider: {},
        sceneBuilder: {},
        mapRenderBackend: {
            kind: "ts",
            async buildMapData(): Promise<RenderDataResult<SdMapData | undefined>> {
                staticBuildCounterRef.count = (staticBuildCounterRef.count + 1) | 0;
                return { data: undefined, transferables: [] };
            },
            reset(): void {},
        },
    } as any;
}

function registerEmptyMapState(runtime: WorkerTickRuntime, workerState: any, mapId: number): void {
    const store = (runtime as any).npcSimStateStore;
    store.registerMap(
        {
            mapId: mapId | 0,
            borderSize: 0,
            tileRenderFlagsLevel1: [],
            collisionDatas: [],
            locsAnimated: [],
            npcTypeAnimationTable: [],
        },
        {
            npcTypeLoader: workerState.session.loaders.npcTypeLoader,
            basTypeLoader: workerState.session.loaders.basTypeLoader,
            seqTypeLoader: workerState.session.loaders.seqTypeLoader,
            tickPatchEntryStride: 4,
        },
    );
}

function encodePacket(events: NpcEvent[]): Uint8Array {
    const bytes = encodeNpcLifecyclePacketFromEvents(events);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function getNpcCountForMap(packet: unknown, mapId: number): number {
    const parsed = parseFramePacket(packet as any);
    const range = parsed?.npcRangesByMapId.get(mapId | 0);
    return range ? (range.count | 0) : 0;
}

function captureNpcSnapshot(runtime: WorkerTickRuntime, mapId: number): Readonly<{
    x: number;
    y: number;
    level: number;
    orientation: number;
    rotation: number;
    pathX0: number;
    pathY0: number;
    pathLength: number;
}> {
    const store = (runtime as any).npcSimStateStore;
    const state = store.getMap(mapId | 0);
    assert.ok(state, "expected map sim state");
    const npc = state.npcs[0];
    assert.ok(npc, "expected one npc instance");
    return {
        x: npc.x | 0,
        y: npc.y | 0,
        level: npc.level | 0,
        orientation: npc.orientation | 0,
        rotation: npc.rotation | 0,
        pathX0: npc.pathX[0] | 0,
        pathY0: npc.pathY[0] | 0,
        pathLength: npc.pathLength | 0,
    };
}

async function main(): Promise<void> {
    const staticBuildCounterRef = { count: 0 };
    const workerState = createFakeWorkerState(staticBuildCounterRef);
    const runtime = new WorkerTickRuntime(async () => workerState);

    const mapId = 13106;
    registerEmptyMapState(runtime, workerState, mapId);
    runtime.setTickMapIds(Int32Array.from([mapId]));
    runtime.setTickViewState(mapId >> 8, mapId & 0xff, 2);

    const spawnEvents: NpcEvent[] = [
        {
            kind: "spawn",
            mapId,
            npcInstanceId: 1001,
            npcTypeId: 9001,
            tileX: 10,
            tileY: 10,
            level: 0,
            orderKey: 2001,
        },
    ];
    await runtime.applyNpcLifecyclePacketBytes(encodePacket(spawnEvents));

    const packetAfterSpawn = await runtime.tickFrame(
        1,
        0,
        0,
        0,
        new Int32Array(0),
    );
    assert.ok(packetAfterSpawn, "expected frame packet after spawn");
    assert.equal(getNpcCountForMap(packetAfterSpawn, mapId), 1);
    assert.equal(staticBuildCounterRef.count | 0, 0);

    const beforePackOnly = captureNpcSnapshot(runtime, mapId);
    const packOnlyA = await runtime.buildFramePacketFromCurrentState(1, 0, new Int32Array(0));
    const packOnlyB = await runtime.buildFramePacketFromCurrentState(1, 0, new Int32Array(0));
    assert.ok(packOnlyA, "expected pack-only frame packet A");
    assert.ok(packOnlyB, "expected pack-only frame packet B");
    assert.deepEqual(
        Array.from(packOnlyA.npcGpuFrameData.data),
        Array.from(packOnlyB.npcGpuFrameData.data),
        "pack-only frame build must be deterministic for same frame input",
    );
    assert.deepEqual(
        captureNpcSnapshot(runtime, mapId),
        beforePackOnly,
        "pack-only frame build must not mutate npc sim state",
    );

    const despawnEvents: NpcEvent[] = [
        {
            kind: "despawn",
            mapId,
            npcInstanceId: 1001,
            seq: 1,
        },
    ];
    await runtime.applyNpcLifecyclePacketBytes(encodePacket(despawnEvents));

    const packetAfterDespawn = await runtime.tickFrame(
        2,
        0,
        0,
        0,
        new Int32Array(0),
    );
    assert.ok(packetAfterDespawn, "expected frame packet after despawn");
    assert.equal(getNpcCountForMap(packetAfterDespawn, mapId), 0);
    assert.equal(staticBuildCounterRef.count | 0, 0);

    console.log("worker-npc-lifecycle-no-static-rebuild-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
