import assert from "node:assert/strict";

import type { RenderDataResult } from "../../src/maprender/MapRenderBackend";
import type { SdMapData } from "../../src/maprender/MapRenderPayload";
import {
    buildNpcStateDeltaPacketFromEvents,
    decodeNpcStateDeltaPacketEvents,
} from "../../src/runtime/contracts/NpcStateDeltaPacket";
import {
    encodeNpcLifecyclePacketFromEvents,
} from "../../src/runtime/contracts/NpcLifecyclePacket";
import type { NpcTypeAnimationEntry } from "../../src/runtime/contracts/NpcTypeAnimationTable";
import type { NpcEvent } from "../../src/runtime/sim/NpcEvents";
import { WorkerFramePacketRuntime } from "../../src/worker/tick/WorkerFramePacketRuntime";
import { WorkerTickRuntime } from "../../src/worker/tick/WorkerTickRuntime";

function createFakeWorkerState() {
    const fakeNpcType = {
        id: 9001,
        size: 1,
        spawnDirection: 0,
        isClickable: true,
        rotationSpeed: 32,
        loginScreenProps: 0,
        cacheInfo: { revision: 667 },
        getIdleSeqId: () => 111,
        getWalkSeqId: () => -1,
    };
    const fakeSeqType = {
        frameIds: [0, 1],
        frameStep: 0,
        looping: false,
        maxLoops: 0,
        hasAnimMayaSeq: () => false,
        getAnimMayaDuration: () => 2,
        getFrameLength: () => 0,
    };
    return {
        session: {
            loaders: {
                npcTypeLoader: {
                    tryLoad: () => ({ ok: true, value: fakeNpcType }),
                },
                basTypeLoader: {},
                seqTypeLoader: {
                    tryLoad: () => ({ ok: true, value: fakeSeqType }),
                },
                seqFrameLoader: {},
            },
        },
        mapBytesProvider: {},
        sceneBuilder: {},
        mapRenderBackend: {
            kind: "ts",
            async buildMapData(): Promise<RenderDataResult<SdMapData | undefined>> {
                return { data: undefined, transferables: [] };
            },
            reset(): void {},
        },
    } as any;
}

function registerSimMapState(
    runtime: WorkerTickRuntime,
    workerState: any,
    mapId: number,
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
): void {
    const store = (runtime as any).npcSimStateStore;
    store.registerMap(
        {
            mapId: mapId | 0,
            borderSize: 0,
            tileRenderFlagsLevel1: [],
            collisionDatas: [],
            locsAnimated: [],
            npcTypeAnimationTable,
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

async function main(): Promise<void> {
    const workerState = createFakeWorkerState();
    const simRuntime = new WorkerTickRuntime(async () => workerState);
    const frameRuntime = new WorkerFramePacketRuntime(async () => workerState);

    const mapId = 13106;
    const npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry> = [
        {
            npcTypeId: 9001,
            idleAnim: {
                frames: [
                    [11, 22, 1],
                    [33, 44, 1],
                ],
                framesAlpha: undefined,
            },
        },
    ];

    registerSimMapState(simRuntime, workerState, mapId, npcTypeAnimationTable);
    await frameRuntime.registerMapNpcRenderState(
        mapId,
        0,
        [],
        [],
        npcTypeAnimationTable,
    );
    simRuntime.setTickMapIds(Int32Array.from([mapId]));
    simRuntime.setTickViewState(50, 50, 2);
    frameRuntime.setTickMapIds(Int32Array.from([mapId]));
    frameRuntime.setTickViewState(50, 50, 2);

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
    await simRuntime.applyNpcLifecyclePacketBytes(encodePacket(spawnEvents));
    await frameRuntime.applyNpcStateDeltaPacket(
        buildNpcStateDeltaPacketFromEvents({
            frameCount: 0,
            tickMapIdsVersion: 1,
            tickViewStateVersion: 1,
            events: spawnEvents,
        }),
    );

    const baselinePacket = await frameRuntime.buildFramePacketFromCurrentState(1, 0);
    assert.ok(baselinePacket, "expected baseline packet");

    // Prime sim snapshot map first.
    await simRuntime.tickSim(1, 0, 0, 0, new Int32Array(0));
    const deltaPacket = await simRuntime.tickSim(2, 0, 1, 0, new Int32Array(0));
    assert.ok(deltaPacket, "expected animation delta packet");
    assert.ok((deltaPacket.eventCount | 0) > 0, "expected at least one npc update event");

    const decodedEventsByMap = decodeNpcStateDeltaPacketEvents(deltaPacket);
    const mapEvents = decodedEventsByMap.get(mapId) ?? [];
    const updateEvent = mapEvents.find((event) => event.kind === "update");
    assert.ok(updateEvent, "expected update event for animation-only delta");
    if (updateEvent?.kind === "update") {
        assert.notEqual(updateEvent.delta.movementFrame, undefined);
        assert.notEqual(updateEvent.delta.movementFrameTick, undefined);
    }

    await assert.rejects(
        frameRuntime.applyNpcStateDeltaPacket({
            ...deltaPacket,
            eventCount: ((deltaPacket.eventCount | 0) + 1) | 0,
        }),
        /invalid eventCount/,
    );

    await frameRuntime.applyNpcStateDeltaPacket(deltaPacket);
    const updatedPacket = await frameRuntime.buildFramePacketFromCurrentState(2, 0);
    assert.ok(updatedPacket, "expected updated packet");

    assert.notDeepEqual(
        Array.from(updatedPacket.tickPatchPacked),
        Array.from(baselinePacket.tickPatchPacked),
        "animation-only delta must change tick patch stream output",
    );

    console.log("worker-npc-animation-delta-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
