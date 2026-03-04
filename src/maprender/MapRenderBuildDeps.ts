import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { VarProvider } from "../rs/config/vartype/VarProvider";
import type { CacheSession } from "../rs/loaders/CacheSession";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import type { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import type { SceneBuilder } from "../rs/scene/SceneBuilder";
import type { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import type { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import type { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import type { BackendKind } from "../util/BackendKind";

export type NpcSpawnDecodeBackend = Readonly<{
    name: BackendKind;
    filtersLoginScreenProps?: boolean;
    decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1: Uint8Array[],
        borderSize: number,
        mapX: number,
        mapY: number,
        data: Uint8Array,
        npcLoginScreenPropsById?: Uint8Array,
        requiredLoginScreenPropsMask?: number,
    ): Promise<NpcSpawn[] | undefined>;
}>;

export type MapRenderBuildDeps = Readonly<{
    session: CacheSession;
    sceneBuilder: SceneBuilder;
    mapBytesProvider: MapBytesProvider;
    locModelLoader: LocModelLoader;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;
    mapImageRenderer: MapImageRenderer;
    varProvider: VarProvider;
    objSpawns: ObjSpawn[];
    fallbackNpcSpawns?: ReadonlyArray<NpcSpawn>;
    npcSpawnDecodeBackend?: NpcSpawnDecodeBackend;
    telemetry?: boolean;
}>;
