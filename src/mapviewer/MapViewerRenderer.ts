import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import { Camera } from "./Camera";
import { InteractType } from "../renderer/InteractType";
import { INTERACTION_RADIUS } from "../runtime/contracts/Interaction";
import { MapManager, MapSquareInfo } from "./MapManager";
import { MapRenderer, MapSquareRenderable } from "../renderer/MapRenderer";
import { MapData } from "../renderer/loader/MapData";
import { SdMapData } from "../renderer/loader/SdMapData";
import {
    TICK_PATCH_STREAM_COUNT,
    type FramePacket,
} from "../runtime/contracts/FramePacket";
import { NpcGpuDataBuilder } from "../runtime/entities/NpcGpuDataBuilder";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../runtime/entities/NpcGpuData";
import { LocTickPatchVariant, NpcTickPatchVariant } from "../runtime/contracts/TickPatchStreams";
import { TickController, type TickPatchSink } from "../runtime/tick/TickController";
import {
    buildFramePacketFromMapEntries,
    createFramePacketMapEntry,
    computeFrameRenderFlags,
    type FramePacketMapEntry,
} from "../runtime/tick/MainThreadFramePacketBuilder";
import { MapRuntimeStateStore } from "../runtime/MapRuntimeStateStore";
import { WebGLMapRenderer } from "../renderer/webgl/WebGLMapRenderer";
import { SdMapDataLoader } from "../renderer/loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../renderer/loader/SdMapLoaderInput";
import { MenuTargetType } from "../rs/MenuEntry";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { isTouchDevice } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { clamp } from "../util/MathUtil";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { MapViewer } from "./MapViewer";
import type { MapViewerRuntimeOptions } from "./MapViewer";
import { SimWorld } from "./SimWorld";

const EMPTY_INT32 = new Int32Array(0);

export class MapViewerRenderer extends RendererMainLoop {
    inputManager: InputManager;
    workerPool: RenderDataWorkerPool;

    camera: Camera;
    pathfinder: Pathfinder;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    renderer: MapRenderer<MapSquareRenderable, MapData>;
    tickController: TickController;
    private lastRuntimeOptions: MapViewerRuntimeOptions | undefined;
    private readonly simWorld = new SimWorld();
    private readonly sdMapDataLoader = new SdMapDataLoader();
    private readonly npcGpuDataBuilder = new NpcGpuDataBuilder();
    private runtimeStateStore: MapRuntimeStateStore;
    private lastNpcSimInWorker: boolean = false;

    // State
    lastClientTick: number = 0;
    lastTick: number = 0;

    private isInitialized: boolean = false;
    private pendingFramePacket?: Promise<FramePacket | undefined>;
    private latestFramePacket?: FramePacket;
    private latestFramePacketFrameCount: number = -1;

