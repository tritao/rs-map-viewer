import { vec4 } from "gl-matrix";

import { Camera } from "../renderer/Camera";
import { MapFileIndex, getMapSquareId } from "../rs/map/MapFileIndex";
import { Scene } from "../rs/scene/Scene";

function getMapDistance(x: number, z: number, mapX: number, mapY: number): number {
    const centerX = mapX * Scene.MAP_SQUARE_SIZE + 32;
    const centerY = mapY * Scene.MAP_SQUARE_SIZE + 32;
    const dx = Math.max(Math.abs(x - centerX) - 32, 0);
    const dz = Math.max(Math.abs(z - centerY) - 32, 0);
    return Math.sqrt(dx * dx + dz * dz);
}

type LoadMapFunction = (mapX: number, mapY: number) => void;
type RemoveMapFunction = (mapInfo: MapSquareInfo) => void;

export interface MapSquare {
    mapX: number;
    mapY: number;

    canRender(frameCount: number): boolean;

    delete(): void;
}

export type MapManagerFixedMapSquare = Readonly<{
    mapX: number;
    mapY: number;
}>;

export class MapSquareInfo {
    mapId: number;

    constructor(
        readonly mapX: number,
        readonly mapY: number,
    ) {
        this.mapId = getMapSquareId(mapX, mapY);
    }
}

export enum MapManagerUpdateMode {
    RenderDistance,
    Loaded,
}

export class MapManager {
    static readonly MAX_MAP_X = 100;
    static readonly MAX_MAP_Y = 200;

    static mapIntersectBox: number[][] = [
        [0, (-Scene.UNITS_LEVEL_HEIGHT * 10) / 128, 0],
        [0, (Scene.UNITS_LEVEL_HEIGHT * 3) / 128, 0],
    ];

    invalidMapIds: Set<number> = new Set();
    loadingMapIds: Set<number> = new Set();

    renderBounds: vec4 = vec4.fromValues(-1, -1, -1, -1);

    renderDistMapCount: number = 0;
    renderDistMapIds: number[] = [];

    visibleMapCount: number = 0;
    visibleMaps: MapSquareInfo[] = [];

    mapSquares: Map<number, MapSquareInfo> = new Map();

    mode: MapManagerUpdateMode = MapManagerUpdateMode.RenderDistance;
    private fixedMapId: number | undefined;

    constructor(
        readonly maxQueuedTasks: number,
        readonly loadMapFunction: LoadMapFunction,
        readonly removeMapFunction: RemoveMapFunction,
    ) {}

    getFixedMapSquare(): MapManagerFixedMapSquare | undefined {
        if (this.fixedMapId === undefined) {
            return undefined;
        }
        return {
            mapX: this.fixedMapId >> 8,
            mapY: this.fixedMapId & 0xff,
        };
    }

    setFixedMapSquare(mapX: number, mapY: number): void {
        this.fixedMapId = getMapSquareId(mapX, mapY);
        // Drop any queued/loaded state outside the fixed square immediately.
        for (const map of this.mapSquares.values()) {
            if (map.mapId !== this.fixedMapId) {
                this.removeMap(map.mapX, map.mapY);
            }
        }
        for (const mapId of Array.from(this.loadingMapIds)) {
            if (mapId !== this.fixedMapId) {
                this.loadingMapIds.delete(mapId);
            }
        }
        // Force the next update() to treat bounds as changed.
        this.renderBounds.fill(-1);
    }

    clearFixedMapSquare(): void {
        this.fixedMapId = undefined;
        // Force the next update() to treat bounds as changed.
        this.renderBounds.fill(-1);
    }

    applyFixedMapSquare(square: MapManagerFixedMapSquare | undefined): void {
        if (square) {
            this.setFixedMapSquare(square.mapX, square.mapY);
            return;
        }
        this.clearFixedMapSquare();
    }

    init(mapFileIndex: MapFileIndex, fillEmptyTerrain: boolean): void {
        this.cleanUp();
        for (let x = 0; x < MapManager.MAX_MAP_X; x++) {
            for (let y = 0; y < MapManager.MAX_MAP_Y; y++) {
                const exists = mapFileIndex.tryGetTerrainArchiveId(x, y) !== undefined;
                if (exists) {
                    continue;
                }
                if (y < 100 && fillEmptyTerrain) {
                    let hasNeighbour = false;
                    loop: for (let nx = x - 2; nx <= x + 2; nx++) {
                        for (let ny = y - 2; ny <= y + 2; ny++) {
                            const neighbourExists =
                                mapFileIndex.tryGetTerrainArchiveId(nx, ny) !== undefined;
                            if (neighbourExists) {
                                hasNeighbour = true;
                                break loop;
                            }
                        }
                    }
                    if (hasNeighbour) {
                        continue;
                    }
                }
                this.invalidMapIds.add(getMapSquareId(x, y));
            }
        }
        console.log("Invalid map count", this.invalidMapIds.size);
    }

