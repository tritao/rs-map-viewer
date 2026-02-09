const objSpawnsUrl = new URL("./obj-spawns.json", import.meta.url).href;

export interface ObjSpawn {
    id: number;
    count: number;
    x: number;
    y: number;
    plane: number;
}

export async function fetchObjSpawns(): Promise<ObjSpawn[]> {
    const response = await fetch(objSpawnsUrl);
    return await response.json();
}

export function getMapObjSpawns(
    spawns: ObjSpawn[],
    maxLevel: number,
    mapX: number,
    mapY: number,
): ObjSpawn[] {
    return spawns.filter((obj) => {
        const objMapX = (obj.x / 64) | 0;
        const objMapY = (obj.y / 64) | 0;
        return mapX === objMapX && mapY === objMapY && obj.plane <= maxLevel;
    });
}
