import { vec3 } from "gl-matrix";
import { URLSearchParamsInit } from "react-router-dom";

import { ClientCommandService } from "../client/actions/ClientCommandService";
import {
    DebugActionService,
    getCameraMapPosition,
} from "../debug/DebugActionService";
import {
    ClientRuntime,
    type ClientRuntimeCacheContext,
    type ClientRuntimeOptions,
    type CacheSwitchStatus,
} from "../client/runtime/ClientRuntime";
import {
    ClientCommandRuntime,
    type ClientPlayerIntent,
} from "../client/runtime/ClientCommandRuntime";
import { MapViewerMapImages } from "./MapViewerMapImages";
import {
    buildMapViewerSearchParams,
    parseMapViewerSearchParams,
    type DevFixedMapSquare,
    type SearchParamsListener,
} from "./MapViewerSearchParams";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import { CacheInfo } from "../rs/cache/CacheInfo";
import { ProgressListener } from "../rs/cache/platform/CacheLoader";
import { BrowserCacheLoader } from "../rs/cache/platform/browser/BrowserCacheLoader";
import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import type { ObjActionTargetInstance } from "../rs/MenuEntry";
import { CacheSession, tryCreateCacheSession } from "../rs/loaders/CacheSession";
import { initErrorToString } from "../rs/loaders/InitError";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { CacheList, LoadedCache, loadCacheFiles } from "../util/Caches";
import { isTouchDevice, isWallpaperEngine } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { Result, ok } from "../util/Result";
import { RenderFrameCoordinator } from "../renderer/RenderFrameCoordinator";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { WorkerRuntimeOptions } from "../worker/WorkerBuildTypes";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import { WorkerWorldRuntime } from "../worker/WorkerWorldRuntime";
import { WorldToClientWorldAdapter } from "../world/WorldToClientWorldAdapter";
import {
    type WorldMutationInput,
    WorldSession,
} from "../world/WorldSession";
import { Camera, CameraView } from "../renderer/Camera";
import { ClientWorldState } from "../client/world/ClientWorldState";
import { WorldInteractionIndex } from "../client/world/WorldInteractionIndex";
import {
    MapViewerRenderer,
    type MapViewerStaticMapRuntime,
    type MapViewerStaticMapRuntimeCallbacks,
} from "./MapViewerRenderer";
import {
    advanceWalkNavigation,
    resolveWalkDestination,
    type WalkDestination,
} from "./MapViewerNavigation";

export type { CacheSwitchStatus } from "../client/runtime/ClientRuntime";

const DEFAULT_RENDER_DISTANCE = isWallpaperEngine ? 512 : 128;
const EMPTY_MENU_ENTRIES: ReadonlyArray<OsrsMenuEntry> = [];
const EMPTY_MENU_STATE: ViewerMenuState = {
    open: false,
    openedFrame: 0,
    x: -1,
    y: -1,
    entries: EMPTY_MENU_ENTRIES,
};

type CacheContext = ClientRuntimeCacheContext;
type ViewerMenuState = Readonly<{
    open: boolean;
    openedFrame: number;
    x: number;
    y: number;
    entries: ReadonlyArray<OsrsMenuEntry>;
}>;

export type MapViewerRuntimeOptions = ClientRuntimeOptions;

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

export class MapViewer {
    devLocReplacementTypeId: number = 0;

    inputManager: InputManager = new InputManager();
    camera: Camera = new Camera(3242, -26, 3202, -245, 1862);
    pathfinder: Pathfinder = new Pathfinder();

    renderer!: MapViewerRenderer;
    readonly debugActions: DebugActionService;
    private readonly clientRuntime: ClientRuntime;

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
    private readonly searchParamListeners = new Set<SearchParamsListener>();
    private searchParamsDebounceTimer?: number;
    private menuState: ViewerMenuState = EMPTY_MENU_STATE;

    debugText?: string;

    private readonly mapImages: MapViewerMapImages;

