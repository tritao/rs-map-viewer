import type { Camera } from "../Camera";
import type { MapSquareInfo } from "../MapManager";

export interface ScheduledMapSquare<TKey> {
    readonly id: number;
    readonly npcs: ArrayLike<unknown>;
    readonly npcDataTextureOffsets: ArrayLike<number>;

    canRender(frameCount: number): boolean;
    getMapDistance(cameraMapX: number, cameraMapY: number): number;
    getDrawCallKey(isAlpha: boolean, isInteract: boolean, isLod: boolean): TKey;
}

export type MapRenderScheduleInput<TKey, TMap extends ScheduledMapSquare<TKey>> = Readonly<{
    camera: Camera;
    visibleMapCount: number;
    visibleMaps: ReadonlyArray<MapSquareInfo>;
    loadedMaps: ReadonlyMap<number, TMap>;
    frameCount: number;
    lodDistance: number;
    loadNpcs: boolean;
    hoveredMapIds: ReadonlySet<number>;
}>;

export type LocDrawWorkItem<TKey, TMap> = Readonly<{
    map: TMap;
    isAlpha: boolean;
    isInteract: boolean;
    isLod: boolean;
    drawCallKey: TKey;
}>;

export type NpcDrawWorkItem<TMap> = Readonly<{
    map: TMap;
    isAlpha: boolean;
    dataOffset: number;
}>;

export class MapRenderScheduler {
    gatherRenderableMaps<TKey, TMap extends ScheduledMapSquare<TKey>>(
        input: MapRenderScheduleInput<TKey, TMap>,
    ): TMap[] {
        const out: TMap[] = [];
        for (let i = 0; i < input.visibleMapCount; i++) {
            const mapInfo = input.visibleMaps[i];
            const map = input.loadedMaps.get(mapInfo.mapId);
            if (!map || !map.canRender(input.frameCount)) {
                continue;
            }
            out.push(map);
        }
        return out;
    }

    buildLocWork<TKey, TMap extends ScheduledMapSquare<TKey>>(
        input: MapRenderScheduleInput<TKey, TMap>,
        isAlpha: boolean,
        backToFront: boolean,
        maps?: ReadonlyArray<TMap>,
    ): LocDrawWorkItem<TKey, TMap>[] {
        const cameraMapX = input.camera.getMapX();
        const cameraMapY = input.camera.getMapY();

        const out: LocDrawWorkItem<TKey, TMap>[] = [];
        const gathered = maps ?? this.gatherRenderableMaps(input);
        if (backToFront) {
            for (let i = gathered.length - 1; i >= 0; i--) {
                this.pushLocWork(out, input, gathered[i], cameraMapX, cameraMapY, isAlpha);
            }
            return out;
        }
        for (let i = 0; i < gathered.length; i++) {
            this.pushLocWork(out, input, gathered[i], cameraMapX, cameraMapY, isAlpha);
        }
        return out;
    }

    private pushLocWork<TKey, TMap extends ScheduledMapSquare<TKey>>(
        out: LocDrawWorkItem<TKey, TMap>[],
        input: MapRenderScheduleInput<TKey, TMap>,
        map: TMap,
        cameraMapX: number,
        cameraMapY: number,
        isAlpha: boolean,
    ): void {
        const dist = map.getMapDistance(cameraMapX, cameraMapY);
        const isInteract = input.hoveredMapIds.has(map.id);
        const isLod = dist >= input.lodDistance;

        const drawCallKey = map.getDrawCallKey(isAlpha, isInteract, isLod);
        out.push({ map, isAlpha, isInteract, isLod, drawCallKey });
    }

    buildNpcWork<TKey, TMap extends ScheduledMapSquare<TKey>>(
        input: MapRenderScheduleInput<TKey, TMap>,
        npcDataTextureIndex: number,
        isAlpha: boolean,
        backToFront: boolean,
        maps?: ReadonlyArray<TMap>,
    ): NpcDrawWorkItem<TMap>[] {
        if (!input.loadNpcs) {
            return [];
        }

        const out: NpcDrawWorkItem<TMap>[] = [];
        const gathered = maps ?? this.gatherRenderableMaps(input);
        if (backToFront) {
            for (let i = gathered.length - 1; i >= 0; i--) {
                this.pushNpcWork(out, gathered[i], npcDataTextureIndex, isAlpha);
            }
            return out;
        }
        for (let i = 0; i < gathered.length; i++) {
            this.pushNpcWork(out, gathered[i], npcDataTextureIndex, isAlpha);
        }
        return out;
    }

    private pushNpcWork<TKey, TMap extends ScheduledMapSquare<TKey>>(
        out: NpcDrawWorkItem<TMap>[],
        map: TMap,
        npcDataTextureIndex: number,
        isAlpha: boolean,
    ): void {
        if (map.npcs.length === 0) {
            return;
        }

        const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex] | 0;
        if (dataOffset === -1) {
            return;
        }

        out.push({ map, isAlpha, dataOffset });
    }
}

