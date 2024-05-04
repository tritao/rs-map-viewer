import { vec3 } from "gl-matrix";
import { URLSearchParamsInit } from "react-router-dom";

import { CacheList, LoadedCache } from "../util/Caches";
import { Camera, ProjectionType } from "../renderer/Camera";
import { InputManager } from "../util/InputManager";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { CacheViewerRenderer } from "./CacheViewerRenderer";
import { CacheLoaders } from "../rs/cache/CacheLoaders";

export class CacheViewer {

    inputManager: InputManager = new InputManager();
    camera: Camera = new Camera(3242, -26, 3202, -245, 1862);

    renderer: CacheViewerRenderer;

    // Cache
    cacheLoaders: CacheLoaders;

    // Settings
    cameraSpeed: number = 1;

    // State
    modelId: number|null = null;

    needsSearchParamUpdate: boolean = false;
    lastTimeSearchParamsUpdated: number = 0;

    debugText?: string;

    constructor(
        readonly workerPool: RenderDataWorkerPool,
        readonly cacheList: CacheList,
        cache: LoadedCache,
    ) {
        this.cacheLoaders = new CacheLoaders(cache);
        this.renderer = new CacheViewerRenderer(this);
        this.initCache(cache);
    }

    initCache(cache: LoadedCache): void {
        this.workerPool.initCache(cache, [], []);
        this.renderer.initCache();
        this.updateSearchParams();
    }

    setModel(modelId: number) {
        this.modelId = modelId;
        this.renderer.queueLoadModel(modelId);
        this.updateSearchParams()
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

        if (this.cacheLoaders.cache.info.name !== this.cacheList.latest.name) {
            params["cache"] = this.cacheLoaders.cache.info.name;
        }

        params["v"] = 1;

        if (this.modelId != null) {
            params["m"] = this.modelId;
        }

        return params;
    }

    applySearchParams(searchParams: URLSearchParams) {
        const m = searchParams.get("m");
        if (m) {
            this.setModel(Number.parseInt(m));
        }

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