    cameraSpeed: number = 1;
    private devFixedMapSquare: DevFixedMapSquare | undefined;
    private walkDestination?: WalkDestination;

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
        const normalizedRuntimeOptions = normalizeRuntimeOptions(runtimeOptions);
        this.runtimeOptions = normalizedRuntimeOptions;
        const clientWorldState = new ClientWorldState();
        const clientCommands = new ClientCommandService({
            clientWorldState,
        });
        const clientCommandRuntime = new ClientCommandRuntime();
        const worldToClientWorldAdapter = new WorldToClientWorldAdapter({
            clientWorldState,
        });
        const worldInteractionIndex = new WorldInteractionIndex();
        const worldSession = new WorldSession({
            worldRuntime: new WorkerWorldRuntime({
                renderRuntime: renderWorkerPool.frame,
                simRuntime: simWorkerPool.world,
            }),
        });
        const renderFrameCoordinator = new RenderFrameCoordinator({
            worldRuntime: simWorkerPool.world,
            renderFrameRuntime: renderWorkerPool.frame,
            getLodDistance: () => this.renderer.renderer.lodDistance,
            getHoveredMapIdsPacked: () =>
                this.renderer.renderer.getInteractionSnapshotRenderer?.()?.getHoveredMapIdsPacked(),
            getVisibleMapIds: () => this.renderer.getVisibleMapIdsPackedForFrameCoordinator(),
            getCameraMapX: () => this.camera.getMapX(),
            getCameraMapY: () => this.camera.getMapY(),
            applyWorldDelta: (packet) => worldToClientWorldAdapter.applyWorldDelta(packet),
            reportSeamSample: (sample) => this.renderer.reportRenderFrameSeamSample(sample),
        });
        this.clientRuntime = new ClientRuntime({
            clientCommands,
            clientCommandRuntime,
            clientWorldState,
            worldToClientWorldAdapter,
            worldInteractionIndex,
            worldSession,
            renderFrameCoordinator,
            renderWorkerPool,
            simWorkerPool,
            cacheContext: context,
            runtimeOptions: normalizedRuntimeOptions,
            loadCacheContext: MapViewer.loadCacheContext,
            hasLoadedMap: (mapId) => this.renderer.hasLoadedMap(mapId | 0),
            reloadLoadedMap: (mapId) => this.renderer.reloadLoadedMap(mapId | 0),
            onClientReset: async () => {
                this.clearMapImageUrls();
                clientCommands.reset();
                clientCommandRuntime.reset();
                this.walkDestination = undefined;
                await this.renderer.resetForCacheContext();
                this.resetMenu();
            },
        });
        this.debugActions = new DebugActionService({
            clientWorldState,
            getDevLocReplacementTypeId: () => this.getDevLocReplacementTypeId(),
            getCameraMapPosition: () => getCameraMapPosition(this.camera),
            applyWorldMutation: (input) => this.clientRuntime.applyWorldMutation(input),
        });
        this.renderer = new MapViewerRenderer(
            this,
            worldToClientWorldAdapter,
            worldInteractionIndex,
            worldSession,
            renderFrameCoordinator,
        );
        this.renderer.setStaticMapRuntime(
            this.createStaticMapRuntime(this.renderer.getStaticMapRuntimeCallbacks()),
        );
        this.mapImages = new MapViewerMapImages({
            renderWorkerPool,
            mapImageCache,
            getLoadedCacheName: () => this.loadedCache.info.name,
            getMapManager: () => this.renderer.mapManager,
        });

        if (initialSearchParams) {
            this.applySearchParams(initialSearchParams);
        }

