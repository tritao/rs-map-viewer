import { MapBytesProvider } from "../map/MapBytesProvider";
import { getMapSquareId } from "../map/MapFileIndex";
import { LocModelType } from "../config/loctype/LocModelType";
import { Scene } from "./Scene";
import { LocLoadType, SceneBuilder } from "./SceneBuilder";

export type SceneBuildMapBounds = Readonly<{
    mapStartX: number;
    mapStartY: number;
    mapEndX: number;
    mapEndY: number;
}>;

export type SceneBuildContext = Readonly<{
    baseX: number;
    baseY: number;
    sizeX: number;
    sizeY: number;
    smoothUnderlays: boolean;
    locLoadType: LocLoadType;
    locPlacementOverridesByMapId?: ReadonlyMap<number, ReadonlyMap<number, SceneLocPlacementOverride>>;
    bounds: SceneBuildMapBounds;
}>;

export type SceneLocPlacementOverride = Readonly<{
    sourceMapId: number;
    placementIndex: number;
    remove?: boolean;
    locTypeId?: number;
    locModelType?: LocModelType;
    rotation?: number;
}>;

function createLocPlacementOverridesByMapId(
    overrides?: ReadonlyArray<SceneLocPlacementOverride>,
): ReadonlyMap<number, ReadonlyMap<number, SceneLocPlacementOverride>> | undefined {
    if (!overrides || (overrides.length | 0) <= 0) {
        return undefined;
    }
    const byMapId = new Map<number, Map<number, SceneLocPlacementOverride>>();
    for (let index = 0; index < overrides.length; index++) {
        const override = overrides[index];
        if (!override) {
            continue;
        }
        const sourceMapId = override.sourceMapId | 0;
        let byPlacementIndex = byMapId.get(sourceMapId);
        if (!byPlacementIndex) {
            byPlacementIndex = new Map<number, SceneLocPlacementOverride>();
            byMapId.set(sourceMapId, byPlacementIndex);
        }
        byPlacementIndex.set(override.placementIndex | 0, override);
    }
    return byMapId;
}

export function computeSceneBuildMapBounds(
    baseX: number,
    baseY: number,
    sizeX: number,
    sizeY: number,
): SceneBuildMapBounds {
    return {
        mapStartX: Math.floor(baseX / Scene.MAP_SQUARE_SIZE),
        mapStartY: Math.floor(baseY / Scene.MAP_SQUARE_SIZE),
        mapEndX: Math.ceil((baseX + sizeX) / Scene.MAP_SQUARE_SIZE),
        mapEndY: Math.ceil((baseY + sizeY) / Scene.MAP_SQUARE_SIZE),
    };
}

export function createSceneBuildContext(
    baseX: number,
    baseY: number,
    sizeX: number,
    sizeY: number,
    smoothUnderlays: boolean,
    locLoadType: LocLoadType,
    locPlacementOverrides?: ReadonlyArray<SceneLocPlacementOverride>,
): SceneBuildContext {
    return {
        baseX,
        baseY,
        sizeX,
        sizeY,
        smoothUnderlays,
        locLoadType,
        locPlacementOverridesByMapId: createLocPlacementOverridesByMapId(locPlacementOverrides),
        bounds: computeSceneBuildMapBounds(baseX, baseY, sizeX, sizeY),
    };
}

export function decodeTerrainStage(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapBytesProvider,
    scene: Scene,
    context: SceneBuildContext,
): Set<number> {
    const emptyTerrainIds = new Set<number>();
    const { bounds, baseX, baseY } = context;

    for (let mx = bounds.mapStartX; mx < bounds.mapEndX; mx++) {
        for (let my = bounds.mapStartY; my < bounds.mapEndY; my++) {
            const terrainData = mapBytesProvider.getTerrainBytes(mx, my);
            if (!terrainData) {
                emptyTerrainIds.add(getMapSquareId(mx, my));
                continue;
            }
            const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
            const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
            sceneBuilder.decodeTerrain(scene, terrainData, offsetX, offsetY, baseX, baseY);
        }
    }

    return emptyTerrainIds;
}

export function fillEmptyTerrainStage(
    sceneBuilder: SceneBuilder,
    scene: Scene,
    context: SceneBuildContext,
    emptyTerrainIds: Set<number>,
): void {
    const { bounds, baseX, baseY } = context;
    for (let mx = bounds.mapStartX; mx < bounds.mapEndX; mx++) {
        for (let my = bounds.mapStartY; my < bounds.mapEndY; my++) {
            if (!emptyTerrainIds.has(getMapSquareId(mx, my))) {
                continue;
            }

            const endX = (mx + 1) * Scene.MAP_SQUARE_SIZE;
            const endY = (my + 1) * Scene.MAP_SQUARE_SIZE;
            const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
            const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
            const tileX = Math.max(offsetX, 0);
            const tileY = Math.max(offsetY, 0);
            const emptySizeX = endX - baseX - tileX;
            const emptySizeY = endY - baseY - tileY;
            for (let level = 0; level < scene.levels; level++) {
                sceneBuilder.loadEmptyTerrain(scene, level, tileX, tileY, emptySizeX, emptySizeY);
            }
        }
    }
}

export function decodeLocsStage(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapBytesProvider,
    scene: Scene,
    context: SceneBuildContext,
): void {
    const { bounds, baseX, baseY, locLoadType, locPlacementOverridesByMapId } = context;
    for (let mx = bounds.mapStartX; mx < bounds.mapEndX; mx++) {
        for (let my = bounds.mapStartY; my < bounds.mapEndY; my++) {
            const locData = mapBytesProvider.getLocBytes(mx, my);
            if (!locData) {
                continue;
            }
            const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
            const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
            const sourceMapId = getMapSquareId(mx, my);
            sceneBuilder.decodeLocs(
                scene,
                locData,
                offsetX,
                offsetY,
                locLoadType,
                sourceMapId,
                locPlacementOverridesByMapId?.get(sourceMapId),
            );
        }
    }
}

export function finalizeSceneStage(
    sceneBuilder: SceneBuilder,
    scene: Scene,
    context: SceneBuildContext,
): void {
    const { smoothUnderlays, locLoadType } = context;
    sceneBuilder.addTileModels(scene, smoothUnderlays);
    scene.setTileMinLevels();
    if (locLoadType === LocLoadType.MODELS) {
        scene.light(sceneBuilder.textureLoader, -50, -10, -50);
    }
}
