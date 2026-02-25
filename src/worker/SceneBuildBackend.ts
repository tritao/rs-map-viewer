import { MapBytesProvider } from "../rs/map/MapBytesProvider";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";

export type SceneBuildBackendKind = "ts" | "cpp-wasm";

export type SceneBuildInput = Readonly<{
    baseX: number;
    baseY: number;
    sizeX: number;
    sizeY: number;
    smoothTerrain: boolean;
    locLoadType: LocLoadType;
}>;

export interface SceneBuildBackend {
    readonly kind: SceneBuildBackendKind;
    buildScene(input: SceneBuildInput): Promise<Scene>;
    reset(): void;
}

export type SceneBuildDeps = Readonly<{
    sceneBuilder: SceneBuilder;
    mapBytesProvider: MapBytesProvider;
}>;

export type SceneBuildBackendOptions = Readonly<{
    cppWasmModuleUrl?: string;
    strictCppWasm?: boolean;
}>;

export function getCppWasmSceneMetadata(_scene: Scene): undefined {
    return undefined;
}

class TsSceneBuildBackend implements SceneBuildBackend {
    readonly kind: SceneBuildBackendKind;

    constructor(
        private readonly deps: SceneBuildDeps,
        kind: SceneBuildBackendKind = "ts",
    ) {
        this.kind = kind;
    }

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

let warnedCppWasmSceneBackendFallback = false;

export function createSceneBuildBackend(
    kind: SceneBuildBackendKind,
    deps: SceneBuildDeps,
    _options?: SceneBuildBackendOptions,
): SceneBuildBackend {
    if (kind === "cpp-wasm") {
        if (!warnedCppWasmSceneBackendFallback) {
            warnedCppWasmSceneBackendFallback = true;
            console.warn(
                "[scene-backend] cpp-wasm scene build path is removed; using ts scene backend",
            );
        }
        return new TsSceneBuildBackend(deps, "cpp-wasm");
    }
    return new TsSceneBuildBackend(deps, "ts");
}
