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

export function getWindowObjSpawns(
    spawns: ObjSpawn[],
    maxLevel: number,
    baseX: number,
    baseY: number,
    sizeX: number,
    sizeY: number,
): ObjSpawn[] {
    const x0 = baseX | 0;
    const y0 = baseY | 0;
    const x1 = (baseX + sizeX) | 0;
    const y1 = (baseY + sizeY) | 0;
    return spawns.filter((obj) => {
        const x = obj.x | 0;
        const y = obj.y | 0;
        return obj.plane <= maxLevel && x >= x0 && x < x1 && y >= y0 && y < y1;
    });
}
