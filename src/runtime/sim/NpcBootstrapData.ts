import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import type { NpcTypeAnimationEntry } from "../contracts/NpcTypeAnimationTable";
import { type NpcData, createNpcDatasFromSpawns } from "../entities/NpcData";
import { orderByPacketKeys } from "../entities/orderByPacketKeys";
import type { NpcSpawnEvent } from "./NpcEvents";

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

function fnv1a32Update(hash: number, value: number): number {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
    return hash | 0;
}

function buildSyntheticNpcInstanceId(
    mapId: number,
    npcTypeId: number,
    tileX: number,
    tileY: number,
    level: number,
    index: number,
): number {
    let hash = 0x811c9dc5 | 0;
    hash = fnv1a32Update(hash, mapId | 0);
    hash = fnv1a32Update(hash, npcTypeId | 0);
    hash = fnv1a32Update(hash, tileX | 0);
    hash = fnv1a32Update(hash, tileY | 0);
    hash = fnv1a32Update(hash, level | 0);
    hash = fnv1a32Update(hash, index | 0);
    return hash | 0;
}

export function createNpcBootstrapData(input: NpcBootstrapInput): NpcBootstrapData {
    const ordered = orderByPacketKeys(input.npcsIn, input.npcOrderKeys);
    const spawnEvents = new Array<NpcSpawnEvent>(ordered.length | 0);
    for (let i = 0; i < ordered.length; i++) {
        const npc = ordered[i]!;
        const mapId = input.mapId | 0;
        const npcTypeId = npc.id | 0;
        const tileX = npc.tileX | 0;
        const tileY = npc.tileY | 0;
        const level = npc.level | 0;
        spawnEvents[i] = {
            kind: "spawn",
            mapId,
            npcInstanceId:
                npc.orderKey ??
                buildSyntheticNpcInstanceId(mapId, npcTypeId, tileX, tileY, level, i),
            npcTypeId,
            tileX,
            tileY,
            level,
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
    npcOrderKeys?: Int32Array,
): NpcBootstrapData {
    return createNpcBootstrapData({
        mapId: mapId | 0,
        npcsIn: createNpcDatasFromSpawns(Array.from(spawns)),
        npcOrderKeys,
    });
}
