import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import { MapData } from "../maprender/MapRenderPayload";
import { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import { InteractType } from "../renderer/InteractType";
import { MapRenderer, MapSquareRenderable } from "../renderer/MapRenderer";
import { WebGLMapRenderer } from "../renderer/webgl/WebGLMapRenderer";
import { MenuTargetType } from "../rs/MenuEntry";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { INTERACTION_RADIUS } from "../runtime/contracts/Interaction";
import { encodeNpcLifecyclePacketFromEvents } from "../runtime/contracts/NpcLifecyclePacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { StaticMapPacket } from "../runtime/contracts/StaticMapPacket";
import type { NpcEvent } from "../runtime/sim/NpcEvents";
import { isTouchDevice } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { clamp } from "../util/MathUtil";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import { Camera } from "./Camera";
import { MapManager, MapSquareInfo } from "./MapManager";
import { MapViewer } from "./MapViewer";
import { WorkerMapViewerFramePacketSource } from "./MapViewerFramePacketSource";
import { MapViewerTickCoordinator } from "./MapViewerTickCoordinator";

const DRAW_RANGE_STRIDE = 3;
const EMPTY_NPC_ORDER_KEYS = new Int32Array(0);
const EMPTY_NPC_TYPE_ANIMATION_TABLE: ReadonlyArray<NpcTypeAnimationEntry> = [];

export class MapViewerRenderer extends RendererMainLoop {
    inputManager: InputManager;
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;

    camera: Camera;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    renderer: MapRenderer<MapSquareRenderable, MapData>;
    private readonly tickCoordinator = new MapViewerTickCoordinator();
    private readonly framePacketSource: WorkerMapViewerFramePacketSource;
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private readonly staticMapPacketsByMapId = new Map<number, StaticMapPacket>();
    private nextMapSimToken: number = 1;
    private loadEpoch: number = 1;

    private isInitialized: boolean = false;

    constructor(public mapViewer: MapViewer) {
        super();
        this.inputManager = mapViewer.inputManager;
        this.renderWorkerPool = mapViewer.renderWorkerPool;
        this.simWorkerPool = mapViewer.simWorkerPool;
        this.camera = mapViewer.camera;
        this.renderer = new WebGLMapRenderer(
            mapViewer.session,
            mapViewer.renderDistance,
            mapViewer.unloadDistance,
            mapViewer.lodDistance,
            this.camera,
            this.checkInteractions.bind(this),
        );
        this.framePacketSource = new WorkerMapViewerFramePacketSource({
            simWorkerPool: this.simWorkerPool,
            renderWorkerPool: this.renderWorkerPool,
            getLodDistance: () => this.renderer.lodDistance,
            getHoveredMapIdsPacked: () =>
                this.renderer.getInteractionSnapshotRenderer?.()?.getHoveredMapIdsPacked(),
            isSeamTelemetryEnabled: () =>
                !!this.mapViewer.getWorkerRuntimeOptions().mapRenderTelemetry,
            getMapManager: () => this.mapManager,
            getCamera: () => this.camera,
        });
        this.mapManager = new MapManager(
            this.renderWorkerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
    }

    private async loadStaticMapPacket(
        mapX: number,
        mapY: number,
    ): Promise<StaticMapPacket | undefined> {
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
            loadedTextureIds: Int32Array.from(r.loadedTextureIds),
        };
        return await this.renderWorkerPool.queueStaticMapPacket(input);
    }

    private reserveMapSimToken(mapId: number): number {
        const token = this.nextMapSimToken | 0;
        this.nextMapSimToken = (token + 1) | 0;
        this.mapSimTokenByMapId.set(mapId | 0, token);
        return token;
    }

    private invalidateMapSimToken(mapId: number): number {
        return this.reserveMapSimToken(mapId | 0);
    }

    private hasMapSimToken(mapId: number, token: number): boolean {
        return (this.mapSimTokenByMapId.get(mapId | 0) ?? 0) === (token | 0);
    }

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const queuedLoadEpoch = this.loadEpoch | 0;
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (devsq && (mapX !== devsq.mapX || mapY !== devsq.mapY)) {
            // Fixed-square dev mode: never queue builds for other squares.
            return;
        }
        const staticMapPacket = await this.loadStaticMapPacket(mapX, mapY);
        if ((this.loadEpoch | 0) !== queuedLoadEpoch) {
            return;
        }
        const devsqAfter = this.mapViewer.getDevFixedMapSquare();
        if (
            devsqAfter &&
            staticMapPacket &&
            (staticMapPacket.mapData.mapX !== devsqAfter.mapX ||
                staticMapPacket.mapData.mapY !== devsqAfter.mapY)
        ) {
            // Dev mode may have been enabled while this async build was in flight. Drop the result
            // to avoid loading/building maps outside the fixed square.
            this.mapManager.loadingMapIds.delete(
                getMapSquareId(staticMapPacket.mapData.mapX, staticMapPacket.mapData.mapY),
            );
            return;
        }
        if (staticMapPacket) {
            const mapData = staticMapPacket.mapData;
            if (this.renderer.isValidMapData(mapData)) {
                const mapId = staticMapPacket.mapId | 0;
                const mapSimToken = this.reserveMapSimToken(mapId);
                const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
                if (runtimeOptions.mapRenderTelemetry) {
                    const ranges = mapData.drawRanges.base;
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
                        square: `${mapData.mapX}:${mapData.mapY}`,
                        verts: mapData.vertices?.length ?? -1,
                        indices: mapData.indices?.length ?? -1,
                        drawRangesBaseCount: drawCount,
                        drawRangesBaseNonZero: nonZero,
                        loadObjs: mapData.loadObjs,
                        loadLocs: mapData.loadLocs,
                        loadNpcs: mapData.loadNpcs,
                        locsAnimated: mapData.locsAnimated?.length ?? -1,
                        npcVerts: mapData.npcVertices?.length ?? 0,
                        npcIndices: mapData.npcIndices?.length ?? 0,
                        npcRangesBase: mapData.npcDrawRangesBase?.length ?? 0,
                        npcOrderKeys: mapData.npcOrderKeys?.length ?? 0,
                        npcTypeAnimTable: mapData.npcTypeAnimationTable?.length ?? 0,
                    });
                }
                const npcDrawRangeInts = mapData.npcDrawRangesBase?.length ?? 0;
                if (npcDrawRangeInts % DRAW_RANGE_STRIDE !== 0) {
                    throw new Error(
                        `[map-render][npc] invalid npcDrawRangesBase length for map ${mapData.mapX},${mapData.mapY}: ` +
                            `len=${npcDrawRangeInts} stride=${DRAW_RANGE_STRIDE}`,
                    );
                }
                const npcSlotCount = (npcDrawRangeInts / DRAW_RANGE_STRIDE) | 0;
                const npcOrderKeys = mapData.npcOrderKeys ?? EMPTY_NPC_ORDER_KEYS;
                if ((npcOrderKeys.length | 0) !== (npcSlotCount | 0)) {
                    throw new Error(
                        `[map-render][npc] npc slot metadata mismatch for map ${mapData.mapX},${mapData.mapY}: ` +
                            `orderKeys=${npcOrderKeys.length | 0} slots=${npcSlotCount | 0}`,
                    );
                }
                const npcTypeAnimationTable =
                    mapData.npcTypeAnimationTable ?? EMPTY_NPC_TYPE_ANIMATION_TABLE;
                try {
                    await this.renderWorkerPool.registerMapNpcRenderState(
                        mapId,
                        mapData.borderSize,
                        mapData.tileRenderFlags[1] ?? [],
                        mapData.locsAnimated,
                        npcTypeAnimationTable,
                        mapSimToken,
                    );
                    await this.simWorkerPool.registerMapNpcSimState(
                        mapId,
                        mapData.borderSize,
                        mapData.locsAnimated,
                        npcTypeAnimationTable,
                        mapSimToken,
                    );
                    await this.simWorkerPool.bootstrapMapNpcLifecycle(
                        mapId,
                        mapData.maxLevel,
                        npcOrderKeys,
                        mapSimToken,
                    );
                } catch (e) {
                    void this.renderWorkerPool.unregisterMapNpcRenderState(mapId, mapSimToken);
                    console.warn(
                        `[map-render] failed to register worker sim state for ${mapData.mapX},${mapData.mapY}`,
                        e,
                    );
                    this.mapManager.addInvalidMap(mapData.mapX, mapData.mapY);
                    return;
                }
                if (
                    (this.loadEpoch | 0) !== queuedLoadEpoch ||
                    !this.hasMapSimToken(mapId, mapSimToken)
                ) {
                    return;
                }

                this.staticMapPacketsByMapId.set(mapId, staticMapPacket);
                this.mapManager.addMap(staticMapPacket.mapData.mapX, staticMapPacket.mapData.mapY);
                this.renderer.addMap(staticMapPacket.mapData as unknown as MapData);

                if (staticMapPacket.mapData.minimapBlob.size > 0) {
                    this.mapViewer.setMapImageUrl(
                        staticMapPacket.mapData.mapX,
                        staticMapPacket.mapData.mapY,
                        URL.createObjectURL(staticMapPacket.mapData.minimapBlob),
                        true,
                        false,
                    );
                } else {
                    // Active cpp-wasm map payload can omit minimap blob; load it on demand.
                    void this.renderWorkerPool
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
        this.renderer.removeMap(mapInfo);
        this.staticMapPacketsByMapId.delete(mapInfo.mapId | 0);
        const mapSimToken = this.invalidateMapSimToken(mapInfo.mapId);
        void this.simWorkerPool.unregisterMapNpcSimState(mapInfo.mapId, mapSimToken);
        void this.renderWorkerPool.unregisterMapNpcRenderState(mapInfo.mapId, mapSimToken);
    }

    async applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        if ((events.length | 0) <= 0) {
            return 0;
        }
        const packet = encodeNpcLifecyclePacketFromEvents(events);
        return this.applyNpcLifecyclePacketBytes(packet);
    }

    private async applyNpcLifecyclePacketBytes(
        packet: ArrayBuffer | ArrayBufferView,
    ): Promise<number> {
        const bytes =
            packet instanceof Uint8Array
                ? packet
                : packet instanceof ArrayBuffer
                ? new Uint8Array(packet)
                : new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength);
        return await this.simWorkerPool.applyNpcLifecyclePacketBytes(bytes);
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
        this.tickCoordinator.requestClockResync();
        this.animationId = requestAnimationFrame(this.frameCallback);
    }

    async applyCacheContext(): Promise<void> {
        const wasRunning = this.pauseLoop();
        this.loadEpoch = (this.loadEpoch + 1) | 0;
        this.mapSimTokenByMapId.clear();
        this.staticMapPacketsByMapId.clear();

        try {
            await this.renderer.cleanUp();
            this.tickCoordinator.resetForCacheContext(this.framePacketSource);
            this.mapManager.cleanUp();

            this.renderer = new WebGLMapRenderer(
                this.mapViewer.session,
                this.mapViewer.renderDistance,
                this.mapViewer.unloadDistance,
                this.mapViewer.lodDistance,
                this.camera,
                this.checkInteractions.bind(this),
            );
            this.mapManager = new MapManager(
                this.renderWorkerPool.size * 2,
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
        this.loadEpoch = (this.loadEpoch + 1) | 0;
        this.mapSimTokenByMapId.clear();
        this.staticMapPacketsByMapId.clear();
        this.tickCoordinator.resetForShutdown(this.framePacketSource);
        this.inputManager.cleanUp();
        this.mapManager.cleanUp();
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
        const tickState = this.tickCoordinator.advanceClocks(timeSec);

        const tickStart = performance.now();
        this.tickPass(tickState.cycle, tickState.ticksElapsed, tickState.clientTicksElapsed);
        this.renderer.rendererStats.tickTime = performance.now() - tickStart;
    }

    tickPass(cycle: number, ticksElapsed: number, clientTicksElapsed: number): void {
        this.tickCoordinator.applyTick({
            frameInput: {
                frameCount: this.renderer.stats.frameCount,
                cycle,
                ticksElapsed,
                clientTicksElapsed,
            },
            packetSource: this.framePacketSource,
            applyFramePacket: (packet) => this.renderer.applyFramePacket(packet),
        });
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
