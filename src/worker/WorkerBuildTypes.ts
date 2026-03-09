import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { MapRenderBackend, MapRenderBackendKind } from "../maprender/MapRenderBackend";
import type { VarManagerProvider } from "../rs/config/vartype/VarProvider";
import type { CacheSession } from "../rs/loaders/CacheSession";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import type { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import type { SceneBuilder } from "../rs/scene/SceneBuilder";
import type { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import type { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import type { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";

export type WorkerState = {
    session: CacheSession;
    varProvider: VarManagerProvider;
    mapBytesProvider: MapBytesProvider;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
    locModelLoader: LocModelLoader;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;

    sceneBuilder: SceneBuilder;
    mapRenderBackend: MapRenderBackend;

    mapImageRenderer: MapImageRenderer;
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