        this.clientRuntime.initWorkers();
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
        return this.clientRuntime.loadedCache;
    }

    get session(): CacheSession {
        return this.clientRuntime.session;
    }

    get clientWorldState(): ClientWorldState {
        return this.clientRuntime.clientWorldState;
    }

    get clientCommands(): ClientCommandService {
        return this.clientRuntime.clientCommands;
    }

    get clientCommandRuntime(): ClientCommandRuntime {
        return this.clientRuntime.clientCommandRuntime;
    }

    getLatestPlayerIntent(): ClientPlayerIntent | undefined {
        return this.clientCommandRuntime.getLatestPlayerIntent();
    }

    getPendingPlayerIntent(): ClientPlayerIntent | undefined {
        return this.clientCommandRuntime.getPendingPlayerIntent();
    }

    clearPendingPlayerIntent(): void {
        this.clientCommandRuntime.clearPendingPlayerIntent();
    }

    applyWorldMutation(input: WorldMutationInput): Promise<number> {
        return this.clientRuntime.applyWorldMutation(input);
    }

    walkToScreenPoint(input: Readonly<{
        screenX: number;
        screenY: number;
        viewportWidth: number;
        viewportHeight: number;
    }>): boolean {
        const destination = resolveWalkDestination({
            ...input,
            viewProjMatrix: this.camera.viewProjMatrix,
        });
        if (!destination) {
            return false;
        }
        this.walkDestination = destination;
        this.clientCommands.walkToPosition(destination);
        return true;
    }

    updateWalkNavigation(deltaTime: number): boolean {
        const destination = this.walkDestination;
        if (!destination) {
            return false;
        }
        const reachedDestination = advanceWalkNavigation({
            destination,
            cameraPosition: this.camera.pos,
            cameraSpeed: this.cameraSpeed,
            deltaTime,
        });
        if (reachedDestination) {
            this.walkDestination = undefined;
        }
        return true;
    }

    examineWorldObject(target: Readonly<{ locTypeId: number; mapId?: number; locIndex?: number }>): void {
        this.clientCommands.examineWorldObject(target);
        this.openExamineLookup("object", target.locTypeId | 0);
    }

    examineGroundItem(target: Readonly<{ objTypeId: number; objInstance: ObjActionTargetInstance }>): void {
        this.clientCommands.examineGroundItem(target);
        this.openExamineLookup("item", target.objTypeId | 0);
    }

    examineActor(target: Readonly<{
        npcTypeId: number;
        npcInstance: Readonly<{ mapId: number; npcInstanceId: number }>;
    }>): void {
        this.clientCommands.examineActor(target);
        this.openExamineLookup("npc", target.npcTypeId | 0);
    }

    private openExamineLookup(lookupType: string, targetId: number): void {
        window.open(
            `https://oldschool.runescape.wiki/w/Special:Lookup?type=${lookupType}&id=${targetId | 0}`,
            "_blank",
        );
    }

    getSearchParams(): URLSearchParamsInit {
        return buildMapViewerSearchParams({
            camera: this.camera,
            loadedCacheName: this.loadedCache.info.name,
            latestCacheName: this.cacheList.latest.name,
            runtimeOptions: this.runtimeOptions,
            defaultRuntimeOptions: DEFAULT_RUNTIME_OPTIONS,
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
        return this.clientRuntime.getRuntimeOptions();
    }

    getMenuState(): ViewerMenuState {
        return this.menuState;
    }

    getDevLocReplacementTypeId(): number {
        return this.devLocReplacementTypeId | 0;
    }

    setDevLocReplacementTypeId(locTypeId: number): void {
        this.devLocReplacementTypeId = Math.max(0, locTypeId | 0);
    }

    restartVisibleWorldObjectAnimations(): Promise<number> {
        const animationResets: Array<Readonly<{ mapId: number; locIndex: number }>> = [];
        for (const mapId of this.getVisibleMapIds()) {
            const worldObjects = this.clientWorldState.getWorldObjectEntitiesForMap(mapId);
            for (let index = 0; index < (worldObjects.length | 0); index++) {
                const worldObject = worldObjects[index];
                if (!worldObject || !worldObject.visible) {
                    continue;
                }
                animationResets.push({
                    mapId,
                    locIndex: worldObject.rsBacking.locIndex | 0,
                });
            }
        }
        if ((animationResets.length | 0) <= 0) {
            return Promise.resolve(0);
        }
        return this.applyWorldMutation({
            loc: {
                animation: {
                    animationResets,
                },
            },
        });
    }

    restoreVisibleGroundItems(): Promise<number> {
        const additions: Array<Readonly<{ mapId: number; objIndex: number }>> = [];
        for (const mapId of this.getVisibleMapIds()) {
            const groundItems = this.clientWorldState.getStaticGroundItemEntitiesForMap(mapId);
            for (let index = 0; index < (groundItems.length | 0); index++) {
                const groundItem = groundItems[index];
                if (
                    !groundItem ||
                    !groundItem.visible ||
                    groundItem.rsBacking.kind !== "obj-static"
                ) {
                    continue;
                }
                additions.push({
                    mapId,
                    objIndex: groundItem.rsBacking.objIndex | 0,
                });
            }
        }
        if ((additions.length | 0) <= 0) {
            return Promise.resolve(0);
        }
        return this.applyWorldMutation({
            obj: {
                static: {
                    additions,
                },
            },
        });
    }

    dropGroundItemAtCamera(objTypeId: number, count: number): Promise<number> {
        const cameraPosition = getCameraMapPosition(this.camera);
        return this.applyWorldMutation({
            obj: {
                dynamic: {
                    dynamicSpawns: [
                        {
                            mapId: cameraPosition.mapId | 0,
                            objTypeId: objTypeId | 0,
                            count: Math.max(1, count | 0),
                            x: cameraPosition.x | 0,
                            y: cameraPosition.y | 0,
                            plane: cameraPosition.plane | 0,
                        },
                    ],
                },
            },
        });
    }

    clearVisibleDroppedItems(): Promise<number> {
        const visibleMapIds = this.getVisibleMapIds();
        if ((visibleMapIds.length | 0) <= 0) {
            return Promise.resolve(0);
        }
        return this.applyWorldMutation({
            obj: {
                dynamic: {
                    clearDynamicMaps: visibleMapIds,
                },
            },
        });
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

        await this.clientRuntime.setRuntimeOptions(normalized);
    }

    subscribeSearchParams(listener: SearchParamsListener): () => void {
        this.searchParamListeners.add(listener);
        return () => this.searchParamListeners.delete(listener);
    }

    subscribeCacheSwitchStatus(listener: (status: CacheSwitchStatus) => void): () => void {
        return this.clientRuntime.subscribeCacheSwitchStatus(listener);
    }

    getCacheSwitchStatus(): CacheSwitchStatus {
        return this.clientRuntime.getCacheSwitchStatus();
    }

    private emitSearchParams(debounceMs: number = 0): void {
        if (this.searchParamsDebounceTimer !== undefined) {
            window.clearTimeout(this.searchParamsDebounceTimer);
        }
        if ((debounceMs | 0) <= 0) {
            this.searchParamsDebounceTimer = undefined;
            this.notifySearchParamListeners();
            return;
        }
        this.searchParamsDebounceTimer = window.setTimeout(() => {
            this.searchParamsDebounceTimer = undefined;
            this.notifySearchParamListeners();
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
        await this.clientRuntime.switchCache(cacheInfo);
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
        this.emitSearchParams(200);
    }

    closeMenu = () => {
        this.menuState = {
            ...this.menuState,
            open: false,
            x: -1,
            y: -1,
        };
        this.renderer.canvas.focus();
    };

    resetMenu = () => {
        this.menuState = EMPTY_MENU_STATE;
        this.renderer.canvas.focus();
    };

    setMenuState(input: Readonly<{
        open: boolean;
        openedFrame: number;
        x: number;
        y: number;
        entries: ReadonlyArray<OsrsMenuEntry>;
    }>): void {
        this.menuState = {
            open: input.open,
            openedFrame: input.openedFrame | 0,
            x: input.x | 0,
            y: input.y | 0,
            entries: input.entries,
        };
    }

    updateVars(): void {
        this.clientRuntime.updateVars();
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

    private notifySearchParamListeners(): void {
        const params = this.getSearchParams();
        for (const listener of this.searchParamListeners) {
            listener(params);
        }
    }

    private getVisibleMapIds(): number[] {
        return this.renderer.mapManager.visibleMaps
            .slice(0, this.renderer.mapManager.visibleMapCount)
            .map((mapInfo) => mapInfo.mapId | 0);
    }

    private createStaticMapRuntime(
        callbacks: MapViewerStaticMapRuntimeCallbacks,
    ): MapViewerStaticMapRuntime {
        const applyPacket: MapViewerStaticMapRuntime["applyPacket"] = async (packet, input) => {
            const replaceMapId = input.replaceMapId;
            if (replaceMapId !== undefined) {
                callbacks.detachLoadedMapRuntime(replaceMapId);
            }
            try {
                const ok = await this.clientRuntime.worldSession.activateLoadedMap({
                    staticMap: packet,
                    activationVersion: input.activationVersion,
                });
                if (!ok) {
                    return false;
                }
            } catch (error: unknown) {
                const { mapX, mapY } = packet.mapData;
                const action = replaceMapId !== undefined ? "reload" : "register";
                console.warn(
                    `[map-render] failed to ${action} worker sim state for ${mapX},${mapY}`,
                    error,
                );
                return false;
            }

            await callbacks.finalizeLoadedMap(packet);
            if (input.invalidateLatestPacket === true) {
                this.clientRuntime.renderFrameCoordinator.invalidateLatestPacket();
            }
            return true;
        };

        const reloadMap: MapViewerStaticMapRuntime["reloadMap"] = async (mapId) => {
            const normalizedMapId = mapId | 0;
            const mapX = (normalizedMapId >> 8) & 0xff;
            const mapY = normalizedMapId & 0xff;
            const staticMapPacket = await callbacks.loadStaticMapPacket(mapX, mapY);
            if (!staticMapPacket || !callbacks.isValidMapPacket(staticMapPacket)) {
                return false;
            }
            return await applyPacket(staticMapPacket, {
                activationVersion: this.clientRuntime.worldSession.captureActivationVersion(),
                replaceMapId: normalizedMapId,
                invalidateLatestPacket: true,
            });
        };

        return {
            applyPacket,
            reloadMap,
        };
    }

}
