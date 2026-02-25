import { MapBytesProvider } from "../rs/map/MapBytesProvider";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";

export type SceneBuildInput = Readonly<{
    baseX: number;
    baseY: number;
    sizeX: number;
    sizeY: number;
    smoothTerrain: boolean;
    locLoadType: LocLoadType;
}>;

export interface SceneBuildBackend {
    buildScene(input: SceneBuildInput): Promise<Scene>;
    reset(): void;
}

export type SceneBuildDeps = Readonly<{
    sceneBuilder: SceneBuilder;
    mapBytesProvider: MapBytesProvider;
}>;

class TsSceneBuildBackend implements SceneBuildBackend {
    constructor(private readonly deps: SceneBuildDeps) {}

    async buildScene(input: SceneBuildInput): Promise<Scene> {
        return buildSceneFromMapBytesProvider(
            this.deps.sceneBuilder,
            this.deps.mapBytesProvider,
            input.baseX,
            input.baseY,
            input.sizeX,
            input.sizeY,
            input.smoothTerrain,
            input.locLoadType,
        );
    }

    reset(): void {}
}

export function createSceneBuildBackend(
    deps: SceneBuildDeps,
): SceneBuildBackend {
    return new TsSceneBuildBackend(deps);
}
