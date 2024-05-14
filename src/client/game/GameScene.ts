import { CollisionMap } from "../../rs/scene/CollisionMap";
import { Game } from "./Game";
import { InteractiveObject } from "./InteractiveObject";
import { Renderable } from "./renderable/Renderable";
import { array2d, array3d } from "./util/Arrays";

export class GameSceneTile {
    public plane: number;

    public x: number;
    public y: number;

    public entityCount: number = 0;

    public interactiveObjects: (InteractiveObject | null)[] = [null, null, null, null, null];
    public interactiveObjectsSize: number[] = [0, 0, 0, 0, 0];
    public interactiveObjectsSizeOR: number = 0;

    constructor(plane: number, x: number, y: number) {
        this.plane = plane;
        this.x = x;
        this.y = y;
    }
}

export class GameScene {
    tiles: (GameSceneTile | null)[][][];
    tileFlags: number[][][];
    tileRenderCount: number[][];
    intGroundArray: number[][][];
    currentCollisionMap: CollisionMap[];

    sceneSpawnRequestsCacheCurrentPos: number = 0;
    sceneSpawnRequests: (InteractiveObject | null)[] = [];

    renderCount: number = 0;

    constructor(readonly levels: number, readonly sizeX: number, readonly sizeY: number) {
        this.tiles = array3d(levels, sizeX, sizeY, null);
        this.tileFlags = array3d(levels, sizeX, sizeY, 0);
        this.tileRenderCount = array2d(sizeX, sizeY, 0);
        this.intGroundArray = array3d(levels, sizeX + 1, sizeY + 1, 0);
        this.currentCollisionMap = Array(levels).fill(null)

        for (let j: number = 0; j < levels; j++) {
            this.currentCollisionMap[j] = new CollisionMap(sizeX, sizeY);
        }
    }

    public initToNull() {
        for (let z: number = 0; z < this.levels; z++) {
            for (let x: number = 0; x < this.sizeX; x++) {
                for (let y: number = 0; y < this.sizeY; y++) {
                    this.tiles[z][x][y] = null;
                }
            }
        }
        //for (let l: number = 0; l < Scene.MAX_LEVELS; l++) {
        //     for (let j1: number = 0; j1 < Scene.anIntArray488[l]; j1++) {
        //         Scene.aSceneClusterArrayArray554[l][j1] = null;
        //     }
        //     Scene.anIntArray488[l] = 0;
        // }
        for (let i = 0; i < this.sceneSpawnRequestsCacheCurrentPos; i++) {
            this.sceneSpawnRequests[i] = null;
        }
        this.sceneSpawnRequestsCacheCurrentPos = 0;
        // for (let l1: number = 0; l1 < Scene.entityBuffer.length; l1++) {
        //     Scene.entityBuffer[l1] = null;
        // }
    }

    public addEntity(
        i: number,
        entity: Renderable,
        worldX: number,
        worldZ: number,
        accountForYaw: boolean,
        l: number,
        plane: number,
        delta: number,
        worldY: number,
        yaw: number
    ): boolean {
        if (entity == null) {
            return true;
        }
        let minX: number = worldX - delta;
        let minY: number = worldY - delta;
        let maxX: number = worldX + delta;
        let maxY: number = worldY + delta;
        if (accountForYaw) {
            if (yaw > 640 && yaw < 1408) {
                maxY += 128;
            }
            if (yaw > 1152 && yaw < 1920) {
                maxX += 128;
            }
            if (yaw > 1664 || yaw < 384) {
                minY -= 128;
            }
            if (yaw > 128 && yaw < 896) {
                minX -= 128;
            }
        }
        minX = (n => (n < 0 ? Math.ceil(n) : Math.floor(n)))(minX / 128);
        minY = (n => (n < 0 ? Math.ceil(n) : Math.floor(n)))(minY / 128);
        maxX = (n => (n < 0 ? Math.ceil(n) : Math.floor(n)))(maxX / 128);
        maxY = (n => (n < 0 ? Math.ceil(n) : Math.floor(n)))(maxY / 128);
        return this.addSceneSpawnRequest(plane, minX, minY, maxX - minX + 1, maxY - minY + 1,
            worldX, worldY, worldZ, entity, yaw, true, i, (0 as number) | 0);
    }

    public addRenderable(
        worldZ: number,
        minY: number,
        renderable: Renderable,
        minX: number,
        worldY: number,
        tileWidth: number,
        worldX: number,
        rotation: number,
        tileHeight: number,
        z: number,
        uid: number
    ): boolean {
        if (renderable == null) {
            return true;
        } else {
            return this.addSceneSpawnRequest(z, minX, minY, tileHeight - minX + 1, tileWidth - minY + 1,
                worldX, worldY, worldZ, renderable, rotation, true, uid, 0);
        }
    }

    public addSceneSpawnRequest(
        z: number,
        minX: number,
        minY: number,
        tileHeight: number,
        tileWidth: number,
        worldX: number,
        worldY: number,
        worldZ: number,
        renderable: Renderable,
        rotation: number,
        isDynamic: boolean,
        uid: number,
        config: number
    ): boolean {
        for (let x: number = minX; x < minX + tileHeight; x++) {
            for (let y: number = minY; y < minY + tileWidth; y++) {
                if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) {
                    return false;
                }

                const tile: GameSceneTile | null = this.tiles[z][x][y];
                if (tile != null && tile.entityCount >= 5) {
                    return false;
                }
            }
        }