    constructor(public mapViewer: MapViewer) {
        super();
        this.inputManager = mapViewer.inputManager;
        this.workerPool = mapViewer.workerPool;
        this.camera = mapViewer.camera;
        this.pathfinder = mapViewer.pathfinder;
        this.renderer = new WebGLMapRenderer(
            mapViewer.session,
            mapViewer.renderDistance,
            mapViewer.unloadDistance,
            mapViewer.lodDistance,
            this.camera,
            this.checkInteractions.bind(this),
        );
        this.tickController = new TickController();
        this.lastRuntimeOptions = this.mapViewer.getWorkerRuntimeOptions();
        this.lastNpcSimInWorker = !!this.lastRuntimeOptions?.mapRenderNpcSimInWorker;
        this.tickController.setRuntimeOptions(this.lastRuntimeOptions);
        this.runtimeStateStore = this.createRuntimeStateStore();
        this.mapManager = new MapManager(
            this.workerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
    }

    private async loadSdMapData(mapX: number, mapY: number): Promise<SdMapData | undefined> {
        const r = this.renderer;
        const input: SdMapLoaderInput = {
            mapX,
            mapY,
            maxLevel: r.maxLevel,
            loadObjs: r.loadObjs,
            loadNpcs: r.loadNpcs,
            loadLocs: r.loadLocs,
            smoothTerrain: r.smoothTerrain,
            minimizeDrawCalls: !r.hasMultiDraw,
            loadedTextureIds: r.loadedTextureIds,
        };
        return await this.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(this.sdMapDataLoader, input);
    }

    private createRuntimeStateStore(): MapRuntimeStateStore {
        return new MapRuntimeStateStore({
            seqTypeLoader: this.mapViewer.session.getSeqTypeLoader(),
            seqFrameLoader: this.mapViewer.session.getSeqFrameLoader(),
            npcTypeLoader: this.mapViewer.session.getNpcTypeLoader(),
            basTypeLoader: this.mapViewer.session.getBasTypeLoader(),
            onMapRemoved: (mapId: number): void => {
                this.tickController.onRenderableRemoved(mapId);
            },
        });
    }

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (devsq && (mapX !== devsq.mapX || mapY !== devsq.mapY)) {
            // Fixed-square dev mode: never queue builds for other squares.
            return;
        }
        const mapData = await this.loadSdMapData(mapX, mapY);
        const devsqAfter = this.mapViewer.getDevFixedMapSquare();
        if (
            devsqAfter &&
            mapData &&
            (mapData.mapX !== devsqAfter.mapX || mapData.mapY !== devsqAfter.mapY)
        ) {
            // Dev mode may have been enabled while this async build was in flight. Drop the result
            // to avoid loading/building maps outside the fixed square.
            this.mapManager.loadingMapIds.delete(getMapSquareId(mapData.mapX, mapData.mapY));
            return;
        }
        if (mapData) {
            if (this.renderer.isValidMapData(mapData)) {
                const sdMapData = mapData as unknown as SdMapData;
                const mapId = getMapSquareId(sdMapData.mapX, sdMapData.mapY);
                const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
                if (runtimeOptions.mapRenderTelemetry) {
                    const ranges = sdMapData.drawRanges.base;
                    const drawCount = Math.floor((ranges?.length ?? 0) / 3);
                    let nonZero = 0;
                    if (ranges instanceof Int32Array) {
                        for (let i = 0; i < drawCount; i++) {
                            const off = i * 3;
                            if ((ranges[off + 1] | 0) > 0) {
                                nonZero++;
                            }
                        }
                    }
                    console.log("[map-render][telemetry] map packet summary", {
                        square: `${sdMapData.mapX}:${sdMapData.mapY}`,
                        verts: sdMapData.vertices?.length ?? -1,
                        indices: sdMapData.indices?.length ?? -1,
                        drawRangesBaseCount: drawCount,
                        drawRangesBaseNonZero: nonZero,
                        loadObjs: sdMapData.loadObjs,
                        loadLocs: sdMapData.loadLocs,
                        loadNpcs: sdMapData.loadNpcs,
                        locsAnimated: sdMapData.locsAnimated?.length ?? -1,
                        npcs: sdMapData.npcs?.length ?? -1,
                        npcVerts: sdMapData.npcVertices?.length ?? 0,
                        npcIndices: sdMapData.npcIndices?.length ?? 0,
                    });
                }
                if (runtimeOptions.mapRenderNpcSimInWorker) {
                    const level1 = sdMapData.tileRenderFlags[1] ?? [];
                    void this.workerPool
                        .registerMapNpcSimState(
                        mapId,
                        sdMapData.borderSize,
                        level1,
                        sdMapData.collisionDatas,
                        sdMapData.locsAnimated,
                        sdMapData.npcs,
                        sdMapData.npcOrderKeys,
                        )
                        .catch(() => {
                            // Avoid unhandled promise rejections; registration is best-effort.
                        });
                } else {
                    // Store raw collision data; instantiate CollisionMap lazily only when sim needs it.
                    this.simWorld.onMapLoaded(mapId, sdMapData.collisionDatas);
                }
                this.runtimeStateStore.buildAndStoreMap(
                    mapId,
                    sdMapData,
                    performance.now() / 1000,
                );

                this.mapManager.addMap(mapX, mapY);
                this.renderer.addMap(mapData);

                if (mapData.minimapBlob.size > 0) {
                    this.mapViewer.setMapImageUrl(
                        mapData.mapX,
                        mapData.mapY,
                        URL.createObjectURL(mapData.minimapBlob),
                        true,
                        false,
                    );
                } else {
                    // Active cpp-wasm map payload can omit minimap blob; load it on demand.
                    void this.workerPool
                        .queueMapImage(mapData.mapX, mapData.mapY, 0, false)
                        .then((minimapData) => {
                            if (!minimapData) {
                                return;
                            }
                            if (minimapData.minimapBlob.size <= 0) {
                                return;
                            }
                            this.mapViewer.setMapImageUrl(
                                mapData.mapX,
                                mapData.mapY,
                                URL.createObjectURL(minimapData.minimapBlob),
                                true,
                                false,
                            );
                        })
                        .catch(() => {
                            // Ignore minimap warmup failures; map render path is still valid.
                        });
                }
            }
        } else {
            this.mapManager.addInvalidMap(mapX, mapY);
        }
    }

