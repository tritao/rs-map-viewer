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
import { type WorldEventsInput } from "../runtime/MapWorldSession";
import type { BackendKind } from "../util/BackendKind";
import { CacheList, LoadedCache, loadCacheFiles } from "../util/Caches";
import { isTouchDevice, isWallpaperEngine } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { Result, err, ok } from "../util/Result";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { WorkerRuntimeOptions } from "../worker/WorkerContext";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import { Camera, CameraView, ProjectionType } from "../runtime/Camera";
import { MapManager } from "./MapManager";
import { MapViewerRenderer } from "./MapViewerRenderer";

const DEFAULT_RENDER_DISTANCE = isWallpaperEngine ? 512 : 128;

const CACHED_MAP_IMAGE_PREFIX = "/map-images/";

type CacheContext = {
    readonly loadedCache: LoadedCache;
    readonly session: CacheSession;
};

export type CacheSwitchStatus =
    | { state: "idle" }
    | { state: "switching"; cacheName: string; progress?: DownloadProgress }
    | { state: "error"; cacheName: string; message: string };

type CacheSwitchStatusListener = (status: CacheSwitchStatus) => void;
type DevFixedMapSquare = Readonly<{ mapX: number; mapY: number }>;

export type MapViewerRuntimeOptions = Readonly<{
    mapRenderBackend: BackendKind;
    mapRenderTelemetry: boolean;
}>;

const DEFAULT_RUNTIME_OPTIONS: MapViewerRuntimeOptions = {
    mapRenderBackend: "ts",
    mapRenderTelemetry: false,
};

type SearchParamsListener = (params: URLSearchParamsInit) => void;

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

