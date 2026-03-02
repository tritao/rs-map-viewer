import { NpcSpawn } from "../../data/npc/NpcSpawn";
import { AnimationFrames } from "../contracts/AnimationFrames";
import { NpcSpawnGroup } from "./NpcSpawnGroup";

export type NpcData = {
    id: number;
    tileX: number;
    tileY: number;
    level: number;
    idleAnim: AnimationFrames | undefined;
    walkAnim: AnimationFrames | undefined;
    orderKey?: number;
};

export function createNpcDatas(groups: NpcSpawnGroup[]): NpcData[] {
    const npcs: NpcData[] = [];
    const occurrenceByTuple = new Map<string, number>();

    for (const group of groups) {
        for (const spawn of group.spawns) {
            const key = spawnTupleKey(spawn);
            const occurrence = occurrenceByTuple.get(key) ?? 0;
            occurrenceByTuple.set(key, occurrence + 1);
            npcs.push(createNpcData(group, spawn, buildNpcOrderKey(spawn, occurrence)));
        }
    }

    return npcs;
}

export function createNpcData(group: NpcSpawnGroup, spawn: NpcSpawn, orderKey?: number): NpcData {
    const tileX = spawn.x % 64;
    const tileY = spawn.y % 64;
    const level = spawn.level;
    return {
        id: spawn.id,
        tileX,
        tileY,
        level,
        idleAnim: group.idleAnim,
        walkAnim: group.walkAnim,
        orderKey,
    };
}

function fnv1a32Update(hash: number, value: number): number {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
    return hash | 0;
}

function spawnTupleKey(spawn: NpcSpawn): string {
    return `${spawn.id}|${spawn.x}|${spawn.y}|${spawn.level}`;
}

export function buildNpcOrderKey(spawn: NpcSpawn, occurrence: number): number {
    let hash = 0x811c9dc5 | 0;
    hash = fnv1a32Update(hash, spawn.id | 0);
    hash = fnv1a32Update(hash, spawn.x | 0);
    hash = fnv1a32Update(hash, spawn.y | 0);
    hash = fnv1a32Update(hash, spawn.level | 0);
    hash = fnv1a32Update(hash, occurrence | 0);
    return hash | 0;
}

export function createNpcDatasFromSpawns(spawns: NpcSpawn[]): NpcData[] {
    const npcs: NpcData[] = [];
    const occurrenceByTuple = new Map<string, number>();

    for (const spawn of spawns) {
        const key = spawnTupleKey(spawn);
        const occurrence = occurrenceByTuple.get(key) ?? 0;
        occurrenceByTuple.set(key, occurrence + 1);

        npcs.push({
            id: spawn.id,
            tileX: spawn.x % 64,
            tileY: spawn.y % 64,
            level: spawn.level,
            idleAnim: undefined,
            walkAnim: undefined,
            orderKey: buildNpcOrderKey(spawn, occurrence),
        });
    }

    return npcs;
}