    async removeLoadedMap(mapInfo: MapSquareInfo): Promise<void> {
        this.runtimeStateStore.removeMap(mapInfo.mapId);
        this.renderer.removeMap(mapInfo);
        const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
        if (runtimeOptions.mapRenderNpcSimInWorker) {
            void this.workerPool.unregisterMapNpcSimState(mapInfo.mapId);
        } else {
            this.simWorld.onMapUnloaded(mapInfo.mapId);
        }
    }

    override async init() {
        super.init();
        this.inputManager.init(this.canvas);
        this.isInitialized = true;
    }

    initCache(): void {
        this.renderer.initCache();
        this.mapManager.init(
            this.mapViewer.session.mapFileIndex,
            SceneBuilder.fillEmptyTerrain(this.mapViewer.session.cache.info),
        );
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (devsq) {
            this.mapManager.setFixedMapSquare(devsq.mapX, devsq.mapY);
        } else {
            this.mapManager.clearFixedMapSquare();
        }
        this.mapManager.update(
            this.camera,
            this.renderer.stats.frameCount,
            this.renderer.renderDistance,
            this.renderer.unloadDistance,
        );
    }

    private pauseLoop(): boolean {
        const wasRunning = this.running;
        this.running = false;
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        return wasRunning;
    }

    private resumeLoop(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.animationId = requestAnimationFrame(this.frameCallback);
    }

    async applyCacheContext(): Promise<void> {
        const wasRunning = this.pauseLoop();

        try {
            await this.renderer.cleanUp();
            this.pendingFramePacket = undefined;
            this.latestFramePacket = undefined;
            this.latestFramePacketFrameCount = -1;
            this.lastNpcSimInWorker = false;
            this.mapManager.cleanUp();
            this.runtimeStateStore.clear();
            this.tickController.reset();

            this.renderer = new WebGLMapRenderer(
                this.mapViewer.session,
                this.mapViewer.renderDistance,
                this.mapViewer.unloadDistance,
                this.mapViewer.lodDistance,
                this.camera,
                this.checkInteractions.bind(this),
            );
            this.tickController = new TickController();
            this.lastRuntimeOptions = this.mapViewer.getWorkerRuntimeOptions();
            this.tickController.setRuntimeOptions(this.lastRuntimeOptions);
            this.runtimeStateStore = this.createRuntimeStateStore();
            this.mapManager = new MapManager(
                this.workerPool.size * 2,
                this.queueLoadMap.bind(this),
                this.removeLoadedMap.bind(this),
            );

            if (this.isInitialized) {
                await this.renderer.init(this.canvas);
            }
            this.initCache();
        } finally {
            if (wasRunning) {
                this.resumeLoop();
            }
        }
    }

    override async cleanUp(): Promise<void> {
        await super.cleanUp();
        this.inputManager.cleanUp();
        this.mapManager.cleanUp();
        this.runtimeStateStore.clear();
        this.tickController.reset();
    }

