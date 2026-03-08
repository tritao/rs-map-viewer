import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import {
    type MapData,
    type ObjRenderData,
    type SdMapLoaderInput,
} from "../maprender/MapRenderPayload";
import { InteractType } from "../runtime/contracts/InteractType";
import { MapRenderer, MapSquareRenderable } from "../renderer/MapRenderer";
import { createRendererTexturePolicy } from "../renderer/RendererTexturePolicy";
import { WebGLMapRenderer } from "../renderer/webgl/WebGLMapRenderer";
import { MenuTargetType } from "../rs/MenuEntry";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { INTERACTION_RADIUS } from "../runtime/contracts/Interaction";
import type { MapObjRenderPacket } from "../runtime/contracts/MapObjRenderPacket";
import type { DecodedStaticMapPacket } from "../runtime/contracts/StaticMapWireCodec";
import {
    collectInteractionHits,
    resolveInteractionTargets,
} from "../runtime/InteractionTargets";
import {
    type MapFrameSeamSample,
    WorkerMapFrameCoordinator,
} from "../runtime/MapFrameCoordinator";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import { isTouchDevice } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { clamp } from "../util/MathUtil";
import { MapWorldSession } from "../runtime/MapWorldSession";
import { Camera } from "../runtime/Camera";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import { MapManager, MapSquareInfo } from "./MapManager";
import { MapViewer } from "./MapViewer";
import { MapTickCoordinator } from "./MapTickCoordinator";

export class MapViewerRenderer extends RendererMainLoop {
    inputManager: InputManager;
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;

    camera: Camera;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    renderer: MapRenderer<MapSquareRenderable, MapData>;
    private readonly tickCoordinator = new MapTickCoordinator();
    private readonly frameRuntimeCoordinator: WorkerMapFrameCoordinator;
    private readonly mapWorldSession: MapWorldSession;
    private seamSampleCount: number = 0;
    private seamSimMsTotal: number = 0;
    private seamApplyMsTotal: number = 0;
    private seamPackMsTotal: number = 0;
    private seamTotalMsTotal: number = 0;
    private seamEventCountTotal: number = 0;

    private isInitialized: boolean = false;

    private createRenderer(): MapRenderer<MapSquareRenderable, MapData> {
        const texturePolicy = createRendererTexturePolicy(this.mapViewer.session.cache.info);
        return new WebGLMapRenderer(
            {
                cacheName: this.mapViewer.session.cache.info.name,
                textureLoader: this.mapViewer.session.loaders.textureLoader,
                isNewTextureAnim: texturePolicy.isNewTextureAnim,
                maxTexturePreloadCount: texturePolicy.maxTexturePreloadCount,
            },
            this.mapViewer.renderDistance,
            this.mapViewer.unloadDistance,
            this.mapViewer.lodDistance,
            this.camera,
            this.checkInteractions.bind(this),
        );
    }

