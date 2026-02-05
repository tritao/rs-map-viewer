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

export class TerrainSquareDecodeScratch implements DecodedTerrainSquare {
    tileHeights: Int32Array[][];
    tileRenderFlags: Uint8Array[][];
    tileUnderlays: Uint16Array[][];
    tileOverlays: Int16Array[][];
    tileShapes: Uint8Array[][];
    tileRotations: Uint8Array[][];

    constructor(levels: number = Scene.MAX_LEVELS, size: number = Scene.MAP_SQUARE_SIZE) {
        this.tileHeights = new Array(levels);
        this.tileRenderFlags = new Array(levels);
        this.tileUnderlays = new Array(levels);
        this.tileOverlays = new Array(levels);
        this.tileShapes = new Array(levels);
        this.tileRotations = new Array(levels);

        for (let level = 0; level < levels; level++) {
            this.tileHeights[level] = allocTileGridI32(size);
            this.tileRenderFlags[level] = allocTileGridU8(size);
            this.tileUnderlays[level] = allocTileGridU16(size);
            this.tileOverlays[level] = allocTileGridI16(size);
            this.tileShapes[level] = allocTileGridU8(size);
            this.tileRotations[level] = allocTileGridU8(size);
        }
    }
}

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

export function decodeTerrainSquareFromBytesInto(
    decoded: DecodedTerrainSquare,
    data: Uint8Array,
    newTerrainFormat: boolean,
    worldTileX0: number,
    worldTileY0: number,
): void {
    const buffer = new ByteBuffer(data);

    const levels = Scene.MAX_LEVELS;
    const size = Scene.MAP_SQUARE_SIZE;

    for (let level = 0; level < levels; level++) {
        const tileHeights = decoded.tileHeights[level];
        const tileRenderFlags = decoded.tileRenderFlags[level];
        const tileUnderlays = decoded.tileUnderlays[level];
        const tileOverlays = decoded.tileOverlays[level];
        const tileShapes = decoded.tileShapes[level];
        const tileRotations = decoded.tileRotations[level];

        for (let x = 0; x < size; x++) {
            const tileHeightsCol = tileHeights[x];
            const tileRenderFlagsCol = tileRenderFlags[x];
            const tileUnderlaysCol = tileUnderlays[x];
            const tileOverlaysCol = tileOverlays[x];
            const tileShapesCol = tileShapes[x];
            const tileRotationsCol = tileRotations[x];

            for (let y = 0; y < size; y++) {
                tileRenderFlagsCol[y] = 0;
                tileUnderlaysCol[y] = 0;
                tileOverlaysCol[y] = 0;
                tileShapesCol[y] = 0;
                tileRotationsCol[y] = 0;

                while (true) {
                    const v = readTerrainValue(buffer, newTerrainFormat);
                    if (v === 0) {
                        if (level === 0) {
                            const worldX = worldTileX0 + x + 932731;
                            const worldY = worldTileY0 + y + 556238;
                            tileHeightsCol[y] =
                                -generateHeight(worldX, worldY) * Scene.UNITS_TILE_HEIGHT_BASIS;
                        } else {
                            tileHeightsCol[y] = decoded.tileHeights[level - 1][x][y] - Scene.UNITS_LEVEL_HEIGHT;
                        }
                        break;
                    }

                    if (v === 1) {
                        let height = buffer.readUnsignedByte();
                        if (height === 1) {
                            height = 0;
                        }

                        if (level === 0) {
                            tileHeightsCol[y] = -height * Scene.UNITS_TILE_HEIGHT_BASIS;
                        } else {
                            tileHeightsCol[y] =
                                decoded.tileHeights[level - 1][x][y] - height * Scene.UNITS_TILE_HEIGHT_BASIS;
                        }
                        break;
                    }

                    if (v <= 49) {
                        tileOverlaysCol[y] = readTerrainValue(buffer, newTerrainFormat);
                        tileShapesCol[y] = (v - 2) >> 2;
                        tileRotationsCol[y] = (v - 2) & 3;
                    } else if (v <= 81) {
                        tileRenderFlagsCol[y] = v - 49;
                    } else {
                        tileUnderlaysCol[y] = v - 81;
                    }
                }
            }
        }
    }
}

export function decodeTerrainSquareFromBytes(
    data: Uint8Array,
    newTerrainFormat: boolean,
    worldTileX0: number,
    worldTileY0: number,
): DecodedTerrainSquare {
    const scratch = new TerrainSquareDecodeScratch();
    decodeTerrainSquareFromBytesInto(scratch, data, newTerrainFormat, worldTileX0, worldTileY0);
    return scratch;
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
