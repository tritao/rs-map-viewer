import { LocModelType } from "../rs/config/loctype/LocModelType";
import { MapBytesProvider } from "../rs/map/MapBytesProvider";
import { TileRenderFlag } from "../rs/scene/Scene";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";
import { errorToString } from "../util/ErrorUtil";

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
}

export type SceneBuildDeps = Readonly<{
    sceneBuilder: SceneBuilder;
    mapBytesProvider: MapBytesProvider;
}>;

export type SceneBuildBackendOptions = Readonly<{
    cppWasmModuleUrl?: string;
}>;

export type CppWasmSceneData = Readonly<{
    levels: number;
    sizeX: number;
    sizeY: number;
    tileHeights: Int32Array;
    tileRenderFlags: Uint8Array;
    tileUnderlays: Uint16Array;
    tileOverlays: Int16Array;
    tileShapes: Uint8Array;
    tileRotations: Uint8Array;
    blockedByFloor: Uint8Array;
    locPlacements: Int32Array;
}>;

const LOC_PLACEMENT_STRIDE = 7;

export interface CppWasmSceneBridge {
    buildSceneData(input: SceneBuildInput, deps: SceneBuildDeps): Promise<CppWasmSceneData | undefined>;
}

class TsSceneBuildBackend implements SceneBuildBackend {
    readonly kind: SceneBuildBackendKind = "ts";

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
}

function assertLength(actual: number, expected: number, name: string): void {
    if (actual !== expected) {
        throw new Error(`Invalid ${name} length: got=${actual} expected=${expected}`);
    }
}

function hydrateSceneFromCppData(
    data: CppWasmSceneData,
    input: SceneBuildInput,
    deps: SceneBuildDeps,
): Scene {
    if (data.sizeX !== input.sizeX || data.sizeY !== input.sizeY) {
        throw new Error(
            `Cpp scene dimensions mismatch: got=${data.sizeX}x${data.sizeY} expected=${input.sizeX}x${input.sizeY}`,
        );
    }
    if (data.levels !== Scene.MAX_LEVELS) {
        throw new Error(
            `Cpp scene levels mismatch: got=${data.levels} expected=${Scene.MAX_LEVELS}`,
        );
    }

    const scene = new Scene(data.levels, data.sizeX, data.sizeY);
    const tileCount = data.levels * data.sizeX * data.sizeY;
    const heightCount = data.levels * (data.sizeX + 1) * (data.sizeY + 1);
    assertLength(data.tileHeights.length, heightCount, "tileHeights");
    assertLength(data.tileRenderFlags.length, tileCount, "tileRenderFlags");
    assertLength(data.tileUnderlays.length, tileCount, "tileUnderlays");
    assertLength(data.tileOverlays.length, tileCount, "tileOverlays");
    assertLength(data.tileShapes.length, tileCount, "tileShapes");
    assertLength(data.tileRotations.length, tileCount, "tileRotations");
    assertLength(data.blockedByFloor.length, tileCount, "blockedByFloor");
    if (data.locPlacements.length % LOC_PLACEMENT_STRIDE !== 0) {
        throw new Error(
            `Invalid locPlacements length: ${data.locPlacements.length} (stride=${LOC_PLACEMENT_STRIDE})`,
        );
    }

    const tileIndex = (level: number, x: number, y: number): number =>
        (level * data.sizeX + x) * data.sizeY + y;
    const heightIndex = (level: number, x: number, y: number): number =>
        (level * (data.sizeX + 1) + x) * (data.sizeY + 1) + y;

    for (let level = 0; level < data.levels; level++) {
        for (let x = 0; x < data.sizeX; x++) {
            for (let y = 0; y < data.sizeY; y++) {
                const i = tileIndex(level, x, y);
                scene.tileRenderFlags[level][x][y] = data.tileRenderFlags[i];
                scene.tileUnderlays[level][x][y] = data.tileUnderlays[i];
                scene.tileOverlays[level][x][y] = data.tileOverlays[i];
                scene.tileShapes[level][x][y] = data.tileShapes[i];
                scene.tileRotations[level][x][y] = data.tileRotations[i];
                if (data.blockedByFloor[i] !== 0) {
                    scene.collisionMaps[level].setBlockedByFloor(x, y);
                }
            }
        }
        for (let x = 0; x <= data.sizeX; x++) {
            for (let y = 0; y <= data.sizeY; y++) {
                scene.tileHeights[level][x][y] = data.tileHeights[heightIndex(level, x, y)];
            }
        }
    }

    for (let i = 0; i < data.locPlacements.length; i += LOC_PLACEMENT_STRIDE) {
        const originalId = data.locPlacements[i + 0];
        const level = data.locPlacements[i + 2];
        const tileX = data.locPlacements[i + 3];
        const tileY = data.locPlacements[i + 4];
        const type = data.locPlacements[i + 5];
        const rotation = data.locPlacements[i + 6];

        let transformedLevel = level;
        if ((scene.tileRenderFlags[1][tileX][tileY] & TileRenderFlag.Bridge) !== 0) {
            transformedLevel = level - 1;
        }
        let collisionMap = undefined;
        if (transformedLevel >= 0 && transformedLevel < scene.levels) {
            collisionMap = scene.collisionMaps[transformedLevel];
        }

        deps.sceneBuilder.addLoc(
            scene,
            level,
            tileX,
            tileY,
            originalId,
            type as LocModelType,
            rotation,
            collisionMap,
            input.locLoadType,
        );
    }

    deps.sceneBuilder.addTileModels(scene, input.smoothTerrain);
    scene.setTileMinLevels();
    if (input.locLoadType === LocLoadType.MODELS) {
        scene.light(deps.sceneBuilder.textureLoader, -50, -10, -50);
    }
    return scene;
}

