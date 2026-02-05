import { MapBytesProvider } from "../map/MapBytesProvider";
import { getMapSquareId } from "../map/MapFileIndex";
import { Scene } from "./Scene";
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
    const scene = new Scene(Scene.MAX_LEVELS, sizeX, sizeY);

    const mapStartX = Math.floor(baseX / Scene.MAP_SQUARE_SIZE);
    const mapStartY = Math.floor(baseY / Scene.MAP_SQUARE_SIZE);

    const mapEndX = Math.ceil((baseX + sizeX) / Scene.MAP_SQUARE_SIZE);
    const mapEndY = Math.ceil((baseY + sizeY) / Scene.MAP_SQUARE_SIZE);

    const emptyTerrainIds = new Set<number>();

    for (let mx = mapStartX; mx < mapEndX; mx++) {
        for (let my = mapStartY; my < mapEndY; my++) {
            const terrainData = mapBytesProvider.getTerrainBytes(mx, my);
            if (terrainData) {
                const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
                const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
                sceneBuilder.decodeTerrain(scene, terrainData, offsetX, offsetY, baseX, baseY);
            } else {
                emptyTerrainIds.add(getMapSquareId(mx, my));
            }
        }
    }

    for (let mx = mapStartX; mx < mapEndX; mx++) {
        for (let my = mapStartY; my < mapEndY; my++) {
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

    for (let mx = mapStartX; mx < mapEndX; mx++) {
        for (let my = mapStartY; my < mapEndY; my++) {
            const locData = mapBytesProvider.getLocBytes(mx, my);
            if (!locData) {
                continue;
            }
            const offsetX = mx * Scene.MAP_SQUARE_SIZE - baseX;
            const offsetY = my * Scene.MAP_SQUARE_SIZE - baseY;
            sceneBuilder.decodeLocs(scene, locData, offsetX, offsetY, locLoadType);
        }
    }

    sceneBuilder.addTileModels(scene, smoothUnderlays);
    scene.setTileMinLevels();

    if (locLoadType === LocLoadType.MODELS) {
        scene.light(sceneBuilder.locModelLoader.textureLoader, -50, -10, -50);
    }

    return scene;
}

