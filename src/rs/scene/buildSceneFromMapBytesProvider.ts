import { MapBytesProvider } from "../map/MapBytesProvider";
import { Scene } from "./Scene";
import {
    createSceneBuildContext,
    decodeLocsStage,
    decodeTerrainStage,
    fillEmptyTerrainStage,
    finalizeSceneStage,
} from "./SceneBuildStages";
import { LocLoadType, SceneBuilder } from "./SceneBuilder";

export function buildSceneFromMapBytesProvider(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapBytesProvider,
    baseX: number,
    baseY: number,
    sizeX: number,
    sizeY: number,
    smoothUnderlays: boolean = false,
    locLoadType: LocLoadType = LocLoadType.MODELS,
): Scene {
    const context = createSceneBuildContext(
        baseX,
        baseY,
        sizeX,
        sizeY,
        smoothUnderlays,
        locLoadType,
    );
    const scene = new Scene(Scene.MAX_LEVELS, context.sizeX, context.sizeY);

    const emptyTerrainIds = decodeTerrainStage(sceneBuilder, mapBytesProvider, scene, context);
    fillEmptyTerrainStage(sceneBuilder, scene, context, emptyTerrainIds);
    decodeLocsStage(sceneBuilder, mapBytesProvider, scene, context);
    finalizeSceneStage(sceneBuilder, scene, context);

    return scene;
}