    private createMapManager(): MapManager {
        return new MapManager(
            this.renderWorkerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
    }

    constructor(public mapViewer: MapViewer) {
        super();
        this.inputManager = mapViewer.inputManager;
        this.renderWorkerPool = mapViewer.renderWorkerPool;
        this.simWorkerPool = mapViewer.simWorkerPool;
        this.camera = mapViewer.camera;
        this.renderer = this.createRenderer();
        this.frameRuntimeCoordinator = new WorkerMapFrameCoordinator({
            simWorkerPool: this.simWorkerPool,
            renderWorkerPool: this.renderWorkerPool,
            getLodDistance: () => this.renderer.lodDistance,
            getHoveredMapIdsPacked: () =>
                this.renderer.getInteractionSnapshotRenderer?.()?.getHoveredMapIdsPacked(),
            getVisibleMapIds: () => {
                const n = this.mapManager.visibleMapCount | 0;
                if ((n | 0) <= 0) {
                    return new Int32Array(0);
                }
                const mapIds = new Int32Array(n);
                for (let i = 0; i < n; i++) {
                    mapIds[i] = this.mapManager.visibleMaps[i]!.mapId | 0;
                }
                return mapIds;
            },
            getCameraMapX: () => this.camera.getMapX(),
            getCameraMapY: () => this.camera.getMapY(),
            reportSeamSample: (sample) => this.recordFrameSeamSample(sample),
        });
        this.mapWorldSession = new MapWorldSession({
            renderWorkerPool: this.renderWorkerPool,
            simWorkerPool: this.simWorkerPool,
            requestFrameRefresh: () => this.frameRuntimeCoordinator.invalidateLatestPacket(),
        });
        this.mapManager = this.createMapManager();
    }

    private async loadStaticMapPacket(
        mapX: number,
        mapY: number,
    ): Promise<DecodedStaticMapPacket | undefined> {
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

    private recordFrameSeamSample(sample: MapFrameSeamSample): void {
        if (!this.mapViewer.getWorkerRuntimeOptions().mapRenderTelemetry) {
            return;
        }
        this.seamSampleCount = (this.seamSampleCount + 1) | 0;
        this.seamSimMsTotal += sample.simMs;
        this.seamApplyMsTotal += sample.applyMs;
        this.seamPackMsTotal += sample.packMs;
        this.seamTotalMsTotal += sample.totalMs;
        this.seamEventCountTotal += sample.eventCount | 0;
        if ((this.seamSampleCount | 0) < 120) {
            return;
        }
        const count = this.seamSampleCount | 0;
        console.log("[map-render][frame-seam] avg", {
            samples: count,
            simMs: this.seamSimMsTotal / count,
            applyMs: this.seamApplyMsTotal / count,
            packMs: this.seamPackMsTotal / count,
            totalMs: this.seamTotalMsTotal / count,
            eventsPerFrame: this.seamEventCountTotal / count,
        });
        this.seamSampleCount = 0;
        this.seamSimMsTotal = 0;
        this.seamApplyMsTotal = 0;
        this.seamPackMsTotal = 0;
        this.seamTotalMsTotal = 0;
        this.seamEventCountTotal = 0;
    }

    private shouldDropStaticMapPacketForDevSquare(
        staticMapPacket: DecodedStaticMapPacket | undefined,
    ): boolean {
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (
            !devsq ||
            !staticMapPacket ||
            (staticMapPacket.mapData.mapX === devsq.mapX &&
                staticMapPacket.mapData.mapY === devsq.mapY)
        ) {
            return false;
        }
        this.mapManager.loadingMapIds.delete(
            getMapSquareId(staticMapPacket.mapData.mapX, staticMapPacket.mapData.mapY),
        );
        return true;
    }

    private logMapPacketTelemetry(packet: DecodedStaticMapPacket): void {
        const mapData = packet.mapData;
        const runtimeRegistration = packet.runtimeRegistration;
        const runtimeBootstrap = packet.runtimeBootstrap;
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
            locsAnimated: runtimeRegistration.locsAnimated.length,
            npcVerts: mapData.npcVertices?.length ?? 0,
            npcIndices: mapData.npcIndices?.length ?? 0,
            npcRangesBase: mapData.npcDrawRangesBase?.length ?? 0,
            npcOrderKeys: runtimeBootstrap.npcOrderKeys.length | 0,
            npcTypeAnimTable: runtimeRegistration.npcTypeAnimationTable.length,
        });
    }

