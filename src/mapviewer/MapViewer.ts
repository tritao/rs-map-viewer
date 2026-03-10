import { vec3 } from "gl-matrix";
import { URLSearchParamsInit } from "react-router-dom";

import type {
    ClientActorCommandTarget,
    ClientGroundItemCommandTarget,
    ClientWorldObjectCommandTarget,
    WalkDestination,
} from "../client/actions/ClientCommand";
import { ClientCommandService } from "../client/actions/ClientCommandService";
import {
    ClientIntentState,
    type ClientPlayerIntent,
} from "../client/actions/ClientIntentState";
import {
    type CacheSwitchStatus,
    ClientRuntime,
    type ClientRuntimeOptions,
} from "../client/runtime/ClientRuntime";
import { ClientWorldState } from "../client/world/ClientWorldState";
import { DebugActionService, getCameraMapPosition } from "../debug/DebugActionService";
import { Camera, CameraView } from "../renderer/Camera";
import { RenderFrameCoordinator } from "../renderer/RenderFrameCoordinator";
import type { ObjActionTargetInstance } from "../rs/MenuEntry";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import type { CacheSession } from "../rs/loaders/CacheSession";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import {
    CacheList,
    type LoadedCache,
    type LoadedCacheContext,
    loadCacheContext,
} from "../util/Caches";
import { isTouchDevice, isWallpaperEngine } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { Result, ok } from "../util/Result";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import type { WorkerRuntimeOptions } from "../worker/WorkerBuildTypes";
import { WorkerWorldRuntime } from "../worker/WorkerWorldRuntime";
import { WorldRenderInteractionIndex } from "../world/WorldRenderInteractionIndex";
import { WorldToClientWorldAdapter } from "../world/WorldToClientWorldAdapter";
import { type WorldMutationInput, WorldSession } from "../world/WorldSession";
import {
    MapViewerMenuState,
    type ViewerMenuState,
} from "./MapViewerMenuState";
import { MapViewerMapImages } from "./MapViewerMapImages";
import { advanceWalkNavigation, resolveWalkDestination } from "./MapViewerNavigation";
import {
    MapViewerRenderer,
    type MapViewerStaticMapRuntime,
    type MapViewerStaticMapRuntimeCallbacks,
} from "./MapViewerRenderer";
import {
    type DevFixedMapSquare,
    MapViewerSearchParamsState,
    type SearchParamsListener,
    applyMapViewerSearchParams,
    buildMapViewerSearchParams,
} from "./MapViewerSearchParams";

export type { CacheSwitchStatus } from "../client/runtime/ClientRuntime";

const DEFAULT_RENDER_DISTANCE = isWallpaperEngine ? 512 : 128;

