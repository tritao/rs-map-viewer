import {
    App as PicoApp,
    PicoGL,
} from "picogl";

import { isWebGL2Supported } from "../../util/DeviceUtil";
import { CacheLoaders } from "../../rs/cache/CacheLoaders";
import { InputManager } from "../../util/InputManager";
import { Camera } from "../Camera";
import { RendererStats } from "./RendererStats";
import { FrameStats } from "../Renderer";
import { MapRenderer, RendererMapSquare } from "../MapRenderer";
import { WebGLMapSquare } from "./WebGLMapSquare";
import { SdMapData } from "../loader/SdMapData";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { RenderDataWorkerPool } from "../../worker/RenderDataWorkerPool";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../loader/SdMapLoaderInput";

// TODO: Create RS3 specific map square.
type WebGLRS3MapSquare = WebGLMapSquare;

// TODO: Create RS3 specific map data loader.
type RS3MapData = SdMapData;

export class WebGLRS3MapRenderer extends MapRenderer<WebGLRS3MapSquare, RS3MapData> {
    stats: FrameStats;
    rendererStats: RendererStats;
    dataLoader: SdMapDataLoader;

    app!: PicoApp;
    gl!: WebGL2RenderingContext;

    constructor(readonly cacheLoaders: CacheLoaders, readonly workerPool: RenderDataWorkerPool,
        readonly inputManager: InputManager,
        renderDistance: number, unloadDistance: number, lodDistance: number,
        readonly camera: Camera) {
        super(cacheLoaders.cache, renderDistance, unloadDistance, lodDistance);
        this.stats = new FrameStats();
        this.rendererStats = new RendererStats();
        this.dataLoader = new SdMapDataLoader();
    }

    static isSupported(): boolean {
        return isWebGL2Supported;
    }

    getViewportDimensions(): { width: number; height: number; } {
        return { width: this.app.width, height: this.app.height };
    }

    async init(canvas: HTMLCanvasElement): Promise<void> {
        this.app = PicoGL.createApp(canvas);
        this.gl = this.app.gl as WebGL2RenderingContext;

        console.log("Renderer init");
    }

    initCache(): void {}

    onResize(width: number, height: number): void {
        this.app.resize(width, height);
    }

    update(time: number, deltaTime: number) { }

    render(time: number, deltaTime: number, resized: boolean): void {
        this.rendererStats.frameStart = performance.now();
        const timeSec = time / 1000;

        // TODO: Render.

        this.loadPending(timeSec)
    }

    updateTextureFiltering(): void {}

    override async loadMapData(mapX: number, mapY: number): Promise<RS3MapData | undefined> {
        const mapData = await this.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(this.dataLoader, {
            mapX,
            mapY,
            maxLevel: this.maxLevel,
            loadObjs: this.loadObjs,
            loadNpcs: this.loadNpcs,
            loadLocs: this.loadLocs,
            modelId: 0,
            smoothTerrain: this.smoothTerrain,
            minimizeDrawCalls: !this.hasMultiDraw,
            loadedTextureIds: this.loadedTextureIds,
        });

        return mapData; 
    }

    loadMap(
        mapData: SdMapData,
        time: number,
    ): void {
        const { mapX, mapY } = mapData;
        // this.loadedMaps.set(
        //     getMapSquareId(mapX, mapY),
        //     WebGLMapSquare.load()
        // );
    }

    loadPending(timeSec: number) {
        // Load new map squares
        const mapData = this.mapsToLoad.shift();
        if (mapData && this.isValidMapData(mapData)) {
            this.loadMap(mapData, timeSec);
        }
    }

    onFrameEnd(): void {
        this.stats.onFrameEnd();
    }

    addNpcRenderData(map: RendererMapSquare): void {}

    async cleanUp(): Promise<void> {
        console.log("Renderer cleaned up");
    }
}
