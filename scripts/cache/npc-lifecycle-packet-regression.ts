import assert from "node:assert/strict";

import { MovementType } from "../../src/runtime/entities/Npc";
import type { NpcEvent } from "../../src/runtime/sim/NpcEvents";
import {
    decodeNpcLifecyclePacket,
    encodeNpcLifecyclePacketFromEvents,
} from "../../src/runtime/sim/NpcUpdatePacket";

function testRoundtrip(): void {
    const events: NpcEvent[] = [
        {
            kind: "spawn",
            mapId: 12850,
            npcInstanceId: 1001,
            npcTypeId: 81,
            tileX: 3200,
            tileY: 3201,
            level: 0,
            orderKey: 777,
        },
        {
            kind: "update",
            mapId: 12850,
            npcInstanceId: 1001,
            seq: 11,
            delta: {
                snapTileX: 3202,
                snapTileY: 3203,
                snapWorldX: 4096,
                snapWorldY: 4128,
                orientation: 1024,
                rotation: 512,
                path: {
                    length: 2,
                    pathX: Int32Array.from([3202, 3203]),
                    pathY: Int32Array.from([3203, 3204]),
                    pathMovementType: Int32Array.from([MovementType.WALK, MovementType.RUN]),
                },
            },
        },
        {
            kind: "despawn",
            mapId: 12850,
            npcInstanceId: 1001,
            seq: 12,
        },
        {
            kind: "spawn",
            mapId: 12851,
            npcInstanceId: 2001,
            npcTypeId: 82,
            tileX: 3210,
            tileY: 3211,
            level: 1,
            orderKey: undefined,
        },
        {
            kind: "update",
            mapId: 12851,
            npcInstanceId: 2001,
            seq: 21,
            delta: {
                clearServerPath: true,
                orientation: 1536,
            },
        },
    ];

    const encoded = encodeNpcLifecyclePacketFromEvents(events);
    const decoded = decodeNpcLifecyclePacket(encoded);
    assert.equal(decoded.version, 2);
    assert.equal(decoded.eventCount, events.length);

    const decodedMapA = decoded.lifecycleEventsByMapId.get(12850);
    const decodedMapB = decoded.lifecycleEventsByMapId.get(12851);
    assert.ok(decodedMapA);
    assert.ok(decodedMapB);
    assert.deepEqual(decodedMapA, events.slice(0, 3));
    assert.deepEqual(decodedMapB, events.slice(3));
}

async function main(): Promise<void> {
    testRoundtrip();
    console.log("npc-lifecycle-packet-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
