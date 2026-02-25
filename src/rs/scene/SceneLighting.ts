import { MergeNormalsScratch, isModelData } from "../model/ModelData";
import { TextureLoader } from "../texture/TextureLoader";
import { Scene } from "./Scene";
import { Entity } from "./entity/Entity";

export function mergeLargeLocNormalsForScene(
    scene: Scene,
    scratch: MergeNormalsScratch,
    model: Entity,
    startLevel: number,
    tileX: number,
    tileY: number,
    sizeX: number,
    sizeY: number,
): void {
    let hideOccluded = true;
    let startX = tileX;
    const endX = tileX + sizeX;
    const startY = tileY - 1;
    const endY = tileY + sizeY;

    for (let level = startLevel; level <= startLevel + 1; level++) {
        if (level === scene.levels) {
            continue;
        }

        for (let localX = startX; localX <= endX; localX++) {
            if (localX >= 0 && localX < scene.sizeX) {
                for (let localY = startY; localY <= endY; localY++) {
                    if (
                        localY >= 0 &&
                        localY < scene.sizeY &&
                        (!hideOccluded ||
                            localX >= endX ||
                            localY >= endY ||
                            (localY < tileY && tileX !== localX))
                    ) {
                        const tile = scene.tiles[level][localX][localY];
                        if (tile) {
                            const deltaHeight = scene.getDeltaHeight(
                                level,
                                localX,
                                localY,
                                startLevel,
                                tileX,
                                tileY,
                            );

                            const wall = tile.wall;
                            if (wall) {
                                const entity0 = wall.entity0;
                                if (entity0) {
                                    model.mergeNormals(
                                        entity0,
                                        (1 - sizeX) * 64 + (localX - tileX) * 128,
                                        deltaHeight,
                                        (localY - tileY) * 128 + (1 - sizeY) * 64,
                                        hideOccluded,
                                        scratch,
                                    );
                                }
                                const entity1 = wall.entity1;
                                if (entity1) {
                                    model.mergeNormals(
                                        entity1,
                                        (1 - sizeX) * 64 + (localX - tileX) * 128,
                                        deltaHeight,
                                        (localY - tileY) * 128 + (1 - sizeY) * 64,
                                        hideOccluded,
                                        scratch,
                                    );
                                }
                            }

                            for (const loc of tile.locs) {
                                const locEntity = loc.entity;
                                if (!locEntity) {
                                    continue;
                                }
                                const sizeLocX = loc.endX - loc.startX + 1;
                                const sizeLocY = loc.endY - loc.startY + 1;
                                model.mergeNormals(
                                    locEntity,
                                    (sizeLocX - sizeX) * 64 + (loc.startX - tileX) * 128,
                                    deltaHeight,
                                    (loc.startY - tileY) * 128 + (sizeLocY - sizeY) * 64,
                                    hideOccluded,
                                    scratch,
                                );
                            }
                        }
                    }
                }
            }
        }

        startX--;
        hideOccluded = false;
    }
}

export function mergeFloorNormalsForScene(
    scene: Scene,
    scratch: MergeNormalsScratch,
    model: Entity,
    level: number,
    tileX: number,
    tileY: number,
): void {
    const endX = tileX + 1;
    const startY = tileY - 1;
    const endY = tileY + 1;

    for (let x = tileX; x <= endX; x++) {
        if (x >= 0 && x < scene.sizeX) {
            for (let y = startY; y <= endY; y++) {
                if (y >= 0 && y < scene.sizeY && (x >= endX || y >= endY)) {
                    const tile = scene.tiles[level][x][y];
                    if (tile && tile.floorDecoration && tile.floorDecoration.entity) {
                        const deltaHeight = scene.getDeltaHeight(level, x, y, level, tileX, tileY);
                        model.mergeNormals(
                            tile.floorDecoration.entity,
                            (x - tileX) * 128,
                            deltaHeight,
                            (y - tileY) * 128,
                            true,
                            scratch,
                        );
                    }
                }
            }
        }
    }
}

export function lightSceneModelData(
    scene: Scene,
    scratch: MergeNormalsScratch,
    textureLoader: TextureLoader,
    lightX: number,
    lightY: number,
    lightZ: number,
): void {
    for (let level = 0; level < scene.levels; level++) {
        for (let tileX = 0; tileX < scene.sizeX; tileX++) {
            for (let tileY = 0; tileY < scene.sizeY; tileY++) {
                const tile = scene.tiles[level][tileX][tileY];
                if (!tile) {
                    continue;
                }
                const wall = tile.wall;
                if (wall && isModelData(wall.entity0)) {
                    const model0 = wall.entity0;
                    mergeLargeLocNormalsForScene(scene, scratch, model0, level, tileX, tileY, 1, 1);

                    if (isModelData(wall.entity1)) {
                        const model1 = wall.entity1;
                        mergeLargeLocNormalsForScene(
                            scene,
                            scratch,
                            model1,
                            level,
                            tileX,
                            tileY,
                            1,
                            1,
                        );
                        model0.mergeNormals(model1, 0, 0, 0, false, scratch);
                        wall.entity1 = model1.light(
                            textureLoader,
                            model1.ambient,
                            model1.contrast,
                            lightX,
                            lightY,
                            lightZ,
                        );
                    }

                    wall.entity0 = model0.light(
                        textureLoader,
                        model0.ambient,
                        model0.contrast,
                        lightX,
                        lightY,
                        lightZ,
                    );
                }

                for (const loc of tile.locs) {
                    if (isModelData(loc.entity)) {
                        const locEntity = loc.entity;
                        mergeLargeLocNormalsForScene(
                            scene,
                            scratch,
                            locEntity,
                            level,
                            tileX,
                            tileY,
                            loc.endX - loc.startX + 1,
                            loc.endY - loc.startY + 1,
                        );
                        loc.entity = locEntity.light(
                            textureLoader,
                            locEntity.ambient,
                            locEntity.contrast,
                            lightX,
                            lightY,
                            lightZ,
                        );
                    }
                }

                const floorDecoration = tile.floorDecoration;
                if (floorDecoration && isModelData(floorDecoration.entity)) {
                    const floorModel = floorDecoration.entity;
                    mergeFloorNormalsForScene(scene, scratch, floorModel, level, tileX, tileY);
                    floorDecoration.entity = floorModel.light(
                        textureLoader,
                        floorModel.ambient,
                        floorModel.contrast,
                        lightX,
                        lightY,
                        lightZ,
                    );
                }
            }
        }
    }
}