    override update(time: number, deltaTime: number) {
        this.handleInput(deltaTime);

        const { width, height } = this.renderer.getViewportDimensions();
        this.camera.update(width, height);

        const renderDistance = this.renderer.renderDistance;
        const frameCount = this.renderer.stats.frameCount;

        const mapManagerStart = performance.now();
        this.mapManager.update(
            this.camera,
            frameCount,
            renderDistance,
            this.renderer.unloadDistance,
        );
        this.mapManagerTime = performance.now() - mapManagerStart;

        this.renderer.getInteractionControllerRenderer()?.setInteractionInput({
            pointerLocked: this.inputManager.isPointerLock(),
            mouseX: this.inputManager.mouseX,
            mouseY: this.inputManager.mouseY,
        });

        const timeSec = time / 1000;

        const tick = Math.floor(timeSec / 0.6);
        const ticksElapsed = Math.min(tick - this.lastTick, 1);
        if (ticksElapsed > 0) {
            this.lastTick = tick;
        }

        const clientTick = Math.floor(timeSec / 0.02);
        const clientTicksElapsed = Math.min(clientTick - this.lastClientTick, 50);
        if (clientTicksElapsed > 0) {
            this.lastClientTick = clientTick;
        }

        const tickStart = performance.now();
        this.tickPass(timeSec, ticksElapsed, clientTicksElapsed);
        this.renderer.rendererStats.tickTime = performance.now() - tickStart;
    }

    tickPass(time: number, ticksElapsed: number, clientTicksElapsed: number): void {
        const cycle = time / 0.02;

        const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
        const prevNpcSimInWorker = this.lastNpcSimInWorker;
        if (runtimeOptions !== this.lastRuntimeOptions) {
            this.lastRuntimeOptions = runtimeOptions;
            this.tickController.setRuntimeOptions(runtimeOptions);
        }
        const npcSimInWorker = !!runtimeOptions.mapRenderNpcSimInWorker;
        this.lastNpcSimInWorker = npcSimInWorker;
        if (prevNpcSimInWorker && !npcSimInWorker) {
            // Ensure any packet-driven tick patch state is cleared when switching back to the
            // main-thread tick path.
            this.renderer.applyFramePacket(undefined);
            this.latestFramePacketFrameCount = -1;
        } else if (!prevNpcSimInWorker && npcSimInWorker) {
            // Clear stale packet state when switching into worker mode.
            this.pendingFramePacket = undefined;
            this.latestFramePacket = undefined;
            this.latestFramePacketFrameCount = -1;
            this.renderer.applyFramePacket(undefined);
        }

        if (this.tickWithWorkerPacketMode(cycle, ticksElapsed, clientTicksElapsed)) {
            return;
        }
        this.renderer.applyFramePacket(
            this.buildMainThreadFramePacket(cycle, ticksElapsed, clientTicksElapsed),
        );
    }

    private tickWithWorkerPacketMode(
        cycle: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
    ): boolean {
        if (!this.lastNpcSimInWorker) {
            return false;
        }

        const packet = this.latestFramePacket;
        // Apply the latest worker packet each frame. The renderer tracks frameCount to avoid
        // re-parsing; this keeps the npc offset rings in sync even if the packet lags.
        this.renderer.applyFramePacket(packet);
        if (packet && packet.frameCount !== this.latestFramePacketFrameCount) {
            this.latestFramePacketFrameCount = packet.frameCount | 0;
        }

        // Kick an async tick request if one isn't already in flight.
        if (
            !this.pendingFramePacket &&
            (ticksElapsed > 0 || clientTicksElapsed > 0 || !this.latestFramePacket)
        ) {
            const n = this.mapManager.visibleMapCount | 0;
            const mapIds = new Int32Array(n);
            for (let i = 0; i < n; i++) {
                mapIds[i] = this.mapManager.visibleMaps[i]!.mapId | 0;
            }
            const interactionSnapshotRenderer = this.renderer.getInteractionSnapshotRenderer?.();
            const hoveredMapIdsPacked =
                interactionSnapshotRenderer?.getHoveredMapIdsPacked() ?? new Int32Array(0);
            this.pendingFramePacket = this.workerPool
                .tickFrame(
                    this.renderer.stats.frameCount,
                    mapIds,
                    ticksElapsed,
                    clientTicksElapsed,
                    cycle,
                    this.camera.getMapX(),
                    this.camera.getMapY(),
                    this.renderer.lodDistance,
                    hoveredMapIdsPacked,
                )
                .then((pkt) => {
                    this.latestFramePacket = pkt;
                    return pkt;
                })
                .catch(() => {
                    this.latestFramePacket = undefined;
                    return undefined;
                })
                .finally(() => {
                    this.pendingFramePacket = undefined;
                });
        }

        // In worker mode, all per-map tick work happens in the worker; the renderer consumes the
        // resulting frame packet during draw.
        return true;
    }

