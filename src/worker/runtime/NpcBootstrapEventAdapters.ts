import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import { createNpcDatasFromSpawns, type NpcData } from "../../runtime/entities/NpcData";
import { orderByPacketKeys } from "../../runtime/entities/orderByPacketKeys";
import type { NpcBootstrapSpawnEvent } from "./NpcBootstrapEvent";

export type NpcBootstrapSpawnEventsInput = Readonly<{
    mapId: number;
    npcsIn: ReadonlyArray<NpcData>;
    npcOrderKeys?: Int32Array;
}>;

export function createNpcBootstrapSpawnEvents(
    input: NpcBootstrapSpawnEventsInput,
): NpcBootstrapSpawnEvent[] {
    const ordered = orderByPacketKeys(input.npcsIn, input.npcOrderKeys);
    const events = new Array<NpcBootstrapSpawnEvent>(ordered.length | 0);
    for (let i = 0; i < ordered.length; i++) {
        const npc = ordered[i]!;
        events[i] = {
            kind: "spawn",
            mapId: input.mapId | 0,
            npcTypeId: npc.id | 0,
            tileX: npc.tileX | 0,
            tileY: npc.tileY | 0,
            level: npc.level | 0,
            orderKey: npc.orderKey,
            idleAnim: npc.idleAnim,
            walkAnim: npc.walkAnim,
        };
    }
    return events;
}

export function createNpcBootstrapSpawnEventsFromSpawns(
    mapId: number,
    spawns: ReadonlyArray<NpcSpawn>,
): NpcBootstrapSpawnEvent[] {
    return createNpcBootstrapSpawnEvents({
        mapId: mapId | 0,
        npcsIn: createNpcDatasFromSpawns(Array.from(spawns)),
    });
}
