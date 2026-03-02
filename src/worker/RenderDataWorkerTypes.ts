import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { VarManagerProvider } from "../rs/config/vartype/VarProvider";
import type { CacheSession } from "../rs/loaders/CacheSession";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import type { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import type { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import type { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import type { SceneBuilder } from "../rs/scene/SceneBuilder";
import type { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import type { MapRenderDataBackend, MapRenderDataBackendKind } from "./MapRenderDataBackend";

export type WorkerState = {
    session: CacheSession;
    varProvider: VarManagerProvider;
    mapBytesProvider: MapBytesProvider;
    locModelLoader: LocModelLoader;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;

    sceneBuilder: SceneBuilder;
    mapRenderDataBackend: MapRenderDataBackend;

    mapImageRenderer: MapImageRenderer;
    mapImageCache: Cache;
};

export type WorkerRuntimeOptions = Readonly<{
    mapRenderBackend?: MapRenderDataBackendKind;
    mapRenderTelemetry?: boolean;
}>;

export type WorkerSpawnBootstrap = Readonly<{
    objSpawns: ObjSpawn[];
}>;