    private buildMainThreadFramePacket(
        cycle: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
    ): FramePacket {
        this.npcGpuDataBuilder.beginFrame();

        const cameraMapX = this.camera.getMapX();
        const cameraMapY = this.camera.getMapY();
        const visibleCount = this.mapManager.visibleMapCount | 0;
        const entries = new Array<FramePacketMapEntry>(visibleCount | 0);
        const hoveredMapIds = this.getHoveredMapIds();

        const seqFrameLoader = this.mapViewer.session.getSeqFrameLoader();
        const seqTypeLoader = this.mapViewer.session.getSeqTypeLoader();

        for (let i = 0; i < visibleCount; i++) {
            const mapInfo = this.mapManager.visibleMaps[i];
            const mapId = mapInfo.mapId | 0;
            const streamsForMap = new Array<number[] | undefined>(TICK_PATCH_STREAM_COUNT);
            const streamCounts = new Int32Array(TICK_PATCH_STREAM_COUNT);
            let hasNpcs = false;
            let npcOffset = -1;
            const map = this.renderer.getMap(mapInfo.mapId)!;
            if (map && map.canRender(this.renderer.stats.frameCount)) {
                const tickState = this.runtimeStateStore.getTickState(mapId);
                const mapNpcs = tickState?.getNpcs() ?? [];
                if ((mapNpcs.length | 0) > 0) {
                    hasNpcs = true;
                }
                this.simWorld.tickNpcMovement(
                    mapInfo.mapId,
                    this.pathfinder,
                    map.borderSize,
                    mapNpcs,
                    ticksElapsed,
                );
                if (tickState) {
                    this.tickController.tickRenderable(
                        tickState,
                        cycle,
                        clientTicksElapsed,
                        seqTypeLoader,
                        seqFrameLoader,
                        this.createTickPatchSink(streamCounts, streamsForMap),
                    );
                }

                // Build per-frame NPC GPU instance data outside the WebGL renderer. This relies on
                // the map-square implementation exposing the scheduling offsets + tile flags.
                if (this.renderer.loadNpcs) {
                    const target = this.runtimeStateStore.createNpcGpuDataTarget(
                        mapId,
                        (level: number, tileX: number, tileY: number): number =>
                            map.getTileRenderFlag(level, tileX, tileY),
                    );
                    if (target) {
                        npcOffset = this.npcGpuDataBuilder.addRenderable(target);
                    }
                }
            }

            const renderFlags = computeFrameRenderFlags(
                mapId,
                cameraMapX,
                cameraMapY,
                this.renderer.lodDistance,
                hoveredMapIds,
                hasNpcs,
            );
            entries[i] = createFramePacketMapEntry({
                mapId,
                renderFlags,
                npcOffset,
                tickPatchCounts: streamCounts,
                tickPatchStreams: streamsForMap,
            });
        }

        const npcGpuFrameData = this.renderer.loadNpcs
            ? this.npcGpuDataBuilder.flushPacked()
            : { width: 16, height: 1, data: new Uint16Array(16 * 4) };
        const frameCount = this.renderer.stats.frameCount | 0;
        return buildFramePacketFromMapEntries({
            frameCount,
            npcRingWriteIndex: frameCount % NPC_DATA_TEXTURE_RING_SIZE,
            npcGpuFrameData,
            entries,
        });
    }

    private getHoveredMapIds(): Set<number> {
        const packed =
            this.renderer
                .getInteractionSnapshotRenderer?.()
                ?.getHoveredMapIdsPacked() ?? EMPTY_INT32;
        const out = new Set<number>();
        for (let i = 0; i < packed.length; i++) {
            out.add(packed[i] | 0);
        }
        return out;
    }

