import { vec3 } from "gl-matrix";
import { URLSearchParamsInit } from "react-router-dom";

import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import { MenuTargetType } from "../rs/MenuEntry";
import { CacheInfo } from "../rs/cache/CacheInfo";
import { DownloadProgress, ProgressListener } from "../rs/cache/platform/CacheLoader";
import { BrowserCacheLoader } from "../rs/cache/platform/browser/BrowserCacheLoader";
import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import { CacheSession, tryCreateCacheSession } from "../rs/loaders/CacheSession";
import { initErrorToString } from "../rs/loaders/InitError";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import type { ObjRenderData } from "../maprender/MapRenderPayload";
import type { MapObjRenderPacket } from "../runtime/contracts/MapObjRenderPacket";
import type { NpcEvent } from "../runtime/sim/NpcEvents";
import type { BackendKind } from "../util/BackendKind";
import { CacheList, LoadedCache, loadCacheFiles } from "../util/Caches";
import { isTouchDevice, isWallpaperEngine } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { Result, err, ok } from "../util/Result";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { WorkerRuntimeOptions } from "../worker/RenderDataWorkerTypes";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import { Camera, CameraView, ProjectionType } from "./Camera";
import { MapManager } from "./MapManager";
import { MapViewerRenderer } from "./MapViewerRenderer";

const DEFAULT_RENDER_DISTANCE = isWallpaperEngine ? 512 : 128;

const CACHED_MAP_IMAGE_PREFIX = "/map-images/";

type CacheContext = {
    readonly loadedCache: LoadedCache;
    readonly session: CacheSession;
};

type DevFixedMapSquare = Readonly<{ mapX: number; mapY: number }>;

export type MapViewerRuntimeOptions = Readonly<{
    mapRenderBackend: BackendKind;
    mapRenderTelemetry: boolean;
}>;

const DEFAULT_RUNTIME_OPTIONS: MapViewerRuntimeOptions = {
    mapRenderBackend: "ts",
    mapRenderTelemetry: false,
};

function normalizeRuntimeOptions(options?: WorkerRuntimeOptions): MapViewerRuntimeOptions {
    return {
        mapRenderBackend: options?.mapRenderBackend ?? DEFAULT_RUNTIME_OPTIONS.mapRenderBackend,
        mapRenderTelemetry:
            options?.mapRenderTelemetry ?? DEFAULT_RUNTIME_OPTIONS.mapRenderTelemetry,
    };
}

function runtimeOptionsEqual(a: MapViewerRuntimeOptions, b: MapViewerRuntimeOptions): boolean {
    return (
        a.mapRenderBackend === b.mapRenderBackend && a.mapRenderTelemetry === b.mapRenderTelemetry
    );
}

function parseDevMapSquare(value: string | null): DevFixedMapSquare | undefined {
    if (!value) {
        return undefined;
    }
    const m = /^(\d+):(\d+)$/.exec(value.trim());
    if (!m) {
        return undefined;
    }
    const mapX = Number(m[1]);
    const mapY = Number(m[2]);
    if (
        !Number.isFinite(mapX) ||
        !Number.isFinite(mapY) ||
        mapX < 0 ||
        mapY < 0 ||
        mapX >= MapManager.MAX_MAP_X ||
        mapY >= MapManager.MAX_MAP_Y
    ) {
        return undefined;
    }
    return { mapX, mapY };
}

export type CacheSwitchStatus =
    | { state: "idle" }
    | { state: "switching"; cacheName: string; progress?: DownloadProgress }
    | { state: "error"; cacheName: string; message: string };

export class MapViewer {
    inputManager: InputManager = new InputManager();
    camera: Camera = new Camera(3242, -26, 3202, -245, 1862);
    pathfinder: Pathfinder = new Pathfinder();

    renderer!: MapViewerRenderer;
    private cacheContext: CacheContext;

    // Settings

    // Tile distance
    renderDistance: number = DEFAULT_RENDER_DISTANCE;
    // Map square distance
    unloadDistance: number = 2;
    // Map square distance
    lodDistance: number = 3;

    tooltips: boolean = !isTouchDevice;
    debugId: boolean = false;

    // Events/state
    private readonly searchParamsListeners = new Set<(params: URLSearchParamsInit) => void>();
    private searchParamsDebounceTimer?: number;

    private readonly cacheSwitchListeners = new Set<(status: CacheSwitchStatus) => void>();
    private cacheSwitchStatus: CacheSwitchStatus = { state: "idle" };

    private cacheSwitchNonce: number = 0;
    private cacheSwitchAbort?: AbortController;