    private async finalizeLoadedMap(packet: DecodedStaticMapPacket): Promise<void> {
        const mapData = packet.mapData;
        this.mapWorldSession.attachLoadedMapRuntime(packet);
        this.mapManager.addMap(mapData.mapX, mapData.mapY);
        this.renderer.addMap(mapData);
        if (mapData.minimapBlob.size > 0) {
            this.mapViewer.setMapImageUrl(
                mapData.mapX,
                mapData.mapY,
                URL.createObjectURL(mapData.minimapBlob),
                true,
                false,
            );
            return;
        }
        void this.renderWorkerPool
            .queueMapImage(mapData.mapX, mapData.mapY, 0, false)
            .then((minimapData) => {
                if (!minimapData || minimapData.minimapBlob.size <= 0) {
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

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const queuedLoadEpoch = this.mapWorldSession.captureLoadEpoch();
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (devsq && (mapX !== devsq.mapX || mapY !== devsq.mapY)) {
            // Fixed-square dev mode: never queue builds for other squares.
            return;
        }
        const staticMapPacket = await this.loadStaticMapPacket(mapX, mapY);
        if (!this.mapWorldSession.hasLoadEpoch(queuedLoadEpoch)) {
            return;
        }
        if (this.shouldDropStaticMapPacketForDevSquare(staticMapPacket)) {
            return;
        }
        if (!staticMapPacket) {
            this.mapManager.addInvalidMap(mapX, mapY);
            return;
        }
        if (!this.renderer.isValidMapData(staticMapPacket.mapData)) {
            return;
        }
        if (this.mapViewer.getWorkerRuntimeOptions().mapRenderTelemetry) {
            this.logMapPacketTelemetry(staticMapPacket);
        }
        try {
            const ok = await this.mapWorldSession.registerActiveLoadedMap(
                staticMapPacket,
                queuedLoadEpoch,
            );
            if (!ok) {
                return;
            }
        } catch (e) {
            console.warn(
                `[map-render] failed to register worker sim state for ${staticMapPacket.mapData.mapX},${staticMapPacket.mapData.mapY}`,
                e,
            );
            this.mapManager.addInvalidMap(staticMapPacket.mapData.mapX, staticMapPacket.mapData.mapY);
            return;
        }
        await this.finalizeLoadedMap(staticMapPacket);
    }

    async removeLoadedMap(mapInfo: MapSquareInfo): Promise<void> {
        this.renderer.removeMap(mapInfo);
        this.mapWorldSession.unregisterLoadedMap(mapInfo.mapId);
    }

    async applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        return await this.mapWorldSession.applyNpcLifecycleEvents(events);
    }

    replaceMapObjRenderData(
        mapX: number,
        mapY: number,
        objRenderData: ObjRenderData | undefined,
    ): void {
        this.mapWorldSession.replaceMapObjRenderData(
            getMapSquareId(mapX, mapY),
            objRenderData,
        );
    }

    applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): void {
        this.mapWorldSession.applyMapObjRenderPacket(packet);
    }

    override async init() {
        super.init();
        this.inputManager.init(this.canvas);
        this.isInitialized = true;
    }

    initializeCacheState(): void {
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

    private async recreateRendererAndMapManager(): Promise<void> {
        this.renderer = this.createRenderer();
        this.mapManager = this.createMapManager();

        if (this.isInitialized) {
            await this.renderer.init(this.canvas);
        }
    }

    async resetForCacheContext(): Promise<void> {
        const wasRunning = this.pauseLoop();
        this.mapWorldSession.reset();

        try {
            await this.renderer.cleanUp();
            this.tickCoordinator.resetForCacheContext(this.frameRuntimeCoordinator);
            this.mapManager.cleanUp();
            await this.recreateRendererAndMapManager();
            this.initializeCacheState();
        } finally {
            if (wasRunning) {
                this.resumeLoop();
            }
        }
    }

    override async cleanUp(): Promise<void> {
        await super.cleanUp();
        this.mapWorldSession.reset();
        this.tickCoordinator.resetForShutdown(this.frameRuntimeCoordinator);
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
            frameRuntimeCoordinator: this.frameRuntimeCoordinator,
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
        if (this.inputManager.isKeyDown("KeyG")) {
            this.mapViewer.debugText =
                `Draw Calls: ${rendererStats.drawCalls} ` +
                `(ranges: ${rendererStats.drawRangeCalls}, multi: ${rendererStats.multiDrawCalls})`;
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
        const interactionHits = collectInteractionHits({
            interactBuffer,
            closestInteractIndices,
            maxDistance: INTERACTION_RADIUS,
        });
        const interactionTargets = resolveInteractionTargets({
            session: this.mapViewer.session,
            hits: interactionHits,
            includeUnnamed: this.mapViewer.debugId,
        });
        for (const target of interactionTargets) {
            if (target.kind === InteractType.LOC) {
                for (const option of target.locType.actions) {
                    if (!option) {
                        continue;
                    }
                    menuEntries.push({
                        option,
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        onClick: this.mapViewer.closeMenu,
                    });
                }
                examineEntries.push({
                    option: "Examine",
                    targetId: target.locType.id,
                    targetType: MenuTargetType.LOC,
                    targetName: target.locType.name,
                    targetLevel: -1,
                    onClick: this.mapViewer.onExamine,
                });
                continue;
            }
            if (target.kind === InteractType.OBJ) {
                for (const option of target.objType.groundActions) {
                    if (!option) {
                        continue;
                    }
                    menuEntries.push({
                        option,
                        targetId: target.objType.id,
                        targetType: MenuTargetType.OBJ,
                        targetName: target.objType.name,
                        targetLevel: -1,
                        onClick: this.mapViewer.closeMenu,
                    });
                }
                examineEntries.push({
                    option: "Examine",
                    targetId: target.objType.id,
                    targetType: MenuTargetType.OBJ,
                    targetName: target.objType.name,
                    targetLevel: -1,
                    onClick: this.mapViewer.onExamine,
                });
                continue;
            }
            for (const option of target.npcType.actions) {
                if (!option) {
                    continue;
                }
                menuEntries.push({
                    option,
                    targetId: target.npcType.id,
                    targetType: MenuTargetType.NPC,
                    targetName: target.npcType.name,
                    targetLevel: target.npcType.combatLevel,
                    onClick: this.mapViewer.closeMenu,
                });
            }
            examineEntries.push({
                option: "Examine",
                targetId: target.npcType.id,
                targetType: MenuTargetType.NPC,
                targetName: target.npcType.name,
                targetLevel: target.npcType.combatLevel,
                onClick: this.mapViewer.onExamine,
            });
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
