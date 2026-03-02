import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import { createNpcDatasFromSpawns, type NpcData } from "../../runtime/entities/NpcData";
import { orderByPacketKeys } from "../../runtime/entities/orderByPacketKeys";
import type { NpcSpawnEvent } from "../../runtime/sim/NpcEvents";
import type { NpcTypeAnimationEntry } from "../../runtime/contracts/NpcTypeAnimationTable";

type NpcBootstrapInput = Readonly<{
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

export function createNpcBootstrapData(input: NpcBootstrapInput): NpcBootstrapData {
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

export function createNpcBootstrapDataFromSpawns(
    mapId: number,
    spawns: ReadonlyArray<NpcSpawn>,
): NpcBootstrapData {
    return createNpcBootstrapData({
        mapId: mapId | 0,
        npcsIn: createNpcDatasFromSpawns(Array.from(spawns)),
    });
}