    private createTickPatchSink(
        streamCounts: Int32Array,
        streamsForMap: (number[] | undefined)[],
    ): TickPatchSink {
        return {
            emitLocPatch: (
                variant: LocTickPatchVariant,
                drawRangeIndex: number,
                offset: number,
                elements: number,
                instances: number,
            ): void => {
                if ((drawRangeIndex | 0) < 0) {
                    return;
                }
                const streamIndex = variant as number;
                streamCounts[streamIndex] = (streamCounts[streamIndex] + 1) | 0;
                let stream = streamsForMap[streamIndex];
                if (!stream) {
                    stream = [];
                    streamsForMap[streamIndex] = stream;
                }
                stream.push(drawRangeIndex | 0, offset | 0, elements | 0, instances | 0);
            },
            emitNpcPatch: (
                variant: NpcTickPatchVariant,
                drawRangeIndex: number,
                offset: number,
                elements: number,
                instances: number,
            ): void => {
                if ((drawRangeIndex | 0) < 0) {
                    return;
                }
                const streamIndex = (8 + (variant as number)) | 0;
                streamCounts[streamIndex] = (streamCounts[streamIndex] + 1) | 0;
                let stream = streamsForMap[streamIndex];
                if (!stream) {
                    stream = [];
                    streamsForMap[streamIndex] = stream;
                }
                stream.push(drawRangeIndex | 0, offset | 0, elements | 0, instances | 0);
            },
        };
    }

    override render(time: number, deltaTime: number, resized: boolean) {
        super.render(time, deltaTime, resized);
    }

    handleInput(deltaTime: number) {
        this.handleKeyInput(deltaTime);
        this.handleMouseInput();
        this.handleJoystickInput(deltaTime);
    }

    handleKeyInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.inputManager;
        const camera = this.mapViewer.camera;

        let cameraSpeedMult = 1.0;
        if (inputManager.isShiftDown()) {
            cameraSpeedMult = 10.0;
        }
        if (inputManager.isKeyDown("Tab")) {
            cameraSpeedMult = 0.1;
        }

        const deltaPitch = 64 * 5 * deltaTimeSec;
        const deltaYaw = 64 * 5 * deltaTimeSec;

        // camera direction controls
        if (inputManager.isKeyDown("ArrowUp")) {
            camera.updatePitch(camera.pitch, deltaPitch);
        }
        if (inputManager.isKeyDown("ArrowDown")) {
            camera.updatePitch(camera.pitch, -deltaPitch);
        }
        if (inputManager.isKeyDown("ArrowRight")) {
            camera.updateYaw(camera.yaw, deltaYaw);
        }
        if (inputManager.isKeyDown("ArrowLeft")) {
            camera.updateYaw(camera.yaw, -deltaYaw);
        }

        // camera position controls
        let deltaX = 0;
        let deltaY = 0;
        let deltaZ = 0;

        const deltaPos = 16 * (this.mapViewer.cameraSpeed * cameraSpeedMult) * deltaTimeSec;
        const deltaHeight = 8 * (this.mapViewer.cameraSpeed * cameraSpeedMult) * deltaTimeSec;

        if (inputManager.isKeyDown("KeyW")) {
            // Forward
            deltaZ -= deltaPos;
        }
        if (inputManager.isKeyDown("KeyA")) {
            // Left
            deltaX += deltaPos;
        }
        if (inputManager.isKeyDown("KeyS")) {
            // Back
            deltaZ += deltaPos;
        }
        if (inputManager.isKeyDown("KeyD")) {
            // Right
            deltaX -= deltaPos;
        }
        if (inputManager.isKeyDown("KeyE") || inputManager.isKeyDown("KeyR")) {
            // Move up
            deltaY -= deltaHeight;
        }
        if (
            inputManager.isKeyDown("KeyQ") ||
            inputManager.isKeyDown("KeyC") ||
            inputManager.isKeyDown("KeyF")
        ) {
            // Move down
            deltaY += deltaHeight;
        }

        if (deltaX !== 0 || deltaZ !== 0) {
            camera.move(deltaX, 0, deltaZ);
        }
        if (deltaY !== 0) {
            camera.move(0, deltaY, 0);
        }

