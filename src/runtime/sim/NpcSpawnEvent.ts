export type NpcSpawnEvent = Readonly<{
    kind: "spawn";
    mapId: number;
    npcTypeId: number;
    tileX: number;
    tileY: number;
    level: number;
    orderKey?: number;
}>;
