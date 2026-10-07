import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import type { NpcSpawnResolver, NpcSpawnTelemetry } from "../../data/npc/NpcSpawnResolver";
import type { ObjSpawn } from "../../data/obj/ObjSpawn";
import type { ObjRenderData } from "../../maprender/MapRenderData";
import type { LocAnimatedGroup } from "../../maprender/build/LocAnimatedGroup";
import type { LocAnimatedGroupBuild } from "../../maprender/build/LocRenderDataBuilder";
import type {
    BuildNpcGeometryInput,
    BuiltNpcGeometry,
} from "../../maprender/build/NpcGeometryBuilder";
import type { SceneGeometryBuffer, SceneModel } from "../../maprender/build/SceneGeometryBuffer";
import type { SceneLocEntity } from "../../maprender/build/SceneLocEntity";
import type { SceneLocs } from "../../maprender/build/SceneLocs";
import type { Scene } from "../../rs/scene/Scene";
import type { LocLoadType } from "../../rs/scene/SceneBuilder";
import type { SceneLocPlacementOverride } from "../../rs/scene/buildSceneFromMapBytesProvider";
import type { ContentBuildAdapter } from "./ContentBuildAdapter";

export type MapRenderSceneBuildInput = Readonly<{
    mapX: number;
    mapY: number;
    borderSize: number;
    smoothTerrain?: boolean;
    locLoadType?: LocLoadType;
    locPlacementOverrides?: ReadonlyArray<SceneLocPlacementOverride>;
}>;

export type MapRenderSceneLocsInput = Readonly<{
    scene: Scene;
    borderSize: number;
    maxLevel: number;
}>;

export type MapRenderLocSceneModelBuildInput = Readonly<{
    scene: Scene;
    sceneModels: SceneModel[];
    locEntities: SceneLocEntity[];
}>;

export type MapRenderLocAnimatedGroupsInput = Readonly<{
    sceneBuf: SceneGeometryBuffer;
    buildGroups: Iterable<LocAnimatedGroupBuild>;
}>;

export type MapRenderNpcGeometryInput = Readonly<
    Pick<BuildNpcGeometryInput, "loadNpcs" | "includeNpcAnimationFrames"> & {
        npcSpawns: readonly NpcSpawn[];
    }
>;

export type MapRenderObjRenderInput = Readonly<{
    loadObjs: boolean;
    scene: Scene;
    baseX: number;
    baseY: number;
    borderSize: number;
    objSpawns: readonly ObjSpawn[];
    interactIds?: ArrayLike<number>;
    minimizeDrawCalls: boolean;
}>;

export type MapRenderMinimapBlobInput = Readonly<{
    scene: Scene;
    level: number;
    borderSize: number;
    drawMapFunctions: boolean;
}>;

export type MapRenderSceneCacheProvider = Readonly<{
    tryGetBlobBytes(domain: number, group: number, file: number): Uint8Array | undefined;
}>;

export type MapRenderNpcSpawnDecodeBackend = Readonly<{
    name: string;
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

export type MapRenderResolveNpcSpawnsInput = Readonly<{
    npcSpawnResolver: NpcSpawnResolver;
    loadNpcs: boolean;
    mapX: number;
    mapY: number;
    maxLevel: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    npcSpawnDecodeBackend?: MapRenderNpcSpawnDecodeBackend;
    fallbackNpcSpawns?: ReadonlyArray<NpcSpawn>;
    telemetry?: NpcSpawnTelemetry;
    fallbackOnEmptyCacheDecode?: boolean;
}>;

export type MapRenderBuildAdapter = ContentBuildAdapter &
    Readonly<{
        buildScene(input: MapRenderSceneBuildInput): Scene;
        getSceneLocs(input: MapRenderSceneLocsInput): SceneLocs;
        addSceneLocEntities(
            input: MapRenderLocSceneModelBuildInput,
        ): Iterable<LocAnimatedGroupBuild>;
        buildLocAnimatedGroups(input: MapRenderLocAnimatedGroupsInput): LocAnimatedGroup[];
        buildNpcGeometry(input: MapRenderNpcGeometryInput): BuiltNpcGeometry;
        buildObjRenderData(input: MapRenderObjRenderInput): ObjRenderData | undefined;
        loadMinimapBlob(input: MapRenderMinimapBlobInput): Promise<Blob>;
        createSceneCacheProvider(): MapRenderSceneCacheProvider;
        resolveNpcSpawns(input: MapRenderResolveNpcSpawnsInput): Promise<readonly NpcSpawn[]>;
    }>;