type MapViewerCacheSwitcherDeps<TContext> = Readonly<{
    getCurrentCacheName(): string;
    loadCacheContext(
        cacheInfo: CacheInfo,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<TContext>;
    applySwitchedCacheContext(context: TContext): Promise<void>;
}>;

class MapViewerCacheSwitcher<TContext> {
    private readonly listeners = new Set<CacheSwitchStatusListener>();
    private status: CacheSwitchStatus = { state: "idle" };
    private nonce = 0;
    private abortController?: AbortController;

    constructor(private readonly deps: MapViewerCacheSwitcherDeps<TContext>) {}

    subscribeStatus(listener: CacheSwitchStatusListener): () => void {
        this.listeners.add(listener);
        listener(this.status);
        return () => this.listeners.delete(listener);
    }

    getStatus(): CacheSwitchStatus {
        return this.status;
    }

    async switchCache(cacheInfo: CacheInfo): Promise<void> {
        if (cacheInfo.name === this.deps.getCurrentCacheName()) {
            return;
        }

        this.abortController?.abort();
        this.abortController = new AbortController();
        const activeAbort = this.abortController;
        const nonce = (++this.nonce) | 0;

        this.setStatus({ state: "switching", cacheName: cacheInfo.name });

        try {
            const context = await this.deps.loadCacheContext(
                cacheInfo,
                activeAbort.signal,
                (progress) => {
                    this.setStatus({
                        state: "switching",
                        cacheName: cacheInfo.name,
                        progress,
                    });
                },
            );

            if ((nonce | 0) !== (this.nonce | 0)) {
                this.setStatus({ state: "idle" });
                return;
            }

            await this.deps.applySwitchedCacheContext(context);
            this.setStatus({ state: "idle" });
        } catch (error: unknown) {
            if ((nonce | 0) !== (this.nonce | 0)) {
                this.setStatus({ state: "idle" });
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus({ state: "error", cacheName: cacheInfo.name, message });
        }
    }

    private setStatus(status: CacheSwitchStatus): void {
        this.status = status;
        for (const listener of this.listeners) {
            listener(status);
        }
    }
}

type MapViewerMapImagesDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    mapImageCache: Cache;
    getLoadedCacheName(): string;
    getMapManager(): MapManager;
}>;

class MapViewerMapImages {
    private readonly mapImageUrls = new Map<number, string>();
    private readonly minimapImageUrls = new Map<number, string>();
    private readonly loadingMapImageIds = new Set<number>();

    constructor(private readonly deps: MapViewerMapImagesDeps) {}

    static getCachedMapImageUrl(mapX: number, mapY: number): string {
        return CACHED_MAP_IMAGE_PREFIX + `${mapX}_${mapY}.png`;
    }

    loadCachedUrls(): void {
        this.deps.renderWorkerPool.build.loadCachedMapImages().then((mapImageUrls) => {
            mapImageUrls.forEach((value, key) => this.mapImageUrls.set(key, value));
        });
    }

    async queueLoadMapImage(mapX: number, mapY: number): Promise<void> {
        const mapManager = this.deps.getMapManager();
        const mapId = getMapSquareId(mapX, mapY);
        if (
            this.loadingMapImageIds.size > this.deps.renderWorkerPool.size * 4 ||
            this.mapImageUrls.has(mapId) ||
            this.loadingMapImageIds.has(mapId) ||
            mapManager.invalidMapIds.has(mapId) ||
            mapManager.loadingMapIds.has(mapId)
        ) {
            return;
        }
        this.loadingMapImageIds.add(mapId);

        const minimapData = await this.deps.renderWorkerPool.build.loadMapImage(
            mapX,
            mapY,
            0,
            true,
        );
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
            this.deps.getMapManager().loadMap(mapX, mapY);
        } else {
            void this.queueLoadMapImage(mapX, mapY);
        }
        return urls.get(getMapSquareId(mapX, mapY));
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
                    const request = new Request(MapViewerMapImages.getCachedMapImageUrl(mapX, mapY), {
                        headers: {
                            "RS-Cache-Name": this.deps.getLoadedCacheName(),
                        },
                    });
                    this.deps.mapImageCache.put(request, resp);
                }
            });
        }
        urls.set(mapId, url);
    }

    clear(): void {
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

function buildMapViewerSearchParams(input: Readonly<{
    camera: Camera;
    loadedCacheName: string;
    latestCacheName: string;
    runtimeOptions: MapViewerRuntimeOptions;
    devFixedMapSquare?: DevFixedMapSquare;
}>): URLSearchParamsInit {
    const cx = input.camera.getPosX().toFixed(2).toString();
    const cy = (-input.camera.getPosY()).toFixed(2);
    const cz = input.camera.getPosZ().toFixed(2).toString();
    const yaw = input.camera.yaw & 2047;
    const params: Record<string, string> = {
        cx,
        cy,
        cz,
        p: (input.camera.pitch | 0).toString(),
        y: yaw.toString(),
        v: "1",
    };

    if (input.camera.projectionType === ProjectionType.ORTHO) {
        params.pt = "o";
        params.z = input.camera.orthoZoom.toString();
    }
    if (input.loadedCacheName !== input.latestCacheName) {
        params.cache = input.loadedCacheName;
    }
    if (input.runtimeOptions.mapRenderBackend !== DEFAULT_RUNTIME_OPTIONS.mapRenderBackend) {
        params.mrb = input.runtimeOptions.mapRenderBackend === "cpp-wasm" ? "cpp" : "ts";
    }
    if (input.runtimeOptions.mapRenderTelemetry) {
        params.mrt = "1";
    }
    if (input.devFixedMapSquare) {
        params.devsq = `${input.devFixedMapSquare.mapX}:${input.devFixedMapSquare.mapY}`;
    }

    return params;
}

type ParsedMapViewerSearchParams = Readonly<{
    position?: vec3;
    projectionType?: ProjectionType;
    orthoZoom?: number;
    pitch?: number;
    yaw?: number;
    devFixedMapSquare?: DevFixedMapSquare;
}>;

function parseMapViewerSearchParams(
    searchParams: URLSearchParams,
): ParsedMapViewerSearchParams {
    const cx = searchParams.get("cx");
    const cy = searchParams.get("cy");
    const cz = searchParams.get("cz");
    const pitch = searchParams.get("p");
    const yaw = searchParams.get("y");
    const version = searchParams.get("v");
    const zoom = searchParams.get("z");

    return {
        position:
            cx && cy && cz
                ? vec3.fromValues(parseFloat(cx), -parseFloat(cy), parseFloat(cz))
                : undefined,
        projectionType:
            searchParams.get("pt") === "o" ? ProjectionType.ORTHO : undefined,
        orthoZoom: zoom ? parseInt(zoom) : undefined,
        pitch: pitch ? (version ? parseInt(pitch) : -parseInt(pitch)) : undefined,
        yaw: yaw ? (version ? parseInt(yaw) : 2048 - parseInt(yaw)) : undefined,
        devFixedMapSquare: parseDevMapSquare(searchParams.get("devsq")),
    };
}

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
    private readonly searchParamsListeners = new Set<SearchParamsListener>();
    private searchParamsDebounceTimer?: number;

    private readonly cacheSwitcher: MapViewerCacheSwitcher<CacheContext>;

    menuOpen: boolean = false;
    menuOpenedFrame: number = 0;
    menuX: number = -1;
    menuY: number = -1;
    menuEntries: OsrsMenuEntry[] = [];

    debugText?: string;

    private readonly mapImages: MapViewerMapImages;

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
        mapImageCache: Cache,
        context: CacheContext,
        runtimeOptions?: WorkerRuntimeOptions,
        initialSearchParams?: URLSearchParams,
    ) {
        this.cacheContext = context;
        this.runtimeOptions = normalizeRuntimeOptions(runtimeOptions);
        this.renderer = new MapViewerRenderer(this);
        this.mapImages = new MapViewerMapImages({
            renderWorkerPool,
            mapImageCache,
            getLoadedCacheName: () => this.loadedCache.info.name,
            getMapManager: () => this.renderer.mapManager,
        });
        this.cacheSwitcher = new MapViewerCacheSwitcher({
            getCurrentCacheName: () => this.loadedCache.info.name,
            loadCacheContext: MapViewer.loadCacheContext,
            applySwitchedCacheContext: (nextContext) =>
                this.applySwitchedCacheContext(nextContext),
        });

        if (initialSearchParams) {
            this.applySearchParams(initialSearchParams);
        }

        this.renderWorkerPool.initCache(context.loadedCache, this.runtimeOptions);
        this.simWorkerPool.initCache(context.loadedCache, this.runtimeOptions);
        this.clearMapImageUrls();
        this.renderer.initializeCacheState();
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
        return buildMapViewerSearchParams({
            camera: this.camera,
            loadedCacheName: this.loadedCache.info.name,
            latestCacheName: this.cacheList.latest.name,
            runtimeOptions: this.runtimeOptions,
            devFixedMapSquare: this.devFixedMapSquare,
        });
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
        this.emitSearchParams();
    }

    getWorkerRuntimeOptions(): MapViewerRuntimeOptions {
        return this.runtimeOptions;
    }

    applyWorldEvents(input: WorldEventsInput): Promise<number> {
        return this.renderer.applyWorldEvents(input);
    }

    async setWorkerRuntimeOptions(options: WorkerRuntimeOptions): Promise<void> {
        const normalized = normalizeRuntimeOptions(options);
        if (runtimeOptionsEqual(normalized, this.runtimeOptions)) {
            return;
        }
        this.runtimeOptions = normalized;
        // Update URL immediately so the user sees the new mode even if rebuilding takes time.
        this.emitSearchParams();

        // Yield so the URL update is observable before we do potentially heavy work
        // (threads RPC / structured clone of cache inputs).
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

        await this.reinitWorkersAndResetViewer(true);
    }

    subscribeSearchParams(listener: SearchParamsListener): () => void {
        this.searchParamsListeners.add(listener);
        return () => this.searchParamsListeners.delete(listener);
    }

    subscribeCacheSwitchStatus(listener: (status: CacheSwitchStatus) => void): () => void {
        return this.cacheSwitcher.subscribeStatus(listener);
    }

    getCacheSwitchStatus(): CacheSwitchStatus {
        return this.cacheSwitcher.getStatus();
    }

    private notifySearchParamsListeners(): void {
        const params = this.getSearchParams();
        for (const listener of this.searchParamsListeners) {
            listener(params);
        }
    }

    private emitSearchParams(debounceMs: number = 0): void {
        if (this.searchParamsDebounceTimer !== undefined) {
            window.clearTimeout(this.searchParamsDebounceTimer);
        }
        if ((debounceMs | 0) <= 0) {
            this.searchParamsDebounceTimer = undefined;
            this.notifySearchParamsListeners();
            return;
        }
        this.searchParamsDebounceTimer = window.setTimeout(() => {
            this.searchParamsDebounceTimer = undefined;
            this.notifySearchParamsListeners();
        }, debounceMs);
    }

    applySearchParams(searchParams: URLSearchParams) {
        const parsed = parseMapViewerSearchParams(searchParams);
        if (parsed.projectionType !== undefined) {
            this.camera.projectionType = parsed.projectionType;
        }
        if (parsed.orthoZoom !== undefined) {
            this.camera.orthoZoom = parsed.orthoZoom;
        }
        if (parsed.position) {
            this.camera.pos = parsed.position;
        }
        if (parsed.pitch !== undefined) {
            this.camera.pitch = parsed.pitch;
        }
        if (parsed.yaw !== undefined) {
            this.camera.yaw = parsed.yaw;
        }

        this.devFixedMapSquare = parsed.devFixedMapSquare;
        if (parsed.devFixedMapSquare) {
            this.renderer.mapManager.setFixedMapSquare(
                parsed.devFixedMapSquare.mapX,
                parsed.devFixedMapSquare.mapY,
            );
        } else {
            this.renderer.mapManager.clearFixedMapSquare();
        }
    }

    init(): void {
        this.mapImages.loadCachedUrls();
    }

    async switchCache(cacheInfo: CacheInfo): Promise<void> {
        await this.cacheSwitcher.switchCache(cacheInfo);
    }

    private async applySwitchedCacheContext(context: CacheContext): Promise<void> {
        this.cacheContext = context;
        await this.reinitWorkersAndResetViewer(false);

        this.updateSearchParams();
    }

    private async reinitWorkersAndResetViewer(waitForWorkers: boolean): Promise<void> {
        if (waitForWorkers) {
            await Promise.all([
                this.renderWorkerPool.initCacheAndWait(
                    this.cacheContext.loadedCache,
                    this.runtimeOptions,
                ),
                this.simWorkerPool.initCacheAndWait(
                    this.cacheContext.loadedCache,
                    this.runtimeOptions,
                ),
            ]);
        } else {
            this.renderWorkerPool.initCache(this.cacheContext.loadedCache, this.runtimeOptions);
            this.simWorkerPool.initCache(this.cacheContext.loadedCache, this.runtimeOptions);
        }

        this.clearMapImageUrls();
        await this.renderer.resetForCacheContext();
        this.resetMenu();
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
        this.emitSearchParams(200);
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

    getMapImageUrl(mapX: number, mapY: number, minimap: boolean): string | undefined {
        return this.mapImages.getMapImageUrl(mapX, mapY, minimap);
    }

    setMapImageUrl(
        mapX: number,
        mapY: number,
        url: string,
        minimap: boolean,
        cache: boolean = true,
    ): void {
        this.mapImages.setMapImageUrl(mapX, mapY, url, minimap, cache);
    }

    clearMapImageUrls(): void {
        this.mapImages.clear();
    }
}