type CacheContext = LoadedCacheContext;

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
    debugText?: string;

    private readonly mapImages: MapViewerMapImages;
    private readonly menuState: MapViewerMenuState;
    private readonly searchParamsState: MapViewerSearchParamsState;

    cameraSpeed: number = 1;
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
        const clientCommands = new ClientCommandService();
        const clientIntentState = new ClientIntentState();
        const worldToClientWorldAdapter = new WorldToClientWorldAdapter({
            clientWorldState,
        });
        const worldRenderInteractionIndex = new WorldRenderInteractionIndex();
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
            clientIntentState,
            clientWorldState,
            worldToClientWorldAdapter,
            worldRenderInteractionIndex,
            worldSession,
            renderFrameCoordinator,
            renderWorkerPool,
            simWorkerPool,
            cacheContext: context,
            runtimeOptions: normalizedRuntimeOptions,
            loadCacheContext,
            hasLoadedMap: (mapId) => this.renderer.hasLoadedMap(mapId | 0),
            reloadLoadedMap: (mapId) => this.renderer.reloadLoadedMap(mapId | 0),
            onClientReset: async () => {
                this.clearMapImageUrls();
                clientCommands.reset();
                clientIntentState.reset();
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
            worldRenderInteractionIndex,
            worldSession,
            renderFrameCoordinator,
        );
        this.renderer.setStaticMapRuntime(
            this.createStaticMapRuntime(this.renderer.getStaticMapRuntimeCallbacks()),
        );
        this.menuState = new MapViewerMenuState(() => this.renderer.canvas.focus());
        this.searchParamsState = new MapViewerSearchParamsState(() => this.getSearchParams());
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

    getWorkerRuntimeOptions(): MapViewerRuntimeOptions {
        return this.clientRuntime.getRuntimeOptions();
    }

    getLatestPlayerIntent(): ClientPlayerIntent | undefined {
        return this.clientRuntime.getLatestPlayerIntent();
    }

    getPendingPlayerIntent(): ClientPlayerIntent | undefined {
        return this.clientRuntime.getPendingPlayerIntent();
    }

    clearPendingPlayerIntent(): void {
        this.clientRuntime.clearPendingPlayerIntent();
    }

    updateClientIntents(): void {
        this.clientRuntime.updateClientIntents();
    }

    applyWorldMutation(input: WorldMutationInput): Promise<number> {
        return this.clientRuntime.applyWorldMutation(input);
    }

    subscribeCacheSwitchStatus(listener: (status: CacheSwitchStatus) => void): () => void {
        return this.clientRuntime.subscribeCacheSwitchStatus(listener);
    }

    getCacheSwitchStatus(): CacheSwitchStatus {
        return this.clientRuntime.getCacheSwitchStatus();
    }

    init(): void {
        this.mapImages.loadCachedUrls();
    }

    async switchCache(cacheInfo: CacheInfo): Promise<void> {
        await this.clientRuntime.switchCache(cacheInfo);
        this.updateSearchParams();
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

    applySearchParams(searchParams: URLSearchParams) {
        applyMapViewerSearchParams({
            searchParams,
            camera: this.camera,
            setDevFixedMapSquare: (square) => this.setDevFixedMapSquare(square),
        });
    }

    getSearchParams(): URLSearchParamsInit {
        return buildMapViewerSearchParams({
            camera: this.camera,
            loadedCacheName: this.loadedCache.info.name,
            latestCacheName: this.cacheList.latest.name,
            runtimeOptions: this.runtimeOptions,
            defaultRuntimeOptions: DEFAULT_RUNTIME_OPTIONS,
            devFixedMapSquare: this.getDevFixedMapSquare(),
        });
    }

    subscribeSearchParams(listener: SearchParamsListener): () => void {
        return this.searchParamsState.subscribe(listener);
    }

    updateSearchParams(): void {
        this.searchParamsState.update();
    }

    getDevFixedMapSquare(): DevFixedMapSquare | undefined {
        return this.renderer.mapManager.getFixedMapSquare();
    }

    // Dev feature: pin map loading to a single square (speeds iteration; reduces memory).
    setDevFixedMapSquare(square: DevFixedMapSquare | undefined): void {
        this.renderer.mapManager.applyFixedMapSquare(square);
        // Update URL immediately; no heavy work should run here.
        this.emitSearchParams();
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

    walkToScreenPoint(
        input: Readonly<{
            screenX: number;
            screenY: number;
            viewportWidth: number;
            viewportHeight: number;
        }>,
    ): boolean {
        const destination = resolveWalkDestination({
            ...input,
            viewProjMatrix: this.camera.viewProjMatrix,
        });
        if (!destination) {
            return false;
        }
        this.walkDestination = destination;
        this.clientRuntime.walkToPosition(destination);
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

    interactWithWorldObject(
        option: string,
        target: Readonly<{ locTypeId: number; locInstance?: Readonly<{ mapId: number; locIndex: number }> }>,
    ): void {
        this.clientRuntime.interactWithWorldObject(
            option,
            this.toWorldObjectCommandTarget(target),
        );
    }

    interactWithGroundItem(
        option: string,
        target: Readonly<{ objTypeId: number; objInstance: ObjActionTargetInstance }>,
    ): void {
        this.clientRuntime.interactWithGroundItem(option, this.toGroundItemCommandTarget(target));
    }

    interactWithActor(
        option: string,
        target: Readonly<{
            npcTypeId: number;
            npcInstance: Readonly<{ mapId: number; npcInstanceId: number }>;
        }>,
    ): void {
        this.clientRuntime.interactWithActor(option, this.toActorCommandTarget(target));
    }

    examineWorldObject(
        target: Readonly<{ locTypeId: number; mapId?: number; locIndex?: number }>,
    ): void {
        this.clientRuntime.examineWorldObject(this.toWorldObjectCommandTarget(target));
        this.openExamineLookup("object", target.locTypeId | 0);
    }

    examineGroundItem(
        target: Readonly<{ objTypeId: number; objInstance: ObjActionTargetInstance }>,
    ): void {
        this.clientRuntime.examineGroundItem(this.toGroundItemCommandTarget(target));
        this.openExamineLookup("item", target.objTypeId | 0);
    }

    examineActor(
        target: Readonly<{
            npcTypeId: number;
            npcInstance: Readonly<{ mapId: number; npcInstanceId: number }>;
        }>,
    ): void {
        this.clientRuntime.examineActor(this.toActorCommandTarget(target));
        this.openExamineLookup("npc", target.npcTypeId | 0);
    }

    private toWorldObjectCommandTarget(input: Readonly<{
        locTypeId: number;
        mapId?: number;
        locIndex?: number;
        locInstance?: Readonly<{ mapId: number; locIndex: number }>;
    }>): ClientWorldObjectCommandTarget {
        const locInstance = input.locInstance ??
            (input.mapId !== undefined && input.locIndex !== undefined
                ? {
                      mapId: input.mapId | 0,
                      locIndex: input.locIndex | 0,
                  }
                : undefined);
        const entity = locInstance
            ? this.clientWorldState.getWorldObjectEntity(
                  locInstance.mapId | 0,
                  locInstance.locIndex | 0,
              )
            : undefined;
        return {
            entityId: entity?.id,
            locTypeId: input.locTypeId | 0,
            backing: entity?.rsBacking,
        };
    }

    private toGroundItemCommandTarget(input: Readonly<{
        objTypeId: number;
        objInstance: ObjActionTargetInstance;
    }>): ClientGroundItemCommandTarget {
        const entity =
            input.objInstance.kind === "dynamic"
                ? this.clientWorldState.getDynamicGroundItemEntityByRuntimeObjId(
                      input.objInstance.mapId | 0,
                      input.objInstance.runtimeObjId | 0,
                  )
                : this.clientWorldState.getStaticGroundItemEntity(
                      input.objInstance.mapId | 0,
                      input.objInstance.objIndex | 0,
                  );
        return {
            entityId: entity?.id,
            objTypeId: input.objTypeId | 0,
            backing:
                input.objInstance.kind === "dynamic"
                    ? {
                          kind: "obj-dynamic",
                          mapId: input.objInstance.mapId | 0,
                          runtimeObjId: input.objInstance.runtimeObjId | 0,
                          objTypeId: input.objTypeId | 0,
                      }
                    : {
                          kind: "obj-static",
                          mapId: input.objInstance.mapId | 0,
                          objIndex: input.objInstance.objIndex | 0,
                          objTypeId: input.objTypeId | 0,
                      },
        };
    }

    private toActorCommandTarget(input: Readonly<{
        npcTypeId: number;
        npcInstance: Readonly<{ mapId: number; npcInstanceId: number }>;
    }>): ClientActorCommandTarget {
        const entity = this.clientWorldState.getActorEntityByNpcInstanceId(
            input.npcInstance.mapId | 0,
            input.npcInstance.npcInstanceId | 0,
        );
        return {
            entityId: entity?.id,
            npcTypeId: input.npcTypeId | 0,
            backing: {
                kind: "npc",
                mapId: input.npcInstance.mapId | 0,
                npcInstanceId: input.npcInstance.npcInstanceId | 0,
                npcTypeId: input.npcTypeId | 0,
            },
        };
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

    getMenuState(): ViewerMenuState {
        return this.menuState.getState();
    }

    closeMenu = () => {
        this.menuState.close();
    };

    resetMenu = () => {
        this.menuState.reset();
    };

    setMenuState(
        input: Readonly<{
            open: boolean;
            openedFrame: number;
            x: number;
            y: number;
            entries: ViewerMenuState["entries"];
        }>,
    ): void {
        this.menuState.set(input);
    }

    getDevLocReplacementTypeId(): number {
        return this.devLocReplacementTypeId | 0;
    }

    setDevLocReplacementTypeId(locTypeId: number): void {
        this.devLocReplacementTypeId = Math.max(0, locTypeId | 0);
    }

    private emitSearchParams(debounceMs: number = 0): void {
        this.searchParamsState.emit(debounceMs);
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

    warmLoadedMapMinimap(mapX: number, mapY: number, minimapBlob: Blob): void {
        this.mapImages.warmLoadedMapMinimap(mapX, mapY, minimapBlob);
    }

    clearMapImageUrls(): void {
        this.mapImages.clear();
    }

    dispose(): void {
        this.searchParamsState.dispose();
        this.menuState.dispose();
        this.walkDestination = undefined;
        this.clearMapImageUrls();
    }

    private openExamineLookup(lookupType: string, targetId: number): void {
        window.open(
            `https://oldschool.runescape.wiki/w/Special:Lookup?type=${lookupType}&id=${
                targetId | 0
            }`,
            "_blank",
        );
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
                const ok = await this.clientRuntime.activateLoadedMap({
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
                this.clientRuntime.invalidateLatestFramePacket();
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
                activationVersion: this.clientRuntime.captureActivationVersion(),
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