        const interactiveObject: InteractiveObject = new InteractiveObject();
        interactiveObject.uid = uid;
        interactiveObject.config = config;
        interactiveObject.z = z;
        interactiveObject.worldX = worldX;
        interactiveObject.worldY = worldY;
        interactiveObject.worldZ = worldZ;
        interactiveObject.renderable = renderable;
        interactiveObject.rotation = rotation;
        interactiveObject.tileLeft = minX;
        interactiveObject.tileTop = minY;
        interactiveObject.tileRight = minX + tileHeight - 1;
        interactiveObject.tileBottom = minY + tileWidth - 1;
        for (let x: number = minX; x < minX + tileHeight; x++) {
            for (let y: number = minY; y < minY + tileWidth; y++) {
                let size: number = 0;
                if (x > minX) {
                    size++;
                }
                if (x < minX + tileHeight - 1) {
                    size += 4;
                }
                if (y > minY) {
                    size += 8;
                }
                if (y < minY + tileWidth - 1) {
                    size += 2;
                }
                for (let plane: number = z; plane >= 0; plane--) {
                    if (this.tiles[plane][x][y] == null) {
                        this.tiles[plane][x][y] = new GameSceneTile(plane, x, y);
                    }
                }
                const sceneTile: GameSceneTile = this.tiles[z][x][y]!;
                sceneTile.interactiveObjects[sceneTile.entityCount] = interactiveObject;
                sceneTile.interactiveObjectsSize[sceneTile.entityCount] = size;
                sceneTile.interactiveObjectsSizeOR |= size;
                sceneTile.entityCount++;
            }
        }
        if (isDynamic) {
            this.sceneSpawnRequests[this.sceneSpawnRequestsCacheCurrentPos++] = interactiveObject;
        }
        return true;
    }

    public clearInteractiveObjectCache() {
        for (let i: number = 0; i < this.sceneSpawnRequestsCacheCurrentPos; i++) {
            const sceneSpawnRequest: InteractiveObject = this.sceneSpawnRequests[i]!;
            this.removeInteractiveObject(sceneSpawnRequest);
            this.sceneSpawnRequests[i] = null;
        }
        this.sceneSpawnRequestsCacheCurrentPos = 0;
    }

    public removeInteractiveObject(interactiveObject: InteractiveObject) {
        for (let x: number = interactiveObject.tileLeft; x <= interactiveObject.tileRight; x++) {
            for (let y: number = interactiveObject.tileTop; y <= interactiveObject.tileBottom; y++) {
                const tile: GameSceneTile|null = this.tiles[interactiveObject.z][x][y];
                if (tile == null) {
                    continue;
                }

                for (let i: number = 0; i < tile.entityCount; i++) {
                    if (tile.interactiveObjects[i] !== interactiveObject) {
                        continue;
                    }
                    tile.entityCount--;
                    for (let j: number = i; j < tile.entityCount; j++) {
                        tile.interactiveObjects[j] = tile.interactiveObjects[j + 1];
                        tile.interactiveObjectsSize[j] = tile.interactiveObjectsSize[j + 1];
                    }
                    tile.interactiveObjects[tile.entityCount] = null;
                    break;
                }

                tile.interactiveObjectsSizeOR = 0;
                for (let i: number = 0; i < tile.entityCount; i++) {
                    tile.interactiveObjectsSizeOR |= tile.interactiveObjectsSize[i];
                }
            }
        }
    }

    /**
     * Returns the floor height at a given x,y coordinate in 3D space.
     * The calculation takes into account the surrounding tile heights and the specific position within
     * a tile, performing a form of bilinear interpolation to determine the precise height.
     *
     * @param plane The current plane (or level) within the 3D space
     * @param x The x coordinate in the 3D space
     * @param y The y coordinate in the 3D space
     * @return The height of the floor at the given x,y coordinate
     */
    public getFloorDrawHeight(y: number, x: number, plane: number): number {
        // Convert x and y into 'tile space' by dividing by 128 (right shifting by 7 bits)
        const groundX: number = x >> 7;
        const groundY: number = y >> 7;

        // Check if the x and y values in 'tile space' are within the game world.
        if (groundX < 0 || groundY < 0 || groundX >= Game.MAX_TILES || groundY >= Game.MAX_TILES) {
            return 0;
        }

        // If we're not on the top plane and we're on a bridge tile (indicated by the tile flag)
        // then we increment the Z coordinate to take into account the bridge's height
        let groundZ: number = plane;
        if (groundZ < (Game.MAX_LEVELS - 1) && (this.tileFlags[1][groundX][groundY] & 2) === 2) {
            groundZ++;
        }

        // Calculate the position within the tile on X-axis and Y-axis (range 0 to 127)
        const tilePositionX: number = x & 0x7f;
        const tilePositionY: number = y & 0x7f;

        // Interpolate the height for the X-axis at Y position 'groundY' based on tile position X
        // It's a weighted average between the height at groundX and groundX+1
        const interpolatedHeightX1: number =
            (this.intGroundArray[groundZ][groundX + 0][groundY] * (128 - tilePositionX) +
                this.intGroundArray[groundZ][groundX + 1][groundY] * tilePositionX) >> 7;

        // Interpolate the height for the X-axis at Y position 'groundY+1' based on tile position X
        // Similar to above, but one step forward in the Y-axis
        const interpolatedHeightX2: number =
            (this.intGroundArray[groundZ][groundX][groundY + 1] * (128 - tilePositionX) +
                this.intGroundArray[groundZ][groundX + 1][groundY + 1] * tilePositionX) >> 7;

        // Interpolate between the two interpolated X-axis heights, based on the tile position Y
        // This results in a height that takes into account the position within the tile in both the X
        // and Y directions
        return (interpolatedHeightX1 * (128 - tilePositionY) + interpolatedHeightX2 * tilePositionY) >> 7;
    }
}