    menuOpen: boolean = false;
    menuOpenedFrame: number = 0;
    menuX: number = -1;
    menuY: number = -1;
    menuEntries: OsrsMenuEntry[] = [];

    debugText?: string;

    mapImageUrls: Map<number, string> = new Map();
    minimapImageUrls: Map<number, string> = new Map();
    loadingMapImageIds: Set<number> = new Set();

    cameraSpeed: number = 1;
    private devFixedMapSquare: DevFixedMapSquare | undefined;

    static tryCreate(
        renderWorkerPool: RenderDataWorkerPool,
        simWorkerPool: SimWorkerPool,
        cacheList: CacheList,
        mapImageCache: Cache,
        context: CacheContext,
        runtimeOptions?: WorkerRuntimeOptions,
        initialSearchParams?: URLSearchParams,
    ): Result<MapViewer, string> {
        return ok(
            new MapViewer(
                renderWorkerPool,
                simWorkerPool,
                cacheList,
                mapImageCache,
                context,
                runtimeOptions,
                initialSearchParams,
            ),
        );
    }

    static async loadCacheContext(
        cacheInfo: CacheInfo,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CacheContext> {
        const loadedCache = await loadCacheFiles(
            new BrowserCacheLoader(),
            cacheInfo,
            signal,
            progressListener,
        );

        const sessionResult = tryCreateCacheSession(loadedCache, new JSCompressionHandler());
        if (!sessionResult.ok) {
            throw new Error(initErrorToString(sessionResult.error));
        }

        return {
            loadedCache,
            session: sessionResult.value,
        };
    }

    private constructor(
        readonly renderWorkerPool: RenderDataWorkerPool,
        readonly simWorkerPool: SimWorkerPool,
        readonly cacheList: CacheList,
        readonly mapImageCache: Cache,
        context: CacheContext,
        runtimeOptions?: WorkerRuntimeOptions,
        initialSearchParams?: URLSearchParams,
    ) {
        this.cacheContext = context;
        this.runtimeOptions = normalizeRuntimeOptions(runtimeOptions);
        this.renderer = new MapViewerRenderer(this);

        if (initialSearchParams) {
            this.applySearchParams(initialSearchParams);
        }

        this.renderWorkerPool.initCache(context.loadedCache, this.runtimeOptions);
        this.simWorkerPool.initCache(context.loadedCache, this.runtimeOptions);
        this.clearMapImageUrls();
        this.renderer.initCache();
        this.resetMenu();
        this.updateSearchParams();
    }

    get workerPool(): RenderDataWorkerPool {
        return this.renderWorkerPool;
    }

    private runtimeOptions: MapViewerRuntimeOptions;

    get loadedCache(): LoadedCache {
        return this.cacheContext.loadedCache;
    }

    get session(): CacheSession {
        return this.cacheContext.session;
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

        if (this.runtimeOptions.mapRenderBackend !== DEFAULT_RUNTIME_OPTIONS.mapRenderBackend) {
            params["mrb"] = this.runtimeOptions.mapRenderBackend === "cpp-wasm" ? "cpp" : "ts";
        }
        if (this.runtimeOptions.mapRenderTelemetry) {
            params["mrt"] = "1";
        }
        if (this.devFixedMapSquare) {
            params["devsq"] = `${this.devFixedMapSquare.mapX}:${this.devFixedMapSquare.mapY}`;
        }

        params["v"] = 1;

        return params;
    }

    getDevFixedMapSquare(): DevFixedMapSquare | undefined {
        return this.devFixedMapSquare;
    }

    // Dev feature: pin map loading to a single square (speeds iteration; reduces memory).
    setDevFixedMapSquare(square: DevFixedMapSquare | undefined): void {
        this.devFixedMapSquare = square;
        if (square) {
            this.renderer.mapManager.setFixedMapSquare(square.mapX, square.mapY);
        } else {
            this.renderer.mapManager.clearFixedMapSquare();
        }
        // Update URL immediately; no heavy work should run here.
        this.emitSearchParamsNow();
    }

    getWorkerRuntimeOptions(): MapViewerRuntimeOptions {
        return this.runtimeOptions;
    }

    applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        return this.renderer.applyNpcLifecycleEvents(events);
    }

    replaceMapObjRenderData(
        mapX: number,
        mapY: number,
        objRenderData: ObjRenderData | undefined,
    ): void {
        this.renderer.replaceMapObjRenderData(mapX, mapY, objRenderData);
    }

    applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): void {
        this.renderer.applyMapObjRenderPacket(packet);
    }

    async setWorkerRuntimeOptions(options: WorkerRuntimeOptions): Promise<void> {
        const normalized = normalizeRuntimeOptions(options);
        if (runtimeOptionsEqual(normalized, this.runtimeOptions)) {
            return;
        }
        this.runtimeOptions = normalized;
        // Update URL immediately so the user sees the new mode even if rebuilding takes time.
        this.emitSearchParamsNow();

        // Yield so the URL update is observable before we do potentially heavy work
        // (threads RPC / structured clone of cache inputs).
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

        await Promise.all([
            this.renderWorkerPool.initCacheAndWait(
                this.cacheContext.loadedCache,
                this.runtimeOptions,
            ),
            this.simWorkerPool.initCacheAndWait(this.cacheContext.loadedCache, this.runtimeOptions),
        ]);
        this.clearMapImageUrls();
        await this.renderer.applyCacheContext();
        this.resetMenu();
    }

    subscribeSearchParams(listener: (params: URLSearchParamsInit) => void): () => void {
        this.searchParamsListeners.add(listener);
        return () => this.searchParamsListeners.delete(listener);
    }

    subscribeCacheSwitchStatus(listener: (status: CacheSwitchStatus) => void): () => void {
        this.cacheSwitchListeners.add(listener);
        listener(this.cacheSwitchStatus);
        return () => this.cacheSwitchListeners.delete(listener);
    }

    getCacheSwitchStatus(): CacheSwitchStatus {
        return this.cacheSwitchStatus;
    }

    private setCacheSwitchStatus(status: CacheSwitchStatus): void {
        this.cacheSwitchStatus = status;
        for (const listener of this.cacheSwitchListeners) {
            listener(status);
        }
    }

    private scheduleSearchParamsEmit(): void {
        if (this.searchParamsDebounceTimer !== undefined) {
            window.clearTimeout(this.searchParamsDebounceTimer);
        }
        this.searchParamsDebounceTimer = window.setTimeout(() => {
            this.searchParamsDebounceTimer = undefined;
            const params = this.getSearchParams();
            for (const listener of this.searchParamsListeners) {
                listener(params);
            }
        }, 200);
    }

    private emitSearchParamsNow(): void {
        if (this.searchParamsDebounceTimer !== undefined) {
            window.clearTimeout(this.searchParamsDebounceTimer);
            this.searchParamsDebounceTimer = undefined;
        }
        const params = this.getSearchParams();
        for (const listener of this.searchParamsListeners) {
            listener(params);
        }
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

        const devsq = parseDevMapSquare(searchParams.get("devsq"));
        this.devFixedMapSquare = devsq;
        if (devsq) {
            this.renderer.mapManager.setFixedMapSquare(devsq.mapX, devsq.mapY);
        } else {
            this.renderer.mapManager.clearFixedMapSquare();
        }
    }

    init(): void {
        this.renderWorkerPool.loadCachedMapImages().then((mapImageUrls) => {
            mapImageUrls.forEach((value, key) => this.mapImageUrls.set(key, value));
        });
    }

    async switchCache(cacheInfo: CacheInfo): Promise<void> {
        if (cacheInfo.name === this.loadedCache.info.name) {
            return;
        }

        this.cacheSwitchAbort?.abort();
        const abortController = new AbortController();
        this.cacheSwitchAbort = abortController;
        const nonce = ++this.cacheSwitchNonce;

        this.setCacheSwitchStatus({ state: "switching", cacheName: cacheInfo.name });

        try {
            const context = await MapViewer.loadCacheContext(
                cacheInfo,
                abortController.signal,
                (progress) => {
                    this.setCacheSwitchStatus({
                        state: "switching",
                        cacheName: cacheInfo.name,
                        progress,
                    });
                },
            );

            if (nonce !== this.cacheSwitchNonce) {
                this.setCacheSwitchStatus({ state: "idle" });
                return;
            }

            await this.applySwitchedCacheContext(context);
            this.setCacheSwitchStatus({ state: "idle" });
        } catch (e) {
            if (nonce !== this.cacheSwitchNonce) {
                this.setCacheSwitchStatus({ state: "idle" });
                return;
            }
            const message = e instanceof Error ? e.message : String(e);
            this.setCacheSwitchStatus({ state: "error", cacheName: cacheInfo.name, message });
        }
    }

    private async applySwitchedCacheContext(context: CacheContext): Promise<void> {
        this.cacheContext = context;

        this.renderWorkerPool.initCache(context.loadedCache, this.runtimeOptions);
        this.simWorkerPool.initCache(context.loadedCache, this.runtimeOptions);
        this.clearMapImageUrls();

        await this.renderer.applyCacheContext();
        this.resetMenu();

        this.updateSearchParams();
    }

    /**
     * Sets the camera position to a new arbitrary position
     * @param newView Any of the items you want to move: Position, pitch, yaw
     */
    setCamera(newView: Partial<CameraView>): void {
        if (newView.position) {
            vec3.copy(this.camera.pos, newView.position);
        }
        if (newView.pitch !== undefined) {
            this.camera.pitch = newView.pitch;
        }
        if (newView.yaw !== undefined) {
            this.camera.yaw = newView.yaw;
        }
        if (newView.fov !== undefined) {
            this.camera.fov = newView.fov;
        }
        if (newView.orthoZoom !== undefined) {
            this.camera.orthoZoom = newView.orthoZoom;
        }
        this.camera.updated = true;
    }

    updateSearchParams(): void {
        this.scheduleSearchParamsEmit();
    }

    closeMenu = () => {
        this.menuOpen = false;
        this.menuX = -1;
        this.menuY = -1;
        this.renderer.canvas.focus();
    };

    resetMenu = () => {
        this.closeMenu();
        this.menuOpenedFrame = 0;
    };

    onExamine = (entry: OsrsMenuEntry) => {
        let lookupType: string | undefined;
        switch (entry.targetType) {
            case MenuTargetType.NPC:
                lookupType = "npc";
                break;
            case MenuTargetType.LOC:
                lookupType = "object";
                break;
            case MenuTargetType.OBJ:
                lookupType = "item";
                break;
        }
        if (lookupType) {
            window.open(
                `https://oldschool.runescape.wiki/w/Special:Lookup?type=${lookupType}&id=${entry.targetId}`,
                "_blank",
            );
        }
        this.closeMenu();
    };

    updateVars(): void {
        this.renderWorkerPool.setVars(this.session.varManager.values);
        this.simWorkerPool.setVars(this.session.varManager.values);
    }

    static getCachedMapImageUrl(mapX: number, mapY: number): string {
        return CACHED_MAP_IMAGE_PREFIX + `${mapX}_${mapY}.png`;
    }

    async queueLoadMapImage(mapX: number, mapY: number) {
        const mapManager = this.renderer.mapManager;
        const mapId = getMapSquareId(mapX, mapY);
        if (
            this.loadingMapImageIds.size > this.renderWorkerPool.size * 4 ||
            this.mapImageUrls.has(mapId) ||
            this.loadingMapImageIds.has(mapId) ||
            mapManager.invalidMapIds.has(mapId) ||
            mapManager.loadingMapIds.has(mapId)
        ) {
            return;
        }
        this.loadingMapImageIds.add(mapId);

        const minimapData = await this.renderWorkerPool.queueMapImage(mapX, mapY, 0, true);
        if (minimapData) {
            const url = URL.createObjectURL(minimapData.minimapBlob);
            this.setMapImageUrl(mapX, mapY, url, false);
        } else {
            mapManager.invalidMapIds.add(mapId);
        }

        this.loadingMapImageIds.delete(mapId);
    }

    getMapImageUrl(mapX: number, mapY: number, minimap: boolean): string | undefined {
        if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
            return undefined;
        }
        const urls = minimap ? this.minimapImageUrls : this.mapImageUrls;
        if (minimap) {
            this.renderer.mapManager.loadMap(mapX, mapY);
        } else {
            this.queueLoadMapImage(mapX, mapY);
        }
        const mapId = getMapSquareId(mapX, mapY);
        return urls.get(mapId);
    }

    setMapImageUrl(
        mapX: number,
        mapY: number,
        url: string,
        minimap: boolean,
        cache: boolean = true,
    ): void {
        const mapId = getMapSquareId(mapX, mapY);
        const urls = minimap ? this.minimapImageUrls : this.mapImageUrls;
        const old = urls.get(mapId);
        if (old) {
            URL.revokeObjectURL(old);
        }
        if (cache) {
            fetch(url).then((resp) => {
                if (resp.ok) {
                    const request = new Request(MapViewer.getCachedMapImageUrl(mapX, mapY), {
                        headers: {
                            "RS-Cache-Name": this.loadedCache.info.name,
                        },
                    });
                    this.mapImageCache.put(request, resp);
                }
            });
        }
        urls.set(mapId, url);
    }

    clearMapImageUrls(): void {
        for (const url of this.mapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        for (const url of this.minimapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this.mapImageUrls.clear();
        this.minimapImageUrls.clear();
        this.loadingMapImageIds.clear();
    }
}
