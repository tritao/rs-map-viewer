import type { WorldRuntimeContentAdapter } from "../core/runtime/WorldRuntimeContentAdapter";
import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { MapRenderBackend, MapRenderBackendKind } from "../maprender/MapRenderBackend";

export type WorkerState = {
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
    runtimeAdapter: WorldRuntimeContentAdapter;
    mapRenderBackend: MapRenderBackend;
    mapImageCache: Cache;
};

export type WorkerRuntimeOptions = Readonly<{
    mapRenderBackend?: MapRenderBackendKind;
    mapRenderTelemetry?: boolean;
}>;

export type WorkerSpawnBootstrap = Readonly<{
    objSpawns: ObjSpawn[];
    fallbackNpcSpawns: NpcSpawn[];
}>;
