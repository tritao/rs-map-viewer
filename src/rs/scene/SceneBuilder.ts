import { CacheInfo, GameType } from "../cache/CacheInfo";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { OverlayFloorType } from "../config/floortype/OverlayFloorType";
import { LocModelType } from "../config/loctype/LocModelType";
import { LocType } from "../config/loctype/LocType";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { ByteBuffer } from "../io/ByteBuffer";
import { getMapSquareId } from "../map/MapFileIndex";
import { ContourGroundType } from "../model/ContourGroundType";
import { Model } from "../model/Model";
import { TextureLoader } from "../texture/TextureLoader";
import { packHsl } from "../util/ColorUtil";
import { CollisionMap } from "./CollisionMap";
import { packLocPlacement } from "./LocPlacementFlag";
import { Scene, TileRenderFlag } from "./Scene";
import { OverlayCornerSet, OverlayEdgeSet } from "./SceneTileModel";
import { computeSceneTileModelForTile } from "./computeSceneTileModel";
import { decodeLocPlacementsFromBytes } from "./decodeLocPlacements";
import {
    TerrainSquareDecodeScratch,
    applyDecodedTerrainSquareToScene,
    decodeTerrainSquareFromBytesInto,
} from "./decodeTerrainSquare";
import { Entity } from "./entity/Entity";
import { EntityType, calculateEntityTag, getIdFromTag, hasEntityTag } from "./entity/EntityTag";
import { LocEntity } from "./entity/LocEntity";
import { ContourGroundInfo, LocModelLoader } from "./model/LocModelLoader";

export enum LocLoadType {
    MODELS,
    NO_MODELS,
}

export class SceneBuilder {
    static readonly BLEND_RADIUS = 5;

    // Ported from 667 `TerrainTileBuilder` (edge eligibility is shape-relative; rotation applied at runtime).
    // Edge order is assumed to be [south, east, north, west] (clockwise).
    private static readonly BLENDABLE_OVERLAY_NEIGHBOR_EDGE_ELIGIBILITY_BY_SHAPE: boolean[][] = [
        [false, false, false, false],
        [false, true, true, false],
        [true, false, true, false],
        [true, false, true, false],
        [false, false, true, false],
        [false, false, true, false],
        [true, false, true, false],
        [true, false, false, true],
        [true, false, false, true],
        [true, true, false, false],
        [false, false, false, false],
        [false, true, false, true],
        [false, false, false, false],
    ];

    private static readonly NON_BLENDABLE_OVERLAY_NEIGHBOR_EDGE_ELIGIBILITY_BY_SHAPE: boolean[][] =
        [
            [false, false, false, false],
            [false, false, false, false],
            [false, false, true, false],
            [false, false, true, false],
            [false, false, true, false],
            [false, false, true, false],
            [true, false, true, false],
            [true, false, false, true],
            [true, false, false, true],
            [false, false, false, false],
            [false, false, false, false],
            [false, false, false, false],
            [false, false, false, false],
        ];

    private static readonly displacementX: number[] = [1, 0, -1, 0];
    private static readonly displacementY: number[] = [0, -1, 0, 1];
    private static readonly diagonalDisplacementX: number[] = [1, -1, -1, 1];
    private static readonly diagonalDisplacementY: number[] = [-1, -1, 1, 1];

    static readonly WATER_OVERLAY_ID = 5;

    private readonly terrainSquareScratch = new TerrainSquareDecodeScratch();

