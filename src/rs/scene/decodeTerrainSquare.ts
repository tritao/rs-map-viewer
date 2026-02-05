import { ByteBuffer } from "../io/ByteBuffer";
import { generateHeight } from "../util/HeightCalc";
import { Scene, TileRenderFlag } from "./Scene";

function readTerrainValue(buffer: ByteBuffer, newFormat: boolean, signed: boolean = false): number {
    if (newFormat) {
        return signed ? buffer.readShort() : buffer.readUnsignedShort();
    } else {
        return signed ? buffer.readByte() : buffer.readUnsignedByte();
    }
}

export type DecodedTerrainSquare = {
    tileHeights: Int32Array[][]; // [level][x][y]
    tileRenderFlags: Uint8Array[][]; // [level][x][y]
    tileUnderlays: Uint16Array[][]; // [level][x][y]
    tileOverlays: Int16Array[][]; // [level][x][y]
    tileShapes: Uint8Array[][]; // [level][x][y]
    tileRotations: Uint8Array[][]; // [level][x][y]
};

function allocTileGridU8(size: number): Uint8Array[] {
    const grid: Uint8Array[] = new Array(size);
    for (let x = 0; x < size; x++) {
        grid[x] = new Uint8Array(size);
    }
    return grid;
}

function allocTileGridI16(size: number): Int16Array[] {
    const grid: Int16Array[] = new Array(size);
    for (let x = 0; x < size; x++) {
        grid[x] = new Int16Array(size);
    }
    return grid;
}

function allocTileGridU16(size: number): Uint16Array[] {
    const grid: Uint16Array[] = new Array(size);
    for (let x = 0; x < size; x++) {
        grid[x] = new Uint16Array(size);
    }
    return grid;
}

function allocTileGridI32(size: number): Int32Array[] {
    const grid: Int32Array[] = new Array(size);
    for (let x = 0; x < size; x++) {
        grid[x] = new Int32Array(size);
    }
    return grid;
}

export function decodeTerrainSquareFromBytes(
    data: Uint8Array,
    newTerrainFormat: boolean,
    worldTileX0: number,
    worldTileY0: number,
): DecodedTerrainSquare {
    const buffer = new ByteBuffer(data);

    const levels = Scene.MAX_LEVELS;
    const size = Scene.MAP_SQUARE_SIZE;

    const tileHeights: Int32Array[][] = new Array(levels);
    const tileRenderFlags: Uint8Array[][] = new Array(levels);
    const tileUnderlays: Uint16Array[][] = new Array(levels);
    const tileOverlays: Int16Array[][] = new Array(levels);
    const tileShapes: Uint8Array[][] = new Array(levels);
    const tileRotations: Uint8Array[][] = new Array(levels);

    for (let level = 0; level < levels; level++) {
        tileHeights[level] = allocTileGridI32(size);
        tileRenderFlags[level] = allocTileGridU8(size);
        tileUnderlays[level] = allocTileGridU16(size);
        tileOverlays[level] = allocTileGridI16(size);
        tileShapes[level] = allocTileGridU8(size);
        tileRotations[level] = allocTileGridU8(size);
    }

    for (let level = 0; level < levels; level++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                tileRenderFlags[level][x][y] = 0;

                while (true) {
                    const v = readTerrainValue(buffer, newTerrainFormat);
                    if (v === 0) {
                        if (level === 0) {
                            const worldX = worldTileX0 + x + 932731;
                            const worldY = worldTileY0 + y + 556238;
                            tileHeights[level][x][y] =
                                -generateHeight(worldX, worldY) * Scene.UNITS_TILE_HEIGHT_BASIS;
                        } else {
                            tileHeights[level][x][y] =
                                tileHeights[level - 1][x][y] - Scene.UNITS_LEVEL_HEIGHT;
                        }
                        break;
                    }

                    if (v === 1) {
                        let height = buffer.readUnsignedByte();
                        if (height === 1) {
                            height = 0;
                        }

                        if (level === 0) {
                            tileHeights[level][x][y] = -height * Scene.UNITS_TILE_HEIGHT_BASIS;
                        } else {
                            tileHeights[level][x][y] =
                                tileHeights[level - 1][x][y] - height * Scene.UNITS_TILE_HEIGHT_BASIS;
                        }
                        break;
                    }

                    if (v <= 49) {
                        tileOverlays[level][x][y] = readTerrainValue(buffer, newTerrainFormat);
                        tileShapes[level][x][y] = (v - 2) >> 2;
                        tileRotations[level][x][y] = (v - 2) & 3;
                    } else if (v <= 81) {
                        tileRenderFlags[level][x][y] = v - 49;
                    } else {
                        tileUnderlays[level][x][y] = v - 81;
                    }
                }
            }
        }
    }

    return {
        tileHeights,
        tileRenderFlags,
        tileUnderlays,
        tileOverlays,
        tileShapes,
        tileRotations,
    };
}

export function applyDecodedTerrainSquareToScene(
    scene: Scene,
    decoded: DecodedTerrainSquare,
    offsetX: number,
    offsetY: number,
): void {
    const levels = Scene.MAX_LEVELS;
    const size = Scene.MAP_SQUARE_SIZE;

    for (let level = 0; level < levels; level++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const sceneX = x + offsetX;
                const sceneY = y + offsetY;
                if (!scene.isWithinBounds(level, sceneX, sceneY)) {
                    continue;
                }
                scene.tileHeights[level][sceneX][sceneY] = decoded.tileHeights[level][x][y];
                scene.tileRenderFlags[level][sceneX][sceneY] = decoded.tileRenderFlags[level][x][y];
                scene.tileUnderlays[level][sceneX][sceneY] = decoded.tileUnderlays[level][x][y];
                scene.tileOverlays[level][sceneX][sceneY] = decoded.tileOverlays[level][x][y];
                scene.tileShapes[level][sceneX][sceneY] = decoded.tileShapes[level][x][y];
                scene.tileRotations[level][sceneX][sceneY] = decoded.tileRotations[level][x][y];
            }
        }
    }

    // Collision pass (blocked-by-floor)
    for (let level = 0; level < levels; level++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const sceneX = x + offsetX;
                const sceneY = y + offsetY;
                if (!scene.isWithinBounds(level, sceneX, sceneY)) {
                    continue;
                }
                if ((decoded.tileRenderFlags[level][x][y] & TileRenderFlag.Blocked) === 0) {
                    continue;
                }

                let realLevel = level;
                if (scene.levels > 1 && (decoded.tileRenderFlags[1][x][y] & TileRenderFlag.Bridge) !== 0) {
                    realLevel = level - 1;
                }

                if (realLevel >= 0) {
                    scene.collisionMaps[realLevel].setBlockedByFloor(sceneX, sceneY);
                }
            }
        }
    }
}

