import { CacheInfo, GameType } from "../../rs/cache/CacheInfo";

const npcSpawns2004Url = new URL("./npc-spawns-2004.json", import.meta.url).href;
const npcSpawns2009Url = new URL("./npc-spawns-2009.json", import.meta.url).href;
const npcSpawnsOsrsUrl = new URL("./npc-spawns-osrs.json", import.meta.url).href;

export interface NpcSpawn {
    id: number;
    name?: string;
    x: number;
    y: number;
    level: number;
}

export function getNpcSpawnsUrl(cacheInfo: CacheInfo): string {
    if (cacheInfo.game === GameType.Oldschool) {
        return npcSpawnsOsrsUrl;
    } else if (cacheInfo.revision > 474) {
        return npcSpawns2009Url;
    } else {
        return npcSpawns2004Url;
    }
}

export async function fetchNpcSpawns(url: string): Promise<NpcSpawn[]> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `[map-render][npc-spawns] fetch failed status=${response.status} url=${url}`,
        );
    }
    const json = await response.json();
    if (!Array.isArray(json)) {
        throw new Error(`[map-render][npc-spawns] invalid json (expected array) url=${url}`);
    }
    return json as NpcSpawn[];
}

export function fetchOsrsNpcSpawns(): Promise<NpcSpawn[]> {
    return fetchNpcSpawns(npcSpawnsOsrsUrl);
}

export function fetchLegacyNpcSpawns(): Promise<NpcSpawn[]> {
    return fetchNpcSpawns(npcSpawns2004Url);
}

export function getMapNpcSpawns(
    spawns: NpcSpawn[],
    maxLevel: number,
    mapX: number,
    mapY: number,
): NpcSpawn[] {
    return spawns.filter((obj) => {
        const npcMapX = (obj.x / 64) | 0;
        const npcMapY = (obj.y / 64) | 0;
        return mapX === npcMapX && mapY === npcMapY && obj.level <= maxLevel;
    });
}
