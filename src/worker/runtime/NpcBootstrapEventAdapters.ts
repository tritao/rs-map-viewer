import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import { createNpcDatasFromSpawns, type NpcData } from "../../runtime/entities/NpcData";
import { orderByPacketKeys } from "../../runtime/entities/orderByPacketKeys";
import type { NpcSpawnEvent } from "../../runtime/sim/NpcSpawnEvent";
import type { NpcTypeAnimationEntry } from "../../runtime/sim/NpcTypeAnimationTable";

export type NpcBootstrapSpawnEventsInput = Readonly<{
    mapId: number;
    npcsIn: ReadonlyArray<NpcData>;
    npcOrderKeys?: Int32Array;
}>;

export type NpcBootstrapData = Readonly<{
    spawnEvents: NpcSpawnEvent[];
    npcTypeAnimationTable: NpcTypeAnimationEntry[];
}>;

function createNpcTypeAnimationTable(ordered: ReadonlyArray<NpcData>): NpcTypeAnimationEntry[] {
    const byTypeId = new Map<number, NpcTypeAnimationEntry>();
    for (let i = 0; i < ordered.length; i++) {
        const npc = ordered[i]!;
        const npcTypeId = npc.id | 0;
        if (!npc.idleAnim && !npc.walkAnim) {
            continue;
        }
        const existing = byTypeId.get(npcTypeId);
        if (!existing) {
            byTypeId.set(npcTypeId, {
                npcTypeId,
                idleAnim: npc.idleAnim,
                walkAnim: npc.walkAnim,
            });
            continue;
        }
        if (!existing.idleAnim && npc.idleAnim) {
            byTypeId.set(npcTypeId, {
                npcTypeId,
                idleAnim: npc.idleAnim,
                walkAnim: existing.walkAnim ?? npc.walkAnim,
            });
            continue;
        }
        if (!existing.walkAnim && npc.walkAnim) {
            byTypeId.set(npcTypeId, {
                npcTypeId,
                idleAnim: existing.idleAnim,
                walkAnim: npc.walkAnim,
            });
        }
    }
    return Array.from(byTypeId.values());
}

export function createNpcBootstrapData(input: NpcBootstrapSpawnEventsInput): NpcBootstrapData {
    const ordered = orderByPacketKeys(input.npcsIn, input.npcOrderKeys);
    const spawnEvents = new Array<NpcSpawnEvent>(ordered.length | 0);
    for (let i = 0; i < ordered.length; i++) {
        const npc = ordered[i]!;
        spawnEvents[i] = {
            kind: "spawn",
            mapId: input.mapId | 0,
            npcTypeId: npc.id | 0,
            tileX: npc.tileX | 0,
            tileY: npc.tileY | 0,
            level: npc.level | 0,
            orderKey: npc.orderKey,
        };
    }
    return {
        spawnEvents,
        npcTypeAnimationTable: createNpcTypeAnimationTable(ordered),
    };
}

export function createNpcBootstrapSpawnEvents(
    input: NpcBootstrapSpawnEventsInput,
): NpcSpawnEvent[] {
    return createNpcBootstrapData(input).spawnEvents;
}

export function createNpcBootstrapSpawnEventsFromSpawns(
    mapId: number,
    spawns: ReadonlyArray<NpcSpawn>,
): NpcSpawnEvent[] {
    return createNpcBootstrapDataFromSpawns(mapId, spawns).spawnEvents;
}

export function createNpcBootstrapDataFromSpawns(
    mapId: number,
    spawns: ReadonlyArray<NpcSpawn>,
): NpcBootstrapData {
    return createNpcBootstrapData({
        mapId: mapId | 0,
        npcsIn: createNpcDatasFromSpawns(Array.from(spawns)),
    });
}