        if (inputManager.isKeyDown("KeyP")) {
            camera.pos[0] = 2780;
            camera.pos[2] = 9537;
        }
    }

    handleMouseInput() {
        const camera = this.mapViewer.camera;

        if (this.inputManager.isPointerLock()) {
            this.mapViewer.closeMenu();
        }

        // mouse/touch controls
        const deltaMouseX = this.inputManager.getDeltaMouseX();
        const deltaMouseY = this.inputManager.getDeltaMouseY();

        if (deltaMouseX !== 0 || deltaMouseY !== 0) {
            if (this.inputManager.isTouch) {
                camera.move(0, clamp(-deltaMouseY, -100, 100) * 0.004, 0);
            } else {
                camera.updatePitch(camera.pitch, deltaMouseY * 0.9);
                camera.updateYaw(camera.yaw, deltaMouseX * -0.9);
            }
        }
    }

    handleJoystickInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const camera = this.mapViewer.camera;

        const deltaPitch = 64 * 5 * deltaTimeSec;
        const deltaYaw = 64 * 5 * deltaTimeSec;

        // joystick controls
        const positionJoystickEvent = this.inputManager.positionJoystickEvent;
        const cameraJoystickEvent = this.inputManager.cameraJoystickEvent;

        if (positionJoystickEvent) {
            const moveX = positionJoystickEvent.x ?? 0;
            const moveY = positionJoystickEvent.y ?? 0;

            camera.move(moveX * 32 * -deltaTimeSec, 0, moveY * 32 * -deltaTimeSec);
        }

        if (cameraJoystickEvent) {
            const moveX = cameraJoystickEvent.x ?? 0;
            const moveY = cameraJoystickEvent.y ?? 0;
            camera.updatePitch(camera.pitch, deltaPitch * 1.5 * moveY);
            camera.updateYaw(camera.yaw, deltaYaw * 1.5 * moveX);
        }
    }

    override onFrameEnd(): void {
        super.onFrameEnd();

        const frameStats = this.renderer.stats;
        const rendererStats = this.renderer.rendererStats;
        const frameTime = performance.now() - rendererStats.frameStart;

        if (this.inputManager.isKeyDown("KeyH")) {
            this.mapViewer.debugText = `MapManager: ${this.mapManagerTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyJ")) {
            this.mapViewer.debugText = `Interactions: ${rendererStats.interactionsTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyK")) {
            this.mapViewer.debugText = `Tick: ${rendererStats.tickTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyL")) {
            this.mapViewer.debugText = `Opaque Pass: ${rendererStats.opaquePassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyB")) {
            this.mapViewer.debugText = `Opaque Npc Pass: ${rendererStats.opaqueNpcPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyN")) {
            this.mapViewer.debugText = `Transparent Pass: ${rendererStats.transparentPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyM")) {
            this.mapViewer.debugText = `Transparent Npc Pass: ${rendererStats.transparentNpcPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyV")) {
            this.mapViewer.debugText = `Frame Time: ${frameTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyU")) {
            this.mapViewer.debugText = `Frame Time Js: ${frameStats.frameTimeJs.toFixed(2)}ms`;
        }

        if (window.wallpaperFpsLimit !== undefined) {
            this.fpsLimit = window.wallpaperFpsLimit;
        }

        if (this.mapViewer.camera.updated) {
            this.mapViewer.updateSearchParams();
        }

        this.inputManager.onFrameEnd();
        this.mapViewer.camera.onFrameEnd();

        // this.mapViewer.debugText = `Frame Time Js: ${this.stats.frameTimeJs.toFixed(3)}`;
    }

    checkInteractions(
        interactReady: boolean,
        interactBuffer: Float32Array,
        closestInteractIndices: Map<number, number[]>,
    ): void {
        const frameCount = this.renderer.stats.frameCount;

        const isMouseDown = this.inputManager.dragX !== -1 || this.inputManager.dragY !== -1;
        const picked = this.inputManager.pickX !== -1 && this.inputManager.pickY !== -1;

        if (!interactReady && !picked) return;

        const menuCooldown = isTouchDevice ? 50 : 10;

        if (
            this.inputManager.mouseX === -1 ||
            this.inputManager.mouseY === -1 ||
            frameCount - this.mapViewer.menuOpenedFrame < menuCooldown
        ) {
            return;
        }

        // Don't auto close menu on touch devices
        if (this.mapViewer.menuOpen && !picked && !isMouseDown && isTouchDevice) {
            return;
        }

        if (!picked && !this.mapViewer.tooltips) {
            this.mapViewer.closeMenu();
            return;
        }

        const menuEntries: OsrsMenuEntry[] = [];
        const examineEntries: OsrsMenuEntry[] = [];

        const locIds = new Set<number>();
        const objIds = new Set<number>();
        const npcIds = new Set<number>();

        for (let i = 0; i < INTERACTION_RADIUS + 1; i++) {
            const indices = closestInteractIndices.get(i);
            if (!indices) {
                continue;
            }
            for (const index of indices) {
                const interactId = interactBuffer[index];
                const interactType = interactBuffer[index + 2];
                if (interactType === InteractType.LOC) {
                    const locResult = this.mapViewer.session.tryLoadLocType(interactId);
                    if (!locResult.ok) {
                        continue;
                    }
                    const locType = locResult.value;
                    if (locType.name === "null" && !this.mapViewer.debugId) {
                        continue;
                    }
                    if (locIds.has(interactId)) {
                        continue;
                    }
                    locIds.add(interactId);

                    for (const option of locType.actions) {
                        if (!option) {
                            continue;
                        }
                        menuEntries.push({
                            option,
                            targetId: locType.id,
                            targetType: MenuTargetType.LOC,
                            targetName: locType.name,
                            targetLevel: -1,
                            onClick: this.mapViewer.closeMenu,
                        });
                    }

                    examineEntries.push({
                        option: "Examine",
                        targetId: locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: locType.name,
                        targetLevel: -1,
                        onClick: this.mapViewer.onExamine,
                    });
                } else if (interactType === InteractType.OBJ) {
                    const objResult = this.mapViewer.session.tryLoadObjType(interactId);
                    if (!objResult.ok) {
                        continue;
                    }
                    const objType = objResult.value;
                    if (objType.name === "null" && !this.mapViewer.debugId) {
                        continue;
                    }
                    if (objIds.has(interactId)) {
                        continue;
                    }
                    objIds.add(interactId);

                    for (const option of objType.groundActions) {
                        if (!option) {
                            continue;
                        }
                        menuEntries.push({
                            option,
                            targetId: objType.id,
                            targetType: MenuTargetType.OBJ,
                            targetName: objType.name,
                            targetLevel: -1,
                            onClick: this.mapViewer.closeMenu,
                        });
                    }

                    examineEntries.push({
                        option: "Examine",
                        targetId: objType.id,
                        targetType: MenuTargetType.OBJ,
                        targetName: objType.name,
                        targetLevel: -1,
                        onClick: this.mapViewer.onExamine,
                    });
                } else if (interactType === InteractType.NPC) {
                    const npcResult = this.mapViewer.session.tryLoadNpcType(interactId);
                    if (!npcResult.ok) {
                        continue;
                    }
                    let npcType = npcResult.value;
                    if (npcType.transforms) {
                        const transformed = npcType.transform(
                            this.mapViewer.session.varManager,
                            this.mapViewer.session.getNpcTypeLoader(),
                        );
                        if (!transformed) {
                            continue;
                        }
                        npcType = transformed;
                    }
                    if (npcType.name === "null" && !this.mapViewer.debugId) {
                        continue;
                    }
                    if (npcIds.has(interactId)) {
                        continue;
                    }
                    npcIds.add(interactId);

                    for (const option of npcType.actions) {
                        if (!option) {
                            continue;
                        }
                        menuEntries.push({
                            option,
                            targetId: npcType.id,
                            targetType: MenuTargetType.NPC,
                            targetName: npcType.name,
                            targetLevel: npcType.combatLevel,
                            onClick: this.mapViewer.closeMenu,
                        });
                    }

                    examineEntries.push({
                        option: "Examine",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        onClick: this.mapViewer.onExamine,
                    });
                }
            }
        }

        menuEntries.push({
            option: "Walk here",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: this.mapViewer.closeMenu,
        });
        menuEntries.push(...examineEntries);
        menuEntries.push({
            option: "Cancel",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: this.mapViewer.closeMenu,
        });

        this.mapViewer.menuOpen = picked;
        if (picked) {
            this.mapViewer.menuOpenedFrame = frameCount;
        }
        this.mapViewer.menuX = this.inputManager.mouseX;
        this.mapViewer.menuY = this.inputManager.mouseY;
        this.mapViewer.menuEntries = menuEntries;
    }
}
