import { MergeNormalsScratch, ModelData, isModelData } from "../model/ModelData";
import { TextureLoader } from "../texture/TextureLoader";
import { CollisionMap } from "./CollisionMap";
import { FloorDecoration } from "./FloorDecoration";
import { Loc } from "./Loc";
import { SceneTile } from "./SceneTile";
import { SceneTileModel } from "./SceneTileModel";
import { Wall } from "./Wall";
import { WallDecoration } from "./WallDecoration";
import { Entity } from "./entity/Entity";
import { ENTITY_TAG_NONE, EntityTag, EntityType, getEntityTypeFromTag } from "./entity/EntityTag";

const MAX_LOC_PER_TILE = 5;

export enum TileRenderFlag {
    Blocked = 0x1,
    Bridge = 0x2,
    Inside = 0x4,
    RenderOnLowerLevel = 0x8,
    ExcludeFromPlayerLevel = 0x10,
    Unknown0x20 = 0x20,
}

export type TileRotation = 0 | 1 | 2 | 3;
export type TileShapeId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export class Scene {
    private readonly mergeNormalsScratch = new MergeNormalsScratch();
    static readonly MAX_LEVELS = 4;
    static readonly MAP_SQUARE_SIZE = 64;

    static readonly UNITS_LEVEL_HEIGHT = 240;
    static readonly UNITS_TILE_HEIGHT_BASIS = 8;

    // Tiles
    tiles: SceneTile[][][];
    collisionMaps: CollisionMap[];

    // Terrain
    tileHeights: Int32Array[][];

    tileRenderFlags: Uint8Array[][];
    tileUnderlays: Uint16Array[][];
    tileOverlays: Int16Array[][];
    tileShapes: Uint8Array[][];
    tileRotations: Uint8Array[][];

    // Terrain light
    tileLightOcclusions: Uint8Array[][];

    constructor(
        readonly levels: number,
        readonly sizeX: number,
        readonly sizeY: number,
    ) {
        this.tiles = Array.from({ length: levels }, () => undefined as unknown as SceneTile[][]);
        this.collisionMaps = Array.from(
            { length: levels },
            () => undefined as unknown as CollisionMap,
        );

        this.tileHeights = Array.from(
            { length: levels },
            () => undefined as unknown as Int32Array[],
        );
        this.tileRenderFlags = Array.from(
            { length: levels },
            () => undefined as unknown as Uint8Array[],
        );
        this.tileUnderlays = Array.from(
            { length: levels },
            () => undefined as unknown as Uint16Array[],
        );
        this.tileOverlays = Array.from(
            { length: levels },
            () => undefined as unknown as Int16Array[],
        );
        this.tileShapes = Array.from(
            { length: levels },
            () => undefined as unknown as Uint8Array[],
        );
        this.tileRotations = Array.from(
            { length: levels },
            () => undefined as unknown as Uint8Array[],
        );

        this.tileLightOcclusions = Array.from(
            { length: levels },
            () => undefined as unknown as Uint8Array[],
        );
        for (let l = 0; l < levels; l++) {
            this.tiles[l] = Array.from(
                { length: this.sizeX },
                () => undefined as unknown as SceneTile[],
            );
            this.collisionMaps[l] = new CollisionMap(this.sizeX, this.sizeY);
            this.tileHeights[l] = Array.from(
                { length: this.sizeX + 1 },
                () => undefined as unknown as Int32Array,
            );
            this.tileRenderFlags[l] = Array.from(
                { length: this.sizeX },
                () => undefined as unknown as Uint8Array,
            );
            this.tileUnderlays[l] = Array.from(
                { length: this.sizeX },
                () => undefined as unknown as Uint16Array,
            );
            this.tileOverlays[l] = Array.from(
                { length: this.sizeX },
                () => undefined as unknown as Int16Array,
            );
            this.tileShapes[l] = Array.from(
                { length: this.sizeX },
                () => undefined as unknown as Uint8Array,
            );
            this.tileRotations[l] = Array.from(
                { length: this.sizeX },
                () => undefined as unknown as Uint8Array,
            );
            this.tileLightOcclusions[l] = Array.from(
                { length: this.sizeX + 1 },
                () => undefined as unknown as Uint8Array,
            );
            for (let x = 0; x < this.sizeX; x++) {
                this.tiles[l][x] = Array.from(
                    { length: this.sizeY },
                    () => undefined as unknown as SceneTile,
                );
                this.tileRenderFlags[l][x] = new Uint8Array(this.sizeY);
                this.tileUnderlays[l][x] = new Uint16Array(this.sizeY);
                this.tileOverlays[l][x] = new Int16Array(this.sizeY);
                this.tileShapes[l][x] = new Uint8Array(this.sizeY);
                this.tileRotations[l][x] = new Uint8Array(this.sizeY);
            }
            for (let x = 0; x < this.sizeX + 1; x++) {
                this.tileHeights[l][x] = new Int32Array(this.sizeY + 1);
                this.tileLightOcclusions[l][x] = new Uint8Array(this.sizeY + 1);
            }
        }
    }

    isWithinBounds(level: number, tileX: number, tileY: number): boolean {
        return (
            level >= 0 &&
            level < this.levels &&
            tileX >= 0 &&
            tileX < this.sizeX &&
            tileY >= 0 &&
            tileY < this.sizeY
        );
    }

    ensureTileExists(startLevel: number, endLevel: number, tileX: number, tileY: number) {
        for (let i = startLevel; i <= endLevel; i++) {
            if (!this.tiles[i][tileX][tileY]) {
                this.tiles[i][tileX][tileY] = new SceneTile(i, tileX, tileY);
            }
        }
    }

    newFloorDecoration(
        level: number,
        tileX: number,
        tileY: number,
        height: number,
        entity: Entity | undefined,
        tag: EntityTag,
        flags: number,
    ): void {
        if (entity) {
            const x = tileX * 128 + 64;
            const y = tileY * 128 + 64;

            const floorDecoration = new FloorDecoration(entity, x, y, height, tag, flags);

            this.ensureTileExists(level, level, tileX, tileY);

            this.tiles[level][tileX][tileY].floorDecoration = floorDecoration;
        }
    }

    newLoc(
        level: number,
        tileX: number,
        tileY: number,
        height: number,
        sizeX: number,
        sizeY: number,
        entity: Entity | undefined,
        rotation: number,
        tag: EntityTag,
        flags: number,
    ): boolean {
        if (entity) {
            const centerX = tileX * 128 + 64 * sizeX;
            const centerY = tileY * 128 + 64 * sizeY;
            return this.newLoc0(
                level,
                tileX,
                tileY,
                sizeX,
                sizeY,
                centerX,
                centerY,
                height,
                entity,
                rotation,
                tag,
                flags,
            );
        }
        return true;
    }

    private newLoc0(
        level: number,
        tileX: number,
        tileY: number,
        sizeX: number,
        sizeY: number,
        centerX: number,
        centerY: number,
        height: number,
        entity: Entity,
        rotation: number,
        tag: EntityTag,
        flags: number,
    ): boolean {
        const startX = tileX;
        const startY = tileY;
        const endX = tileX + sizeX - 1;
        const endY = tileY + sizeY - 1;

        for (let sx = startX; sx <= endX; sx++) {
            for (let sy = startY; sy <= endY; sy++) {
                if (sx < 0 || sy < 0 || sx >= this.sizeX || sy >= this.sizeY) {
                    return false;
                }
                const tile = this.tiles[level][sx][sy];
                if (tile && tile.locs.length >= MAX_LOC_PER_TILE) {
                    return false;
                }
            }
        }

        const loc = new Loc(
            tag,
            flags,
            level,
            centerX,
            centerY,
            height,
            entity,
            rotation,
            startX,
            startY,
            endX,
            endY,
        );

        for (let sx = startX; sx <= endX; sx++) {
            for (let sy = startY; sy <= endY; sy++) {
                this.ensureTileExists(0, level, sx, sy);

                this.tiles[level][sx][sy].locs.push(loc);
            }
        }

        return true;
    }

    newWall(
        level: number,
        tileX: number,
        tileY: number,
        centerHeight: number,
        entity0: Entity | undefined,
        entity1: Entity | undefined,
        tag: EntityTag,
        flags: number,
    ): void {
        if (!entity0 && !entity1) {
            return;
        }

        const x = tileX * 128 + 64;
        const y = tileY * 128 + 64;

        const wall = new Wall(tag, flags, x, y, centerHeight, entity0, entity1);

        this.ensureTileExists(0, level, tileX, tileY);

        this.tiles[level][tileX][tileY].wall = wall;
    }

    newWallDecoration(
        level: number,
        tileX: number,
        tileY: number,
        centerHeight: number,
        entity0: Entity | undefined,
        entity1: Entity | undefined,
        offsetX: number,
        offsetY: number,
        tag: bigint,
        flags: number,
    ) {
        if (entity0) {
            const x = tileX * 128 + 64;
            const y = tileY * 128 + 64;

            const wallDecoration = new WallDecoration(
                tag,
                flags,
                x,
                y,
                centerHeight,
                entity0,
                entity1,
                offsetX,
                offsetY,
            );

            this.ensureTileExists(0, level, tileX, tileY);

            this.tiles[level][tileX][tileY].wallDecoration = wallDecoration;
        }
    }

    updateWallDecorationDisplacement(
        level: number,
        tileX: number,
        tileY: number,
        displacement: number,
    ) {
        const tile = this.tiles[level][tileX][tileY];
        if (tile && tile.wallDecoration) {
            const decor = tile.wallDecoration;
            decor.offsetX = Math.trunc((displacement * decor.offsetX) / 16);
            decor.offsetY = Math.trunc((displacement * decor.offsetY) / 16);
        }
    }

    getWallTag(level: number, tileX: number, tileY: number): EntityTag {
        const tile = this.tiles[level][tileX][tileY];
        return (tile && tile.wall && tile.wall.tag) ?? ENTITY_TAG_NONE;
    }

    getLocTag(level: number, tileX: number, tileY: number): EntityTag {
        const tile = this.tiles[level][tileX][tileY];
        if (!tile) {
            return ENTITY_TAG_NONE;
        }

        for (const loc of tile.locs) {
            const entityType = getEntityTypeFromTag(loc.tag);
            if (entityType === EntityType.LOC && tileX === loc.startX && tileY === loc.startY) {
                return loc.tag;
            }
        }

        return ENTITY_TAG_NONE;
    }

    getFloorDecorationTag(level: number, tileX: number, tileY: number): EntityTag {
        const tile = this.tiles[level][tileX][tileY];
        return (tile && tile.floorDecoration && tile.floorDecoration.tag) ?? ENTITY_TAG_NONE;
    }

    getLocFlags(level: number, tileX: number, tileY: number, tag: EntityTag): number {
        const tile = this.tiles[level][tileX][tileY];
        if (!tile) {
            return -1;
        }

        if (tile.wall && tile.wall.tag === tag) {
            return tile.wall.flags & 0xff;
        } else if (tile.wallDecoration && tile.wallDecoration.tag === tag) {
            return tile.wallDecoration.flags & 0xff;
        } else if (tile.floorDecoration && tile.floorDecoration.tag === tag) {
            return tile.floorDecoration.flags & 0xff;
        } else {
            for (const loc of tile.locs) {
                if (loc.tag === tag) {
                    return loc.flags & 0xff;
                }
            }

            return -1;
        }
    }

    calculateTileLights(level: number, ignoreTileLightOcclusion: boolean = false): Int32Array[] {
        const lights: Int32Array[] = Array.from(
            { length: this.sizeX },
            () => new Int32Array(this.sizeY),
        );

        const LIGHT_DIR_X = -50;
        const LIGHT_DIR_Y = -10;
        const LIGHT_DIR_Z = -50;
        const LIGHT_INTENSITY_BASE = 96;
        const LIGHT_INTENSITY_FACTOR = 768;
        const HEIGHT_SCALE = 65536;

        const lightMagnitude = Math.trunc(
            Math.sqrt(
                LIGHT_DIR_X * LIGHT_DIR_X + LIGHT_DIR_Y * LIGHT_DIR_Y + LIGHT_DIR_Z * LIGHT_DIR_Z,
            ),
        );
        const lightIntensityProduct = lightMagnitude * LIGHT_INTENSITY_FACTOR;
        const lightIntensity = lightIntensityProduct >> 8;

        for (let x = 1; x < this.sizeX - 1; x++) {
            for (let y = 1; y < this.sizeY - 1; y++) {
                // First we need to calculate the normals for each tile.
                // This is typically by doing a cross product on the tangent vectors which can be derived from
                // the differences in height between adjacent tiles.
                // The code below seems to be calculating the normals directly by skipping the cross product.

                const heightDeltaX =
                    this.tileHeights[level][x + 1][y] - this.tileHeights[level][x - 1][y];
                const heightDeltaY =
                    this.tileHeights[level][x][y + 1] - this.tileHeights[level][x][y - 1];

                const tileNormalLength = Math.trunc(
                    Math.sqrt(
                        heightDeltaY * heightDeltaY + heightDeltaX * heightDeltaX + HEIGHT_SCALE,
                    ),
                );

                const normalizedTileNormalX = Math.trunc((heightDeltaX << 8) / tileNormalLength);
                const normalizedTileNormalY = Math.trunc(HEIGHT_SCALE / tileNormalLength);
                const normalizedTileNormalZ = Math.trunc((heightDeltaY << 8) / tileNormalLength);

                // Now we calculate the light contribution based on a simplified Phong model, specifically
                // we ignore the material coefficients and there are no specular contributions.

                // For reference, this is the standard Phong model:
                //  I = Ia * Ka + Id * Kd * (N dot L)
                //  I: Total intensity of light at a point on the surface.
                //  Ia: Intensity of ambient light in the scene (constant and uniform).
                //  Ka: Ambient reflection coefficient of the material.
                //  Id: Intensity of the directional (diffuse) light source.
                //  Kd: Diffuse reflection coefficient of the material.
                //  N: Normalized surface normal vector at the point.
                //  L: Normalized direction vector from the point to the light source.
                //  (N dot L): Dot product between the surface normal vector and the light direction vector.

                const dot =
                    normalizedTileNormalX * LIGHT_DIR_X +
                    normalizedTileNormalY * LIGHT_DIR_Y +
                    normalizedTileNormalZ * LIGHT_DIR_Z;
                const sunLight = Math.trunc(dot / lightIntensity + LIGHT_INTENSITY_BASE);

                // Now that we have the computed light contribution, take light occlusion from other objects
                // into account. These tile light occlusions are computed dinamically based on walls, roofs
                // and floors from neighbour tiles.
                const lightOcclusion = ignoreTileLightOcclusion
                    ? 0
                    : (this.tileLightOcclusions[level][x - 1][y] >> 2) +
                      (this.tileLightOcclusions[level][x][y - 1] >> 2) +
                      (this.tileLightOcclusions[level][x + 1][y] >> 3) +
                      (this.tileLightOcclusions[level][x][y + 1] >> 3) +
                      (this.tileLightOcclusions[level][x][y] >> 1);

                lights[x][y] = sunLight - lightOcclusion;
            }
        }

        return lights;
    }

    newTileModel(level: number, tileX: number, tileY: number, tileModel: SceneTileModel) {
        this.ensureTileExists(level, level, tileX, tileY);

        this.tiles[level][tileX][tileY].tileModel = tileModel;
    }

    getTileMinLevel(level: number, tileX: number, tileY: number): number {
        if ((this.tileRenderFlags[level][tileX][tileY] & TileRenderFlag.RenderOnLowerLevel) !== 0) {
            return 0;
        } else if (
            level > 0 &&
            (this.tileRenderFlags[level][tileX][tileY] & TileRenderFlag.Bridge) !== 0
        ) {
            return level - 1;
        } else {
            return level;
        }
    }

    setTileMinLevel(level: number, tileX: number, tileY: number, minLevel: number) {
        const tile = this.tiles[level][tileX][tileY];
        if (tile) {
            tile.minLevel = minLevel;
        }
    }

    isInside(level: number, tileX: number, tileY: number): boolean {
        return (this.tileRenderFlags[level][tileX][tileY] & TileRenderFlag.Inside) !== 0;
    }

    setTileMinLevels() {
        for (let level = 0; level < this.levels; level++) {
            for (let x = 0; x < this.sizeX; x++) {
                for (let y = 0; y < this.sizeY; y++) {
                    this.setTileMinLevel(level, x, y, this.getTileMinLevel(level, x, y));
                }
            }
        }
    }

    isPlayerLevel(level: number, tileX: number, tileY: number, playerLevel: number): boolean {
        if ((this.tileRenderFlags[0][tileX][tileY] & TileRenderFlag.Bridge) !== 0) {
            return true;
        }
        if (
            (this.tileRenderFlags[level][tileX][tileY] & TileRenderFlag.ExcludeFromPlayerLevel) !==
            0
        ) {
            return false;
        }
        return playerLevel === this.getTileMinLevel(level, tileX, tileY);
    }

    getHeightInterpolated(level: number, x: number, z: number): number {
        const heights = this.tileHeights[level];
        const tileSizeShift = 7;
        const tileSize = 1 << tileSizeShift;
        const tileMask = tileSize - 1;

        const tileX = x >> tileSizeShift;
        const tileY = z >> tileSizeShift;
        if (tileX < 0 || tileY < 0 || tileX > this.sizeX - 1 || tileY > this.sizeY - 1) {
            return 0;
        }
        const rx = x & tileMask;
        const rz = z & tileMask;
        const heightZ0Numerator =
            (tileSize - rx) * heights[tileX][tileY] + heights[1 + tileX][tileY] * rx;
        const heightZ0 = heightZ0Numerator >> tileSizeShift;
        const heightZ1Numerator =
            heights[tileX][1 + tileY] * (tileSize - rx) + heights[tileX + 1][1 + tileY] * rx;
        const heightZ1 = heightZ1Numerator >> tileSizeShift;
        const heightNumerator = rz * heightZ1 + (tileSize - rz) * heightZ0;
        return heightNumerator >> tileSizeShift;
    }

    getCenterHeight(level: number, tileX: number, tileY: number): number {
        const sum =
            this.tileHeights[level][tileX][tileY] +
            this.tileHeights[level][tileX][tileY + 1] +
            this.tileHeights[level][tileX + 1][tileY] +
            this.tileHeights[level][tileX + 1][tileY + 1];
        return sum >> 2;
    }

    getDeltaHeight(
        level0: number,
        tileX0: number,
        tileY0: number,
        level1: number,
        tileX1: number,
        tileY1: number,
    ): number {
        return (
            this.getCenterHeight(level0, tileX0, tileY0) -
            this.getCenterHeight(level1, tileX1, tileY1)
        );
    }

    mergeLargeLocNormals(
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
            if (level === this.levels) {
                continue;
            }

            for (let localX = startX; localX <= endX; localX++) {
                if (localX >= 0 && localX < this.sizeX) {
                    for (let localY = startY; localY <= endY; localY++) {
                        if (
                            localY >= 0 &&
                            localY < this.sizeY &&
                            (!hideOccluded ||
                                localX >= endX ||
                                localY >= endY ||
                                (localY < tileY && tileX !== localX))
                        ) {
                            const tile = this.tiles[level][localX][localY];
                            if (tile) {
                                const deltaHeight = this.getDeltaHeight(
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
                                            this.mergeNormalsScratch,
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
                                            this.mergeNormalsScratch,
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
                                        this.mergeNormalsScratch,
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

    mergeFloorNormals(model: Entity, level: number, tileX: number, tileY: number): void {
        const endX = tileX + 1;
        const startY = tileY - 1;
        const endY = tileY + 1;

        for (let x = tileX; x <= endX; x++) {
            if (x >= 0 && x < this.sizeX) {
                for (let y = startY; y <= endY; y++) {
                    if (y >= 0 && y < this.sizeY && (x >= endX || y >= endY)) {
                        const tile = this.tiles[level][x][y];
                        if (tile && tile.floorDecoration && tile.floorDecoration.entity) {
                            const deltaHeight = this.getDeltaHeight(
                                level,
                                x,
                                y,
                                level,
                                tileX,
                                tileY,
                            );
                            model.mergeNormals(
                                tile.floorDecoration.entity,
                                (x - tileX) * 128,
                                deltaHeight,
                                (y - tileY) * 128,
                                true,
                                this.mergeNormalsScratch,
                            );
                        }
                    }
                }
            }
        }
    }

    light(textureLoader: TextureLoader, lightX: number, lightY: number, lightZ: number): void {
        for (let level = 0; level < this.levels; level++) {
            for (let tileX = 0; tileX < this.sizeX; tileX++) {
                for (let tileY = 0; tileY < this.sizeY; tileY++) {
                    const tile = this.tiles[level][tileX][tileY];
                    if (!tile) {
                        continue;
                    }
                    const wall = tile.wall;
                    if (wall && isModelData(wall.entity0)) {
                        const model0 = wall.entity0;
                        this.mergeLargeLocNormals(model0, level, tileX, tileY, 1, 1);

                        if (isModelData(wall.entity1)) {
                            const model1 = wall.entity1;
                            this.mergeLargeLocNormals(model1, level, tileX, tileY, 1, 1);
                            model0.mergeNormals(model1, 0, 0, 0, false, this.mergeNormalsScratch);
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
                            this.mergeLargeLocNormals(
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
                        this.mergeFloorNormals(floorModel, level, tileX, tileY);
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

    setLinkBelow(tileX: number, tileY: number) {
        const tile = this.tiles[0][tileX][tileY];

        for (let i = 0; i < this.levels - 1; i++) {
            const t = (this.tiles[i][tileX][tileY] = this.tiles[i + 1][tileX][tileY]);
            if (t) {
                t.level--;

                for (const loc of t.locs) {
                    const entityType = getEntityTypeFromTag(loc.tag);
                    if (
                        entityType === EntityType.LOC &&
                        loc.startX === tileX &&
                        loc.startY === tileY
                    ) {
                        loc.level--;
                    }
                }
            }
        }

        if (!this.tiles[0][tileX][tileY]) {
            this.tiles[0][tileX][tileY] = new SceneTile(0, tileX, tileY);
        }

        this.tiles[0][tileX][tileY].linkedBelowTile = tile;
        delete this.tiles[3][tileX][tileY];
    }
}