    newTerrainFormat: boolean;

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly underlayTypeLoader: FloorTypeLoader,
        readonly overlayTypeLoader: OverlayFloorTypeLoader,
        readonly locTypeLoader: LocTypeLoader,
        readonly textureLoader: TextureLoader,
        readonly locModelLoader: LocModelLoader,
    ) {
        this.newTerrainFormat =
            this.cacheInfo.game === GameType.Oldschool && this.cacheInfo.revision >= 209;
    }

    static fillEmptyTerrain(info: CacheInfo): boolean {
        return info.game === GameType.Runescape && info.revision <= 225;
    }

    loadEmptyTerrain(
        scene: Scene,
        level: number,
        tileX: number,
        tileY: number,
        sizeX: number,
        sizeY: number,
    ): void {
        const fillEmptyTerrain = SceneBuilder.fillEmptyTerrain(this.cacheInfo);
        for (let ty = tileY; ty < tileY + sizeY; ty++) {
            for (let tx = tileX; tx < tileX + sizeX; tx++) {
                if (tx >= 0 && tx < scene.sizeX && ty >= 0 && ty < scene.sizeY) {
                    if (level === 0) {
                        scene.tileHeights[level][tx][ty] = 0;
                        if (fillEmptyTerrain) {
                            scene.tileOverlays[level][tx][ty] = SceneBuilder.WATER_OVERLAY_ID + 1;
                        }
                    } else {
                        scene.tileHeights[level][tx][ty] =
                            scene.tileHeights[level - 1][tx][ty] - Scene.UNITS_LEVEL_HEIGHT;
                    }
                }
            }
        }
        if (tileX > 0 && scene.sizeX > tileX) {
            for (let ty = tileY + 1; ty < tileY + sizeY; ty++) {
                if (ty >= 0 && ty < scene.sizeY) {
                    scene.tileHeights[level][tileX][ty] = scene.tileHeights[level][tileX - 1][ty];
                }
            }
        }
        if (tileY > 0 && scene.sizeY > tileY) {
            for (let tx = tileX + 1; tx < tileX + sizeX; tx++) {
                if (tx >= 0 && tx < scene.sizeX) {
                    scene.tileHeights[level][tx][tileY] = scene.tileHeights[level][tx][tileY - 1];
                }
            }
        }
        if (tileX >= 0 && tileY >= 0 && tileX < scene.sizeX && tileY < scene.sizeY) {
            if (level !== 0) {
                if (
                    tileX > 0 &&
                    scene.tileHeights[level][tileX - 1][tileY] !==
                        scene.tileHeights[level - 1][tileX - 1][tileY]
                ) {
                    scene.tileHeights[level][tileX][tileY] =
                        scene.tileHeights[level][tileX - 1][tileY];
                } else if (
                    tileY <= 0 ||
                    scene.tileHeights[level][tileX][tileY - 1] ===
                        scene.tileHeights[level - 1][tileX][tileY - 1]
                ) {
                    if (
                        tileX > 0 &&
                        tileY > 0 &&
                        scene.tileHeights[level][tileX - 1][tileY - 1] !==
                            scene.tileHeights[level - 1][tileX - 1][tileY - 1]
                    ) {
                        scene.tileHeights[level][tileX][tileY] =
                            scene.tileHeights[level][tileX - 1][tileY - 1];
                    }
                } else {
                    scene.tileHeights[level][tileX][tileY] =
                        scene.tileHeights[level][tileX][tileY - 1];
                }
            } else if (tileX > 0 && scene.tileHeights[level][tileX - 1][tileY] !== 0) {
                scene.tileHeights[level][tileX][tileY] = scene.tileHeights[level][tileX - 1][tileY];
            } else if (tileY > 0 && scene.tileHeights[level][tileX][tileY - 1] !== 0) {
                scene.tileHeights[level][tileX][tileY] = scene.tileHeights[level][tileX][tileY - 1];
            } else if (
                tileX > 0 &&
                tileY > 0 &&
                scene.tileHeights[level][tileX - 1][tileY - 1] !== 0
            ) {
                scene.tileHeights[level][tileX][tileY] =
                    scene.tileHeights[level][tileX - 1][tileY - 1];
            }
        }
    }

    decodeTerrain(
        scene: Scene,
        data: Uint8Array,
        offsetX: number,
        offsetY: number,
        baseX: number,
        baseY: number,
    ): void {
        decodeTerrainSquareFromBytesInto(
            this.terrainSquareScratch,
            data,
            this.newTerrainFormat,
            baseX + offsetX,
            baseY + offsetY,
        );
        applyDecodedTerrainSquareToScene(scene, this.terrainSquareScratch, offsetX, offsetY);
    }

    decodeLocs(
        scene: Scene,
        data: Uint8Array,
        offsetX: number,
        offsetY: number,
        locLoadType: LocLoadType,
    ): void {
        const placements = decodeLocPlacementsFromBytes(data);
        for (const placement of placements) {
            const sceneX = placement.localX + offsetX;
            const sceneY = placement.localY + offsetY;

            if (sceneX > 0 && sceneY > 0 && sceneX < scene.sizeX - 1 && sceneY < scene.sizeY - 1) {
                let transformedLevel = placement.level;
                if ((scene.tileRenderFlags[1][sceneX][sceneY] & TileRenderFlag.Bridge) !== 0) {
                    transformedLevel = placement.level - 1;
                }

                let collisionMap: CollisionMap | undefined = undefined;
                if (transformedLevel >= 0) {
                    collisionMap = scene.collisionMaps[transformedLevel];
                }

                this.addLoc(
                    scene,
                    placement.level,
                    sceneX,
                    sceneY,
                    placement.id,
                    placement.type,
                    placement.rotation,
                    collisionMap,
                    locLoadType,
                );
            }
        }
    }

    addLoc(
        scene: Scene,
        level: number,
        tileX: number,
        tileY: number,
        id: number,
        type: LocModelType,
        rotation: number,
        collisionMap: CollisionMap | undefined,
        locLoadType: LocLoadType,
    ): void {
        const locResult = this.locTypeLoader.tryLoad(id);
        if (!locResult.ok) {
            return;
        }
        const locType = locResult.value;

        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (rotation === 1 || rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }
        let startX: number;
        let endX: number;
        if (tileX + sizeX <= scene.sizeX) {
            startX = (sizeX >> 1) + tileX;
            const sizeXPlus1 = sizeX + 1;
            endX = (sizeXPlus1 >> 1) + tileX;
        } else {
            startX = tileX;
            endX = tileX + 1;
        }

        let startY: number;
        let endY: number;
        if (tileY + sizeY <= scene.sizeY) {
            startY = (sizeY >> 1) + tileY;
            const sizeYPlus1 = sizeY + 1;
            endY = tileY + (sizeYPlus1 >> 1);
        } else {
            startY = tileY;
            endY = tileY + 1;
        }

        const heightMap = scene.tileHeights[level];
        let heightMapAbove: Int32Array[] | undefined;
        if (level < scene.levels - 1) {
            heightMapAbove = scene.tileHeights[level + 1];
        }

        const centerHeightSum =
            heightMap[endX][endY] +
            heightMap[startX][endY] +
            heightMap[startX][startY] +
            heightMap[endX][startY];
        const centerHeight = centerHeightSum >> 2;
        const entityX = (tileX << 7) + (sizeX << 6);
        const entityY = (tileY << 7) + (sizeY << 6);

        const tag = calculateEntityTag(
            tileX,
            tileY,
            EntityType.LOC,
            locType.isInteractive === 0,
            id,
        );

        let flags = packLocPlacement(type, rotation);
        if (locType.supportItems === 1) {
            flags += 256;
        }

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType as ContourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: entityX,
            entityY: centerHeight,
            entityZ: entityY,
        };

        let seqId = locType.seqId;
        if (seqId === -1 && locType.randomSeqIds && locType.randomSeqIds.length > 0) {
            seqId = locType.randomSeqIds[0];
            // seqId = locType.randomSeqIds[(Math.random() * locType.randomSeqIds.length) | 0];
        }

        const isEntity =
            seqId !== -1 ||
            locType.transforms !== undefined ||
            locLoadType === LocLoadType.NO_MODELS;

        if (type === LocModelType.FLOOR_DECORATION) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newFloorDecoration(level, tileX, tileY, centerHeight, entity, tag, flags);
            if (locType.clipType === 1 && collisionMap) {
                collisionMap.setBlockedByFloorDec(tileX, tileY);
            }
        } else if (type === LocModelType.NORMAL || type === LocModelType.NORMAL_DIAGIONAL) {
            const locRotation = type === LocModelType.NORMAL ? rotation : rotation + 4;
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.NORMAL,
                    locRotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.NORMAL,
                    locRotation,
                    contourGroundInfo,
                );
            }

            if (entity) {
                const added = scene.newLoc(
                    level,
                    tileX,
                    tileY,
                    centerHeight,
                    sizeX,
                    sizeY,
                    entity,
                    0,
                    tag,
                    flags,
                );
                if (added && locType.clipped) {
                    let lightOcclusion = 15;
                    const xzRadius = entity.tryGetXZRadius();
                    if (xzRadius !== null) {
                        lightOcclusion = Math.trunc(xzRadius / 4);
                        if (lightOcclusion > 30) {
                            lightOcclusion = 30;
                        }
                    }

                    for (let sx = tileX; sx <= tileX + sizeX; sx++) {
                        for (let sy = tileY; sy <= tileY + sizeY; sy++) {
                            const currentOcclusion = scene.tileLightOcclusions[level][sx][sy];
                            if (lightOcclusion > currentOcclusion) {
                                scene.tileLightOcclusions[level][sx][sy] = lightOcclusion;
                            }
                        }
                    }
                }
            }

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addLoc(tileX, tileY, sizeX, sizeY, locType.blocksProjectile);
            }
        } else if (type >= LocModelType.ROOF_SLOPED) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newLoc(level, tileX, tileY, centerHeight, 1, 1, entity, 0, tag, flags);
        } else if (type === LocModelType.WALL) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity, undefined, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (locType.decorDisplacement !== LocType.DEFAULT_DECOR_DISPLACEMENT) {
                scene.updateWallDecorationDisplacement(
                    level,
                    tileX,
                    tileY,
                    locType.decorDisplacement,
                );
            }

            if (rotation === 0) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                }
            } else if (rotation === 1) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                }
            } else if (rotation === 2) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                }
            } else if (rotation === 3) {
                if (locType.clipped) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                }
            }
        } else if (type === LocModelType.WALL_TRI_CORNER) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity, undefined, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (locType.clipped) {
                if (rotation === 0) {
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                } else if (rotation === 1) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                } else if (rotation === 2) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                } else if (rotation === 3) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                }
            }
        } else if (type === LocModelType.WALL_CORNER) {
            const rotationPlus1 = rotation + 1;
            const rotationNext = rotationPlus1 & 3;
            let entity0: Entity | undefined;
            let entity1: Entity | undefined;
            if (isEntity) {
                entity0 = new LocEntity(
                    id,
                    type,
                    rotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
                entity1 = new LocEntity(
                    id,
                    type,
                    rotationNext,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity0 = this.locModelLoader.getModel(
                    locType,
                    type,
                    rotation + 4,
                    contourGroundInfo,
                );
                entity1 = this.locModelLoader.getModel(
                    locType,
                    type,
                    rotationNext,
                    contourGroundInfo,
                );
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity0, entity1, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (locType.decorDisplacement !== LocType.DEFAULT_DECOR_DISPLACEMENT) {
                scene.updateWallDecorationDisplacement(
                    level,
                    tileX,
                    tileY,
                    locType.decorDisplacement,
                );
            }
        } else if (type === LocModelType.WALL_RECT_CORNER) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newWall(level, tileX, tileY, centerHeight, entity, undefined, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addWall(tileX, tileY, type, rotation, locType.blocksProjectile);
            }

            if (locType.clipped) {
                if (rotation === 0) {
                    scene.tileLightOcclusions[level][tileX][tileY + 1] = 50;
                } else if (rotation === 1) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY + 1] = 50;
                } else if (rotation === 2) {
                    scene.tileLightOcclusions[level][tileX + 1][tileY] = 50;
                } else if (rotation === 3) {
                    scene.tileLightOcclusions[level][tileX][tileY] = 50;
                }
            }
        } else if (type === LocModelType.WALL_DIAGONAL) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    type,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(locType, type, rotation, contourGroundInfo);
            }

            scene.newLoc(level, tileX, tileY, centerHeight, 1, 1, entity, 0, tag, flags);

            if (locType.clipType !== 0 && collisionMap) {
                collisionMap.addLoc(tileX, tileY, sizeX, sizeY, locType.blocksProjectile);
            }

            if (locType.decorDisplacement !== LocType.DEFAULT_DECOR_DISPLACEMENT) {
                scene.updateWallDecorationDisplacement(
                    level,
                    tileX,
                    tileY,
                    locType.decorDisplacement,
                );
            }
        } else if (type === LocModelType.WALL_DECORATION_INSIDE) {
            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    contourGroundInfo,
                );
            }

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                0,
                0,
                tag,
                flags,
            );

            if (locType.decorDisplacement !== LocType.DEFAULT_DECOR_DISPLACEMENT) {
                scene.updateWallDecorationDisplacement(
                    level,
                    tileX,
                    tileY,
                    locType.decorDisplacement,
                );
            }
        } else if (type === LocModelType.WALL_DECORATION_OUTSIDE) {
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (hasEntityTag(wallTag)) {
                const wallLocResult = this.locTypeLoader.tryLoad(getIdFromTag(wallTag));
                if (wallLocResult.ok) {
                    displacement = wallLocResult.value.decorDisplacement;
                }
            }

            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation,
                    contourGroundInfo,
                );
            }

            const displacementX = displacement * SceneBuilder.displacementX[rotation];
            const displacementY = displacement * SceneBuilder.displacementY[rotation];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE) {
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT / 2;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (hasEntityTag(wallTag)) {
                const wallLocResult = this.locTypeLoader.tryLoad(getIdFromTag(wallTag));
                if (wallLocResult.ok) {
                    displacement = Math.trunc(wallLocResult.value.decorDisplacement / 2);
                }
            }

            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    contourGroundInfo,
                );
            }

            const displacementX = displacement * SceneBuilder.diagonalDisplacementX[rotation];
            const displacementY = displacement * SceneBuilder.diagonalDisplacementY[rotation];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_DIAGONAL_INSIDE) {
            const rotationPlus2 = rotation + 2;
            const insideRotation = rotationPlus2 & 3;

            let entity: Entity | undefined;
            if (isEntity) {
                entity = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    contourGroundInfo,
                );
            }

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity,
                undefined,
                0,
                0,
                tag,
                flags,
            );
        } else if (type === LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE) {
            let displacement = LocType.DEFAULT_DECOR_DISPLACEMENT / 2;
            const wallTag = scene.getWallTag(level, tileX, tileY);
            if (hasEntityTag(wallTag)) {
                const wallLocResult = this.locTypeLoader.tryLoad(getIdFromTag(wallTag));
                if (wallLocResult.ok) {
                    displacement = Math.trunc(wallLocResult.value.decorDisplacement / 2);
                }
            }

            const rotationPlus2 = rotation + 2;
            const insideRotation = rotationPlus2 & 3;

            let entity0: Entity | undefined;
            let entity1: Entity | undefined;
            if (isEntity) {
                entity0 = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
                entity1 = new LocEntity(
                    id,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    level,
                    tileX,
                    tileY,
                    seqId,
                    locType.seqRandomStart,
                );
            } else {
                entity0 = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    rotation + 4,
                    contourGroundInfo,
                );
                entity1 = this.locModelLoader.getModel(
                    locType,
                    LocModelType.WALL_DECORATION_INSIDE,
                    insideRotation + 4,
                    contourGroundInfo,
                );
            }

            const displacementX = displacement * SceneBuilder.diagonalDisplacementX[rotation];
            const displacementY = displacement * SceneBuilder.diagonalDisplacementY[rotation];

            scene.newWallDecoration(
                level,
                tileX,
                tileY,
                centerHeight,
                entity0,
                entity1,
                displacementX,
                displacementY,
                tag,
                flags,
            );
        }
    }

    blendUnderlays(scene: Scene, level: number): Int32Array[] {
        const colors: Int32Array[] = Array.from({ length: scene.sizeX }, () =>
            new Int32Array(scene.sizeY).fill(-1),
        );

        const maxSize = Math.max(scene.sizeX, scene.sizeY);

        const hues = new Int32Array(maxSize);
        const sats = new Int32Array(hues.length);
        const light = new Int32Array(hues.length);
        const mul = new Int32Array(hues.length);
        const num = new Int32Array(hues.length);

        const blendStartX = -SceneBuilder.BLEND_RADIUS;
        const blendStartY = -SceneBuilder.BLEND_RADIUS;
        const blendEndX = scene.sizeX + SceneBuilder.BLEND_RADIUS;
        const blendEndY = scene.sizeY + SceneBuilder.BLEND_RADIUS;

        for (let xi = blendStartX; xi < blendEndX; xi++) {
            for (let yi = 0; yi < scene.sizeY; yi++) {
                const xEast = xi + SceneBuilder.BLEND_RADIUS;
                if (xEast >= 0 && xEast < scene.sizeX) {
                    const underlayId = scene.tileUnderlays[level][xEast][yi];
                    if (underlayId > 0) {
                        const underlayResult = this.underlayTypeLoader.tryLoad(underlayId - 1);
                        if (underlayResult.ok) {
                            const underlay = underlayResult.value;
                            hues[yi] += underlay.getHueBlend();
                            sats[yi] += underlay.saturation;
                            light[yi] += underlay.lightness;
                            mul[yi] += underlay.getHueMultiplier();
                            num[yi]++;
                        }
                    }
                }
                const xWest = xi - SceneBuilder.BLEND_RADIUS;
                if (xWest >= 0 && xWest < scene.sizeX) {
                    const underlayId = scene.tileUnderlays[level][xWest][yi];
                    if (underlayId > 0) {
                        const underlayResult = this.underlayTypeLoader.tryLoad(underlayId - 1);
                        if (underlayResult.ok) {
                            const underlay = underlayResult.value;
                            hues[yi] -= underlay.getHueBlend();
                            sats[yi] -= underlay.saturation;
                            light[yi] -= underlay.lightness;
                            mul[yi] -= underlay.getHueMultiplier();
                            num[yi]--;
                        }
                    }
                }
            }

            if (xi < 0 || xi >= scene.sizeX) {
                continue;
            }

            let runningHues = 0;
            let runningSat = 0;
            let runningLight = 0;
            let runningMultiplier = 0;
            let runningNumber = 0;

            for (let yi = blendStartY; yi < blendEndY; yi++) {
                const yNorth = yi + SceneBuilder.BLEND_RADIUS;
                if (yNorth >= 0 && yNorth < scene.sizeY) {
                    runningHues += hues[yNorth];
                    runningSat += sats[yNorth];
                    runningLight += light[yNorth];
                    runningMultiplier += mul[yNorth];
                    runningNumber += num[yNorth];
                }
                const ySouth = yi - SceneBuilder.BLEND_RADIUS;
                if (ySouth >= 0 && ySouth < scene.sizeY) {
                    runningHues -= hues[ySouth];
                    runningSat -= sats[ySouth];
                    runningLight -= light[ySouth];
                    runningMultiplier -= mul[ySouth];
                    runningNumber -= num[ySouth];
                }

                if (yi < 0 || yi >= scene.sizeX) {
                    continue;
                }

                const underlayId = scene.tileUnderlays[level][xi][yi];

                if (underlayId > 0) {
                    const avgHue = Math.trunc((runningHues * 256) / runningMultiplier);
                    const avgSat = Math.trunc(runningSat / runningNumber);
                    const avgLight = Math.trunc(runningLight / runningNumber);

                    colors[xi][yi] = packHsl(avgHue, avgSat, avgLight);
                }
            }
        }

        return colors;
    }

    private overlayBlendPriority(overlay: OverlayFloorType): number {
        if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision >= 667) {
            return Math.trunc(overlay.blendPriority);
        }
        // Most other caches don't expose an explicit blend priority; treat as equal priority.
        return 0;
    }

    private getOverlayEdgeEligibility(
        shape: number,
        rotation: number,
        blendable: boolean,
    ): boolean[] {
        const table = blendable
            ? SceneBuilder.BLENDABLE_OVERLAY_NEIGHBOR_EDGE_ELIGIBILITY_BY_SHAPE
            : SceneBuilder.NON_BLENDABLE_OVERLAY_NEIGHBOR_EDGE_ELIGIBILITY_BY_SHAPE;
        const local = table[shape] ?? [false, false, false, false];

        // Apply rotation to align shape-local edges to world edges.
        // rotation is clockwise in terrain decode; this mapping is best-effort and matches the 667 pattern usage.
        const world = [false, false, false, false];
        for (let worldEdge = 0; worldEdge < 4; worldEdge++) {
            const localEdgeIndex = worldEdge - rotation;
            const localEdge = localEdgeIndex & 3;
            world[worldEdge] = local[localEdge];
        }
        return world;
    }

    private tryLoadOverlayCached(
        cache: Map<number, OverlayFloorType | null>,
        overlayId: number,
    ): OverlayFloorType | undefined {
        const cached = cache.get(overlayId);
        if (cached !== undefined) {
            return cached ?? undefined;
        }
        const result = this.overlayTypeLoader.tryLoad(overlayId);
        if (!result.ok) {
            cache.set(overlayId, null);
            return undefined;
        }
        cache.set(overlayId, result.value);
        return result.value;
    }

    private fillOverlaySample(
        out: OverlayCornerSet | OverlayEdgeSet,
        index: number,
        overlay: OverlayFloorType,
        textureLoader: TextureLoader,
        preferBlendColour: boolean,
    ): void {
        let textureId = overlay.textureId;
        if (!(textureId !== -1 && textureLoader.isSd(textureId))) {
            textureId = overlay.secondaryTextureId;
            if (!(textureId !== -1 && textureLoader.isSd(textureId))) {
                textureId = -1;
            }
        }

        out.textureId[index] = textureId;
        out.textureSize[index] = Math.max(1, Math.trunc(overlay.textureSize || 128));

        if (textureId !== -1) {
            out.baseHsl[index] = -1;
            out.minimapHsl[index] = textureLoader.getAverageHsl(textureId);
            return;
        }

        const baseHsl =
            preferBlendColour && overlay.blendHsl !== -1 ? overlay.blendHsl : overlay.primaryHsl;
        out.baseHsl[index] = baseHsl;
        out.minimapHsl[index] = baseHsl;

        if (overlay.secondaryRgb !== -1) {
            out.minimapHsl[index] = packHsl(
                overlay.secondaryHue,
                overlay.secondarySaturation,
                overlay.secondaryLightness,
            );
        }
    }

    private chooseOverlayForCorner(
        overlayCache: Map<number, OverlayFloorType | null>,
        scene: Scene,
        level: number,
        candidates: readonly [number, number][],
        currentOverlayId: number,
        currentOverlayBlendable: boolean,
    ): OverlayFloorType | undefined {
        let best: OverlayFloorType | undefined;
        let bestPriority = -1;
        let bestIsCurrent = false;

        for (const [x, y] of candidates) {
            if (x < 0 || y < 0 || x >= scene.sizeX || y >= scene.sizeY) {
                continue;
            }
            const overlayId = scene.tileOverlays[level][x][y] - 1;
            if (overlayId < 0) {
                continue;
            }
            const overlay = this.tryLoadOverlayCached(overlayCache, overlayId);
            if (!overlay) {
                continue;
            }

            const isCurrent = overlayId === currentOverlayId;
            // Only blend from neighbors when the *current* overlay supports blending, and the neighbor is blendable too.
            if (!isCurrent && (!currentOverlayBlendable || !overlay.blendable)) {
                continue;
            }

            const priority = this.overlayBlendPriority(overlay);
            if (
                !best ||
                priority > bestPriority ||
                (priority === bestPriority && isCurrent && !bestIsCurrent)
            ) {
                best = overlay;
                bestPriority = priority;
                bestIsCurrent = isCurrent;
            }
        }

        // Ensure we always have a deterministic fallback.
        if (!best) {
            best = this.tryLoadOverlayCached(overlayCache, currentOverlayId);
        }
        return best;
    }

    addTileModels(scene: Scene, smoothUnderlays: boolean): void {
        const heights = scene.tileHeights;
        const underlayIds = scene.tileUnderlays;
        const overlayIds = scene.tileOverlays;
        const tileShapes = scene.tileShapes;
        const tileRotations = scene.tileRotations;

        const textureLoader = this.textureLoader;
        const overlayCache = new Map<number, OverlayFloorType | null>();

        const primaryCornersScratch: OverlayCornerSet = {
            baseHsl: new Int32Array(4),
            minimapHsl: new Int32Array(4),
            textureId: new Int32Array(4),
            textureSize: new Int32Array(4),
        };
        const primaryEdgesScratch: OverlayEdgeSet = {
            baseHsl: new Int32Array(4),
            minimapHsl: new Int32Array(4),
            textureId: new Int32Array(4),
            textureSize: new Int32Array(4),
        };
        for (let level = 0; level < scene.levels; level++) {
            const blendedColors = this.blendUnderlays(scene, level);
            const lights = scene.calculateTileLights(level);

            for (let x = 1; x < scene.sizeX - 1; x++) {
                for (let y = 1; y < scene.sizeY - 1; y++) {
                    const underlayId = underlayIds[level][x][y] - 1;
                    const overlayId = overlayIds[level][x][y] - 1;

                    let overlayPrimaryCorners: OverlayCornerSet | undefined = undefined;
                    let overlayPrimaryEdges: OverlayEdgeSet | undefined = undefined;

                    if (overlayId !== -1) {
                        const overlayType = this.tryLoadOverlayCached(overlayCache, overlayId);
                        if (overlayType) {
                            // Note: `hideUnderlay` is used by some clients for occlusion decisions, not for changing
                            // which faces are underlay vs overlay. The viewer doesn't implement tile occluders yet,
                            // so we ignore it for terrain rendering.
                            overlayPrimaryCorners = primaryCornersScratch;
                            overlayPrimaryEdges = primaryEdgesScratch;

                            const edgeEligibility = this.getOverlayEdgeEligibility(
                                tileShapes[level][x][y],
                                tileRotations[level][x][y] & 0x3,
                                overlayType.blendable,
                            );
                            const canBlendSouth = edgeEligibility[0];
                            const canBlendEast = edgeEligibility[1];
                            const canBlendNorth = edgeEligibility[2];
                            const canBlendWest = edgeEligibility[3];

                            // Corner order: SW, SE, NE, NW
                            const sw = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [
                                    [x, y],
                                    ...(canBlendWest ? [[x - 1, y] as [number, number]] : []),
                                    ...(canBlendSouth ? [[x, y - 1] as [number, number]] : []),
                                    ...(canBlendWest || canBlendSouth
                                        ? [[x - 1, y - 1] as [number, number]]
                                        : []),
                                ],
                                overlayId,
                                overlayType.blendable,
                            );
                            const se = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [
                                    [x, y],
                                    ...(canBlendEast ? [[x + 1, y] as [number, number]] : []),
                                    ...(canBlendSouth ? [[x, y - 1] as [number, number]] : []),
                                    ...(canBlendEast || canBlendSouth
                                        ? [[x + 1, y - 1] as [number, number]]
                                        : []),
                                ],
                                overlayId,
                                overlayType.blendable,
                            );
                            const ne = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [
                                    [x, y],
                                    ...(canBlendEast ? [[x + 1, y] as [number, number]] : []),
                                    ...(canBlendNorth ? [[x, y + 1] as [number, number]] : []),
                                    ...(canBlendEast || canBlendNorth
                                        ? [[x + 1, y + 1] as [number, number]]
                                        : []),
                                ],
                                overlayId,
                                overlayType.blendable,
                            );
                            const nw = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [
                                    [x, y],
                                    ...(canBlendWest ? [[x - 1, y] as [number, number]] : []),
                                    ...(canBlendNorth ? [[x, y + 1] as [number, number]] : []),
                                    ...(canBlendWest || canBlendNorth
                                        ? [[x - 1, y + 1] as [number, number]]
                                        : []),
                                ],
                                overlayId,
                                overlayType.blendable,
                            );

                            this.fillOverlaySample(
                                primaryCornersScratch,
                                0,
                                sw ?? overlayType,
                                textureLoader,
                                (sw?.id ?? overlayType.id) !== overlayType.id,
                            );
                            this.fillOverlaySample(
                                primaryCornersScratch,
                                1,
                                se ?? overlayType,
                                textureLoader,
                                (se?.id ?? overlayType.id) !== overlayType.id,
                            );
                            this.fillOverlaySample(
                                primaryCornersScratch,
                                2,
                                ne ?? overlayType,
                                textureLoader,
                                (ne?.id ?? overlayType.id) !== overlayType.id,
                            );
                            this.fillOverlaySample(
                                primaryCornersScratch,
                                3,
                                nw ?? overlayType,
                                textureLoader,
                                (nw?.id ?? overlayType.id) !== overlayType.id,
                            );

                            const south = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [
                                    [x, y],
                                    ...(canBlendSouth ? [[x, y - 1] as [number, number]] : []),
                                ],
                                overlayId,
                                overlayType.blendable,
                            );
                            const east = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [[x, y], ...(canBlendEast ? [[x + 1, y] as [number, number]] : [])],
                                overlayId,
                                overlayType.blendable,
                            );
                            const north = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [
                                    [x, y],
                                    ...(canBlendNorth ? [[x, y + 1] as [number, number]] : []),
                                ],
                                overlayId,
                                overlayType.blendable,
                            );
                            const west = this.chooseOverlayForCorner(
                                overlayCache,
                                scene,
                                level,
                                [[x, y], ...(canBlendWest ? [[x - 1, y] as [number, number]] : [])],
                                overlayId,
                                overlayType.blendable,
                            );

                            this.fillOverlaySample(
                                primaryEdgesScratch,
                                0,
                                south ?? overlayType,
                                textureLoader,
                                (south?.id ?? overlayType.id) !== overlayType.id,
                            );
                            this.fillOverlaySample(
                                primaryEdgesScratch,
                                1,
                                east ?? overlayType,
                                textureLoader,
                                (east?.id ?? overlayType.id) !== overlayType.id,
                            );
                            this.fillOverlaySample(
                                primaryEdgesScratch,
                                2,
                                north ?? overlayType,
                                textureLoader,
                                (north?.id ?? overlayType.id) !== overlayType.id,
                            );
                            this.fillOverlaySample(
                                primaryEdgesScratch,
                                3,
                                west ?? overlayType,
                                textureLoader,
                                (west?.id ?? overlayType.id) !== overlayType.id,
                            );
                        }
                    }

                    const tileModel = computeSceneTileModelForTile({
                        x,
                        y,
                        heightSw: heights[level][x][y],
                        heightSe: heights[level][x + 1][y],
                        heightNe: heights[level][x + 1][y + 1],
                        heightNw: heights[level][x][y + 1],
                        lightSw: lights[x][y],
                        lightSe: lights[x + 1][y],
                        lightNe: lights[x + 1][y + 1],
                        lightNw: lights[x][y + 1],
                        underlayId,
                        overlayId,
                        tileShape: tileShapes[level][x][y],
                        tileRotation: tileRotations[level][x][y],
                        smoothUnderlays,
                        blendedColors,
                        underlayTypeLoader: this.underlayTypeLoader,
                        overlayTypeLoader: this.overlayTypeLoader,
                        textureLoader: this.textureLoader,
                        overlayPrimaryCorners,
                        overlayPrimaryEdges,
                    });
                    if (!tileModel) {
                        continue;
                    }

                    scene.newTileModel(level, x, y, tileModel);
                }
            }
        }
    }

    // Npc spawn decoding moved to `decodeNpcSpawnsFromBytes` helper.
}
