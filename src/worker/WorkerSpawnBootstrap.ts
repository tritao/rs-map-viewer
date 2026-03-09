import { fetchNpcSpawns, getNpcSpawnsUrl } from "../data/npc/NpcSpawn";
import { fetchObjSpawns } from "../data/obj/ObjSpawn";
import type { LoadedCache } from "../util/Caches";
import type { WorkerSpawnBootstrap } from "./WorkerBuildTypes";

const workerSpawnBootstrapByCacheKey = new Map<string, Promise<WorkerSpawnBootstrap>>();

function getCacheKey(cache: LoadedCache): string {
    const info = cache.info;
    return `${info.game}:${info.revision}:${info.name}`;
}

export function ensureWorkerSpawnBootstrap(cache: LoadedCache): Promise<WorkerSpawnBootstrap> {
    const cacheKey = getCacheKey(cache);
    const cached = workerSpawnBootstrapByCacheKey.get(cacheKey);
    if (cached) {
        return cached;
    }

    const npcSpawnsUrl = getNpcSpawnsUrl(cache.info);
    const promise = Promise.all([
        fetchObjSpawns(),
        fetchNpcSpawns(npcSpawnsUrl).catch((error: unknown) => {
            console.error("[worker-bootstrap] failed to fetch fallback npc spawns", {
                cacheKey,
                npcSpawnsUrl,
                error,
            });
            return [];
        }),
    ]).then(([objSpawns, fallbackNpcSpawns]) => ({
        objSpawns,
        fallbackNpcSpawns,
    }));

    workerSpawnBootstrapByCacheKey.set(cacheKey, promise);
    return promise;
}