function resolveCppWasmBridgeExport(mod: Record<string, unknown>): CppWasmSceneBridge | undefined {
    const candidates: unknown[] = [
        mod.default,
        mod.cppWasmSceneBridge,
        mod.sceneBridge,
    ];
    for (const c of candidates) {
        if (c && typeof c === "object" && "buildSceneData" in c) {
            const bridge = c as CppWasmSceneBridge;
            if (typeof bridge.buildSceneData === "function") {
                return bridge;
            }
        }
    }
    return undefined;
}

async function tryLoadCppWasmBridge(moduleUrl?: string): Promise<CppWasmSceneBridge | undefined> {
    const url = moduleUrl ?? "/wasm/rs_scene_backend_bridge.mjs";
    try {
        const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
        const bridge = resolveCppWasmBridgeExport(mod);
        if (!bridge) {
            console.warn(`[scene-backend] cpp-wasm module missing bridge export: ${url}`);
        }
        return bridge;
    } catch (e) {
        console.warn(`[scene-backend] failed to load cpp-wasm module ${url}: ${errorToString(e)}`);
        return undefined;
    }
}

class CppWasmSceneBuildBackend implements SceneBuildBackend {
    readonly kind: SceneBuildBackendKind = "cpp-wasm";
    private bridgePromise: Promise<CppWasmSceneBridge | undefined> | undefined;
    private readonly fallback: TsSceneBuildBackend;

    constructor(
        private readonly deps: SceneBuildDeps,
        private readonly options: SceneBuildBackendOptions | undefined,
    ) {
        this.fallback = new TsSceneBuildBackend(deps);
    }

    private loadBridge(): Promise<CppWasmSceneBridge | undefined> {
        if (!this.bridgePromise) {
            this.bridgePromise = tryLoadCppWasmBridge(this.options?.cppWasmModuleUrl);
        }
        return this.bridgePromise;
    }

    async buildScene(input: SceneBuildInput): Promise<Scene> {
        const bridge = await this.loadBridge();
        if (!bridge) {
            return this.fallback.buildScene(input);
        }
        try {
            const data = await bridge.buildSceneData(input, this.deps);
            if (!data) {
                return this.fallback.buildScene(input);
            }
            return hydrateSceneFromCppData(data, input, this.deps);
        } catch (e) {
            console.warn(`[scene-backend] cpp-wasm buildScene failed: ${errorToString(e)}`);
            return this.fallback.buildScene(input);
        }
    }
}

export function createSceneBuildBackend(
    kind: SceneBuildBackendKind,
    deps: SceneBuildDeps,
    options?: SceneBuildBackendOptions,
): SceneBuildBackend {
    if (kind === "cpp-wasm") {
        return new CppWasmSceneBuildBackend(deps, options);
    }
    return new TsSceneBuildBackend(deps);
}
