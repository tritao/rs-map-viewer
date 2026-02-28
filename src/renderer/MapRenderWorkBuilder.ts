import type { Camera } from "./Camera";
import type { MapSquareInfo } from "./MapManager";

export interface SchedulableMapSquare {
    readonly id: number;
    readonly npcs: ArrayLike<unknown>;

    canRender(frameCount: number): boolean;
    getMapDistance(cameraMapX: number, cameraMapY: number): number;
}

export type MapRenderWorkInput<TMap extends SchedulableMapSquare> = Readonly<{
    camera: Camera;
    visibleMapCount: number;
    visibleMaps: ReadonlyArray<MapSquareInfo>;
    loadedMaps: ReadonlyMap<number, TMap>;
    frameCount: number;
    lodDistance: number;
    loadNpcs: boolean;
    hoveredMapIds: ReadonlySet<number>;
}>;

export type LocMapWorkItem<TMap> = Readonly<{
    map: TMap;
    isAlpha: boolean;
    isInteract: boolean;
    isLod: boolean;
}>;

export type NpcMapWorkItem<TMap> = Readonly<{
    map: TMap;
    isAlpha: boolean;
}>;

export class MapRenderWorkBuilder {
    gatherRenderableMaps<TMap extends SchedulableMapSquare>(
        input: MapRenderWorkInput<TMap>,
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

    buildLocWork<TMap extends SchedulableMapSquare>(
        input: MapRenderWorkInput<TMap>,
        isAlpha: boolean,
        backToFront: boolean,
        maps?: ReadonlyArray<TMap>,
    ): LocMapWorkItem<TMap>[] {
        const cameraMapX = input.camera.getMapX();
        const cameraMapY = input.camera.getMapY();

        const out: LocMapWorkItem<TMap>[] = [];
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

    private pushLocWork<TMap extends SchedulableMapSquare>(
        out: LocMapWorkItem<TMap>[],
        input: MapRenderWorkInput<TMap>,
        map: TMap,
        cameraMapX: number,
        cameraMapY: number,
        isAlpha: boolean,
    ): void {
        const dist = map.getMapDistance(cameraMapX, cameraMapY);
        const isInteract = input.hoveredMapIds.has(map.id);
        const isLod = dist >= input.lodDistance;
        out.push({ map, isAlpha, isInteract, isLod });
    }

    buildNpcWork<TMap extends SchedulableMapSquare>(
        input: MapRenderWorkInput<TMap>,
        isAlpha: boolean,
        backToFront: boolean,
        maps?: ReadonlyArray<TMap>,
    ): NpcMapWorkItem<TMap>[] {
        if (!input.loadNpcs) {
            return [];
        }

        const out: NpcMapWorkItem<TMap>[] = [];
        const gathered = maps ?? this.gatherRenderableMaps(input);
        if (backToFront) {
            for (let i = gathered.length - 1; i >= 0; i--) {
                this.pushNpcWork(out, gathered[i], isAlpha);
            }
            return out;
        }
        for (let i = 0; i < gathered.length; i++) {
            this.pushNpcWork(out, gathered[i], isAlpha);
        }
        return out;
    }

    private pushNpcWork<TMap extends SchedulableMapSquare>(
        out: NpcMapWorkItem<TMap>[],
        map: TMap,
        isAlpha: boolean,
    ): void {
        if (map.npcs.length === 0) {
            return;
        }
        out.push({ map, isAlpha });
    }
}