    initializeForCache(
        input: Readonly<{
            mapFileIndex: MapFileIndex;
            fillEmptyTerrain: boolean;
            camera: Camera;
            frameCount: number;
            renderDistance: number;
            unloadDistance: number;
        }>,
    ): void {
        this.init(input.mapFileIndex, input.fillEmptyTerrain);
        this.update(input.camera, input.frameCount, input.renderDistance, input.unloadDistance);
    }

    isMapVisible(camera: Camera, mapX: number, mapY: number): boolean {
        const baseX = mapX * Scene.MAP_SQUARE_SIZE;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE;
        const endX = baseX + Scene.MAP_SQUARE_SIZE;
        const endY = baseY + Scene.MAP_SQUARE_SIZE;

        MapManager.mapIntersectBox[0][0] = baseX;
        MapManager.mapIntersectBox[0][2] = baseY;

        MapManager.mapIntersectBox[1][0] = endX;
        MapManager.mapIntersectBox[1][2] = endY;

        return camera.frustum.intersectsBox(MapManager.mapIntersectBox);
    }

    clearMaps(): void {
        this.invalidMapIds.clear();
        this.loadingMapIds.clear();
        for (const map of this.mapSquares.values()) {
            this.removeMapFunction(map);
        }
        this.mapSquares.clear();
    }

    getMap(mapX: number, mapY: number): MapSquareInfo | undefined {
        return this.mapSquares.get(getMapSquareId(mapX, mapY));
    }

    addMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.loadingMapIds.delete(mapId);
        this.invalidMapIds.delete(mapId);
        if (this.fixedMapId !== undefined && mapId !== this.fixedMapId) {
            return;
        }
        this.mapSquares.set(mapId, new MapSquareInfo(mapX, mapY));
    }

    shouldDropLoadedMapPacket(mapX: number, mapY: number): boolean {
        const mapId = getMapSquareId(mapX, mapY);
        if (this.fixedMapId === undefined || mapId === this.fixedMapId) {
            return false;
        }
        this.loadingMapIds.delete(mapId);
        return true;
    }

    removeMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        const map = this.mapSquares.get(mapId);
        if (map) {
            this.removeMapFunction(map);
            this.mapSquares.delete(mapId);
        }
    }

    addInvalidMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.invalidMapIds.add(mapId);
        this.loadingMapIds.delete(mapId);
    }

    loadMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        if (this.fixedMapId !== undefined && mapId !== this.fixedMapId) {
            return;
        }
        if (
            this.mapSquares.has(mapId) ||
            this.invalidMapIds.has(mapId) ||
            this.loadingMapIds.has(mapId) ||
            this.loadingMapIds.size > this.maxQueuedTasks
        ) {
            return;
        }
        //console.log("MapManager: Loading map", mapX, mapY);
        this.loadingMapIds.add(mapId);
        this.loadMapFunction(mapX, mapY);
    }

    update(
        camera: Camera,
        frameCount: number,
        renderDistance: number,
        unloadDistance: number,
    ): void {
        const cameraX = camera.getPosX();
        const cameraZ = camera.getPosZ();

        const { mapStartX, mapEndX, mapStartY, mapEndY } = this.getRenderBounds(
            camera,
            renderDistance,
        );

        const renderBoundsChanged =
            this.renderBounds[0] !== mapStartX ||
            this.renderBounds[1] !== mapStartY ||
            this.renderBounds[2] !== mapEndX ||
            this.renderBounds[3] !== mapEndY;

        if (renderBoundsChanged) {
            this.updateRenderDistMaps(mapStartX, mapEndX, mapStartY, mapEndY);

            // Calculate which map squares to unload based on the unload distance and remove them.
            // Unload distance is the distance in number of map squares.

            this.unloadMaps(mapStartX, unloadDistance, mapEndX, mapStartY, mapEndY);
        }

        // Sort the maps to render based on a front to back distance.
        if (renderBoundsChanged || camera.updatedPosition) {
            this.renderDistMapIds.length = this.renderDistMapCount;
            // sort front to back
            this.renderDistMapIds.sort((a, b) => {
                const distA = getMapDistance(cameraX, cameraZ, a >> 8, a & 0xff);
                const distB = getMapDistance(cameraX, cameraZ, b >> 8, b & 0xff);
                return distA - distB;
            });
        }

        this.updateVisible(camera, frameCount);

        // Update the render bounds based on the map squares we are rendering.
        this.renderBounds[0] = mapStartX;
        this.renderBounds[1] = mapStartY;
        this.renderBounds[2] = mapEndX;
        this.renderBounds[3] = mapEndY;
    }

    private unloadMaps(
        mapStartX: number,
        unloadDistance: number,
        mapEndX: number,
        mapStartY: number,
        mapEndY: number,
    ) {
        if (this.fixedMapId !== undefined) {
            for (const map of this.mapSquares.values()) {
                if (map.mapId !== this.fixedMapId) {
                    this.removeMap(map.mapX, map.mapY);
                }
            }
            return;
        }
        for (const map of this.mapSquares.values()) {
            const { mapX, mapY } = map;
            if (
                mapX < mapStartX - unloadDistance ||
                mapX > mapEndX + unloadDistance ||
                mapY < mapStartY - unloadDistance ||
                mapY > mapEndY + unloadDistance
            ) {
                this.removeMap(mapX, mapY);
            }
        }
    }

    private updateRenderDistMaps(
        mapStartX: number,
        mapEndX: number,
        mapStartY: number,
        mapEndY: number,
    ) {
        this.renderDistMapCount = 0;

        for (let x = mapStartX; x <= mapEndX; x++) {
            for (let y = mapStartY; y <= mapEndY; y++) {
                if (x < 0 || y < 0 || x >= MapManager.MAX_MAP_X || y >= MapManager.MAX_MAP_Y) {
                    continue;
                }
                const mapId = getMapSquareId(x, y);
                if (this.invalidMapIds.has(mapId)) {
                    continue;
                }

                this.renderDistMapIds[this.renderDistMapCount++] = mapId;
            }
        }
    }

    private getRenderBounds(camera: Camera, renderDistance: number = 0) {
        const cameraX = camera.getPosX();
        const cameraZ = camera.getPosZ();

        if (this.fixedMapId !== undefined) {
            const mapStartX = this.fixedMapId >> 8;
            const mapStartY = this.fixedMapId & 0xff;
            const mapEndX = mapStartX;
            const mapEndY = mapStartY;
            return { mapStartX, mapEndX, mapStartY, mapEndY };
        }

        if (this.mode == MapManagerUpdateMode.Loaded) {
            // Go through all loaded maps and calculate max/min.
            let mapStartX = MapManager.MAX_MAP_X,
                mapEndX = 0;
            let mapStartY = MapManager.MAX_MAP_Y,
                mapEndY = 0;

            for (const map of this.mapSquares.values()) {
                const { mapX, mapY } = map;

                mapStartX = Math.min(mapStartX, mapX);
                mapEndX = Math.max(mapEndX, mapX);

                mapStartY = Math.min(mapStartY, mapY);
                mapEndY = Math.max(mapEndY, mapY);
            }

            return { mapStartX, mapEndX, mapStartY, mapEndY };
        } else {
            // Calculate which map square id to start and end on based on camera location and render distance (in tiles).
            const mapStartX = Math.floor((cameraX - renderDistance) / Scene.MAP_SQUARE_SIZE);
            const mapStartY = Math.floor((cameraZ - renderDistance) / Scene.MAP_SQUARE_SIZE);

            const mapEndX = Math.ceil((cameraX + renderDistance) / Scene.MAP_SQUARE_SIZE);
            const mapEndY = Math.ceil((cameraZ + renderDistance) / Scene.MAP_SQUARE_SIZE);

            return { mapStartX, mapEndX, mapStartY, mapEndY };
        }
    }

    private updateVisible(camera: Camera, frameCount: number) {
        if (this.fixedMapId !== undefined) {
            this.visibleMapCount = 0;
            const mapId = this.fixedMapId;
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;
            const mapSquare = this.mapSquares.get(mapId);
            if (mapSquare) {
                this.visibleMaps[this.visibleMapCount++] = mapSquare;
            } else {
                this.loadMap(mapX, mapY);
            }
            return;
        }

        this.visibleMapCount = 0;
        for (let i = 0; i < this.renderDistMapCount; i++) {
            const mapId = this.renderDistMapIds[i];
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;
            if (!this.isMapVisible(camera, mapX, mapY)) {
                continue;
            }
            const mapSquare = this.mapSquares.get(mapId);
            if (mapSquare) {
                this.visibleMaps[this.visibleMapCount++] = mapSquare;
            } else {
                if (this.mode == MapManagerUpdateMode.RenderDistance) {
                    this.loadMap(mapX, mapY);
                }
            }
        }

        // Probably a better way to do this, maybe set null
        if (this.visibleMapCount > this.visibleMaps.length) {
            // Delete 1 per frame
            this.visibleMaps.length -= 1;
        }
    }

    cleanUp(): void {
        this.renderBounds.fill(-1);
        this.clearMaps();
    }
}
