import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import type { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import type { ObjSpawn } from "../../data/obj/ObjSpawn";
import type { ObjRenderData } from "../../maprender/MapRenderData";
import type { MinimapData } from "../../maprender/ts/MinimapData";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { Scene } from "../../rs/scene/Scene";
import type { LocLoadType } from "../../rs/scene/SceneBuilder";
import type { SceneLocPlacementOverride } from "../../rs/scene/buildSceneFromMapBytesProvider";
import type { ResolvedBootstrapData } from "../../runtime/sim/NpcBootstrap";
import type { NpcSimStateStoreDeps } from "../../runtime/sim/NpcSimStateStore";
import type { ContentBuildAdapter } from "../build/ContentBuildAdapter";

export type WorldRuntimeAnimationDeps = Readonly<{
    seqTypeLoader: SeqTypeLoader;
    seqFrameLoader: SeqFrameLoader;
}>;

export type WorldRuntimeSceneBuildByMapIdInput = Readonly<{
    mapId: number;
    borderSize: number;
    smoothTerrain?: boolean;
    locLoadType?: LocLoadType;
    locPlacementOverrides?: ReadonlyArray<SceneLocPlacementOverride>;
}>;

export type WorldRuntimeMapImageInput = Readonly<{
    mapX: number;
    mapY: number;
    level: number;
    borderSize: number;
    drawMapFunctions: boolean;
}>;

export type WorldRuntimeNpcBootstrapInput = Readonly<{
    mapId: number;
    maxLevel: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    npcOrderKeys: Int32Array;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
}>;

export type WorldRuntimeMapObjRenderInput = Readonly<{
    mapId: number;
    borderSize: number;
    objSpawns: ReadonlyArray<ObjSpawn>;
    interactIds?: ArrayLike<number>;
    minimizeDrawCalls: boolean;
}>;

export type WorldRuntimeContentAdapter = ContentBuildAdapter &
    Readonly<{
        getCacheInfo(): CacheInfo;
        loadTextureArgb(
            id: number,
            size: number,
            flipH: boolean,
            brightness: number,
        ): Int32Array | undefined;
        setVarValues(values: Int32Array): void;
        createNpcSimStateStoreDeps(tickPatchEntryStride: number): NpcSimStateStoreDeps;
        getNpcAnimationDeps(): WorldRuntimeAnimationDeps;
        buildSceneForMapId(input: WorldRuntimeSceneBuildByMapIdInput): Scene;
        loadMapImage(input: WorldRuntimeMapImageInput): Promise<MinimapData>;
        resolveNpcBootstrapData(
            npcSpawnResolver: NpcSpawnResolver,
            input: WorldRuntimeNpcBootstrapInput,
        ): Promise<ResolvedBootstrapData>;
        buildMapObjRenderData(input: WorldRuntimeMapObjRenderInput): ObjRenderData | undefined;
        exportSpritesToZip(): Promise<Blob>;
        exportTexturesToZip(): Promise<Blob>;
    }>;
