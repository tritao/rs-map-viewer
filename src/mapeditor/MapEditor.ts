import { vec3 } from "gl-matrix";
import { URLSearchParamsInit } from "react-router-dom";

import { CacheList, LoadedCache } from "../util/Caches";
import { Camera, ProjectionType } from "../renderer/Camera";
import { InputManager } from "../util/InputManager";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { MapEditorRenderer } from "./MapEditorRenderer";
import { CacheLoaders } from "../rs/cache/CacheLoaders";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";

const DEFAULT_RENDER_DISTANCE = 128;

export class MapEditor {
    inputManager: InputManager = new InputManager();
    camera: Camera = new Camera(3242, -26, 3202, -245, 1862);

    renderer: MapEditorRenderer;

    // Cache
    loadedCache: LoadedCache;
    cacheLoaders: CacheLoaders;

    sceneBuilder!: SceneBuilder;

    // Settings

    // Tile distance
    renderDistance: number = DEFAULT_RENDER_DISTANCE;
    // Map square distance
    unloadDistance: number = 2;
    // Map square distance
    lodDistance: number = 3;

    // State
    needsSearchParamUpdate: boolean = false;
    lastTimeSearchParamsUpdated: number = 0;

    debugText?: string;

    selectedUnderlayId: number = 0;

    constructor(
        readonly workerPool: RenderDataWorkerPool,
        readonly cacheList: CacheList,
        cache: LoadedCache,
    ) {
        this.loadedCache = cache;
        this.cacheLoaders = new CacheLoaders(cache);
        this.renderer = new MapEditorRenderer(this);
        this.initCache(cache);
    }

    initCache(cache: LoadedCache): void {
        this.workerPool.initCache(cache, [], []);

        this.renderer.initCache();

        this.updateSearchParams();

        const locModelLoader = new LocModelLoader(
            this.cacheLoaders.locTypeLoader,
            this.cacheLoaders.loaderFactory.getModelLoader(),
            this.cacheLoaders.textureLoader,
            this.cacheLoaders.seqTypeLoader,
            this.cacheLoaders.seqFrameLoader,
            this.cacheLoaders.loaderFactory.getSkeletalSeqLoader(),
        );

        this.sceneBuilder = new SceneBuilder(
            cache.info,
            this.cacheLoaders.loaderFactory.getMapFileLoader(),
            this.cacheLoaders.loaderFactory.getUnderlayTypeLoader(),
            this.cacheLoaders.loaderFactory.getOverlayTypeLoader(),
            this.cacheLoaders.locTypeLoader,
            locModelLoader,
            cache.xteas,
        );

        this.renderer.renderer.sceneBuilder = this.sceneBuilder;
    }

    getSearchParams(): URLSearchParamsInit {
        const cx = this.camera.getPosX().toFixed(2).toString();
        const cy = -this.camera.getPosY().toFixed(2).toString();
        const cz = this.camera.getPosZ().toFixed(2).toString();

        const yaw = this.camera.yaw & 2047;

        const p = (this.camera.pitch | 0).toString();
        const y = yaw.toString();

        const params: any = {
            cx,
            cy,
            cz,
            p,
            y,
        };

        if (this.camera.projectionType === ProjectionType.ORTHO) {
            params["pt"] = "o";
            params["z"] = this.camera.orthoZoom.toString();
        }

        if (this.loadedCache.info.name !== this.cacheList.latest.name) {
            params["cache"] = this.loadedCache.info.name;
        }

        params["v"] = 1;

        return params;
    }

    applySearchParams(searchParams: URLSearchParams) {
        const cx = searchParams.get("cx");
        const cy = searchParams.get("cy");
        const cz = searchParams.get("cz");

        const pitch = searchParams.get("p");
        const yaw = searchParams.get("y");

        const v = searchParams.get("v");

        if (searchParams.get("pt") === "o") {
            this.camera.projectionType = ProjectionType.ORTHO;
        }

        const zoom = searchParams.get("z");
        if (zoom) {
            this.camera.orthoZoom = parseInt(zoom);
        }

        if (cx && cy && cz) {
            const pos = vec3.fromValues(parseFloat(cx), -parseFloat(cy), parseFloat(cz));
            this.camera.pos = pos;
        }
        if (pitch) {
            this.camera.pitch = parseInt(pitch);
            if (!v) {
                this.camera.pitch = -this.camera.pitch;
            }
        }
        if (yaw) {
            this.camera.yaw = parseInt(yaw);
            if (!v) {
                this.camera.yaw = 2048 - this.camera.yaw;
            }
        }
    }

    updateSearchParams(): void {
        this.needsSearchParamUpdate = true;
        this.lastTimeSearchParamsUpdated = performance.now();
    }
}
