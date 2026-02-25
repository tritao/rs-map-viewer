import { Schema } from "leva/dist/declarations/src/types";

import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import { Camera } from "../renderer/Camera";
import { InteractType } from "../renderer/InteractType";
import { INTERACTION_RADIUS } from "../renderer/Interactions";
import { MapManager, MapSquareInfo } from "../renderer/MapManager";
import { MapRenderer, MapSquareRenderable } from "../renderer/MapRenderer";
import { MapData } from "../renderer/loader/MapData";
import {
    registerDrawRangeTickState,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
} from "../renderer/webgl/DrawRangePatchBackend";
import { WebGLMapRenderer } from "../renderer/webgl/WebGLMapRenderer";
import { LOC_CYCLE_SCALE, WebGLRenderable } from "../renderer/webgl/WebGLRenderable";
import { MenuTargetType } from "../rs/MenuEntry";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { CacheSession } from "../rs/runtime/createCacheSession";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { isTouchDevice } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { clamp } from "../util/MathUtil";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { MapViewer } from "./MapViewer";

export class MapViewerRenderer extends RendererMainLoop {
    inputManager: InputManager;
    workerPool: RenderDataWorkerPool;

    camera: Camera;
    pathfinder: Pathfinder;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    renderer: MapRenderer<MapSquareRenderable, MapData>;

    // State
    lastClientTick: number = 0;
    lastTick: number = 0;

    private isInitialized: boolean = false;

    private strictFailure(reason: string): never {
        throw new Error(`[map-render-backend][strict-cpp-wasm] ${reason}`);
    }

    constructor(public mapViewer: MapViewer) {
        super();
        this.inputManager = mapViewer.inputManager;
        this.workerPool = mapViewer.workerPool;
        this.camera = mapViewer.camera;
        this.pathfinder = mapViewer.pathfinder;
        this.renderer = new WebGLMapRenderer(
            mapViewer.session,
            this.workerPool,
            this.inputManager,
            mapViewer.renderDistance,
            mapViewer.unloadDistance,
            mapViewer.lodDistance,
            this.camera,
        );
        if (this.renderer instanceof WebGLMapRenderer) {
            const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
            const tickBackend =
                runtimeOptions.mapRenderTickBackend ?? runtimeOptions.mapRenderBackend;
            this.renderer.setDrawRangePatchStrictCppWasm(
                !!runtimeOptions.mapRenderStrictCppWasm && tickBackend === "cpp-wasm",
            );
        }
        this.mapManager = new MapManager(
            this.workerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
    }

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const mapData = await this.renderer.loadMapData(mapX, mapY);
        if (mapData) {
            if (this.renderer.isValidMapData(mapData)) {
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
        this.renderer.removeMap(mapInfo);
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
            await Promise.resolve(this.renderer.cleanUp());
            this.mapManager.cleanUp();

            this.renderer = new WebGLMapRenderer(
                this.mapViewer.session,
                this.workerPool,
                this.inputManager,
                this.mapViewer.renderDistance,
                this.mapViewer.unloadDistance,
                this.mapViewer.lodDistance,
                this.camera,
            );
            if (this.renderer instanceof WebGLMapRenderer) {
                const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
                const tickBackend =
                    runtimeOptions.mapRenderTickBackend ?? runtimeOptions.mapRenderBackend;
                this.renderer.setDrawRangePatchStrictCppWasm(
                    !!runtimeOptions.mapRenderStrictCppWasm && tickBackend === "cpp-wasm",
                );
            }
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
        super.cleanUp();
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

        this.renderer.visibleMapCount = this.mapManager.visibleMapCount;
        this.renderer.visibleMaps = this.mapManager.visibleMaps;

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
        const cycleNowFixed = Math.round(cycle * LOC_CYCLE_SCALE) | 0;

        const seqFrameLoader = this.mapViewer.session.getSeqFrameLoader();
        const seqTypeLoader = this.mapViewer.session.getSeqTypeLoader();
        const runtimeOptions = this.mapViewer.getWorkerRuntimeOptions();
        const tickBackend = runtimeOptions.mapRenderTickBackend ?? runtimeOptions.mapRenderBackend;
        const drawRangePatchReady =
            this.renderer instanceof WebGLMapRenderer && this.renderer.isDrawRangePatchWasmReady();
        const drawRangePatchInitComplete =
            this.renderer instanceof WebGLMapRenderer &&
            this.renderer.isDrawRangePatchWasmInitComplete();
        const requireCppWasmTickPath =
            tickBackend === "cpp-wasm" &&
            this.renderer instanceof WebGLMapRenderer &&
            drawRangePatchReady;
        if (
            tickBackend === "cpp-wasm" &&
            this.renderer instanceof WebGLMapRenderer &&
            drawRangePatchInitComplete &&
            !drawRangePatchReady
        ) {
            if (runtimeOptions.mapRenderStrictCppWasm) {
                this.strictFailure("drawRangePatchBackendNotReady");
            }
        }
        const useMapRenderWasm = requireCppWasmTickPath;
        const strictCppWasm = !!runtimeOptions.mapRenderStrictCppWasm && tickBackend === "cpp-wasm";

        const debugTickSquare = runtimeOptions.mapRenderDebugTickSquare;
        const debugTickSquareX =
            typeof debugTickSquare === "string" && debugTickSquare.includes(":")
                ? parseInt(debugTickSquare.split(":")[0] ?? "", 10) | 0
                : -1;
        const debugTickSquareY =
            typeof debugTickSquare === "string" && debugTickSquare.includes(":")
                ? parseInt(debugTickSquare.split(":")[1] ?? "", 10) | 0
                : -1;

        for (let i = 0; i < this.renderer.visibleMapCount; i++) {
            const mapInfo = this.renderer.visibleMaps[i];
            const map = this.renderer.getMap(mapInfo.mapId)!;
            if (!map || !map.canRender(this.renderer.stats.frameCount)) {
                continue;
            }
            const renderable = map instanceof WebGLRenderable ? map : undefined;

            for (let t = 0; t < ticksElapsed; t++) {
                for (const npc of map.npcs) {
                    npc.updateServerMovement(this.pathfinder, map.borderSize, map.collisionMaps);
                }
            }

            let tickedWithWasm = false;
            if (useMapRenderWasm && renderable) {
                const wantDebugTick =
                    debugTickSquareX >= 0 &&
                    debugTickSquareY >= 0 &&
                    mapInfo.mapX === debugTickSquareX &&
                    mapInfo.mapY === debugTickSquareY;
                const preLocFrameIds =
                    wantDebugTick && renderable.locFrameIds instanceof Int32Array
                        ? new Int32Array(renderable.locFrameIds)
                        : undefined;
                const stateWasInitialized = renderable.ensureCppTickStateInitializedFromObjects();
                renderable.syncNpcMovementStateFromObjects();
                renderable.syncNpcPathStateFromObjects();
                if (stateWasInitialized) {
                    const registered = registerDrawRangeTickState(renderable.id, {
                        locFrameIds: renderable.locFrameIds,
                        locCycleStartsFixed: renderable.locCycleStartsFixed,
                        locFrameSteps: renderable.locSeqFrameSteps,
                        locHasAnimMaya: renderable.locSeqHasAnimMaya,
                        locAnimMayaDurations: renderable.locSeqAnimMayaDurations,
                        locFrameLengthOffsets: renderable.locSeqFrameLengthOffsets,
                        locFrameLengthCounts: renderable.locSeqFrameLengthCounts,
                        locFrameLengthsPacked: renderable.locSeqFrameLengthsPacked,
                        locSeqIds: renderable.locSeqIds,
                        locOutActiveFlags: renderable.locSeqActiveFlags,
                        locDrawRangeIndicesBase: renderable.locDrawRangeIndicesBase,
                        locAnimFrameOffsetsBase: renderable.locAnimFrameOffsetsBase,
                        locAnimFrameCountsBase: renderable.locAnimFrameCountsBase,
                        locAnimFramesBasePacked: renderable.locAnimFramesBasePacked,
                        outLocPatchesPacked: renderable.locTickBasePatches,
                        locDrawRangeIndicesAlpha: renderable.locDrawRangeIndicesAlpha,
                        locDrawRangeIndicesLod: renderable.locDrawRangeIndicesLod,
                        locDrawRangeIndicesLodAlpha: renderable.locDrawRangeIndicesLodAlpha,
                        locDrawRangeIndicesInteract: renderable.locDrawRangeIndicesInteract,
                        locDrawRangeIndicesInteractAlpha:
                            renderable.locDrawRangeIndicesInteractAlpha,
                        locDrawRangeIndicesInteractLod: renderable.locDrawRangeIndicesInteractLod,
                        locDrawRangeIndicesInteractLodAlpha:
                            renderable.locDrawRangeIndicesInteractLodAlpha,
                        locAnimFrameOffsetsAlpha: renderable.locAnimFrameOffsetsAlpha,
                        locAnimFrameCountsAlpha: renderable.locAnimFrameCountsAlpha,
                        locAnimFramesAlphaPacked: renderable.locAnimFramesAlphaPacked,
                        outLocAlphaPatchesPacked: renderable.locTickAlphaPatches,
                        outLocLodPatchesPacked: renderable.locTickLodPatches,
                        outLocLodAlphaPatchesPacked: renderable.locTickLodAlphaPatches,
                        outLocInteractPatchesPacked: renderable.locTickInteractPatches,
                        outLocInteractAlphaPatchesPacked: renderable.locTickInteractAlphaPatches,
                        outLocInteractLodPatchesPacked: renderable.locTickInteractLodPatches,
                        outLocInteractLodAlphaPatchesPacked:
                            renderable.locTickInteractLodAlphaPatches,

                        npcX: renderable.npcX,
                        npcY: renderable.npcY,
                        npcOrientation: renderable.npcOrientation,
                        npcRotation: renderable.npcRotation,
                        npcPathLength: renderable.npcPathLength,
                        npcMovementSeqId: renderable.npcMovementSeqId,
                        npcPathXPacked: renderable.npcPathXPacked,
                        npcPathYPacked: renderable.npcPathYPacked,
                        npcPathMovementTypePacked: renderable.npcPathMovementTypePacked,
                        npcSize: renderable.npcSize,
                        npcIsClickable: renderable.npcIsClickable,
                        npcRotationSpeed: renderable.npcRotationSpeed,
                        npcIdleSeqId: renderable.npcIdleSeqId,
                        npcWalkSeqId: renderable.npcWalkSeqId,
                        npcHasWalkAnim: renderable.npcHasWalkAnim,
                        npcFrameIds: renderable.npcFrameIds,
                        npcFrameTicks: renderable.npcFrameTicks,
                        npcMovementLoops: renderable.npcMovementLoops,
                        npcIdleSeqValid: renderable.npcIdleSeqValid,
                        npcIdleSeqHasAnimMaya: renderable.npcIdleSeqHasAnimMaya,
                        npcIdleSeqAnimMayaDurations: renderable.npcIdleSeqAnimMayaDurations,
                        npcIdleSeqFrameSteps: renderable.npcIdleSeqFrameSteps,
                        npcIdleSeqLooping: renderable.npcIdleSeqLooping,
                        npcIdleSeqMaxLoops: renderable.npcIdleSeqMaxLoops,
                        npcIdleSeqFrameIdCounts: renderable.npcIdleSeqFrameIdCounts,
                        npcIdleSeqFrameLengthOffsets: renderable.npcIdleSeqFrameLengthOffsets,
                        npcIdleSeqFrameLengthCounts: renderable.npcIdleSeqFrameLengthCounts,
                        npcWalkSeqValid: renderable.npcWalkSeqValid,
                        npcWalkSeqHasAnimMaya: renderable.npcWalkSeqHasAnimMaya,
                        npcWalkSeqAnimMayaDurations: renderable.npcWalkSeqAnimMayaDurations,
                        npcWalkSeqFrameSteps: renderable.npcWalkSeqFrameSteps,
                        npcWalkSeqLooping: renderable.npcWalkSeqLooping,
                        npcWalkSeqMaxLoops: renderable.npcWalkSeqMaxLoops,
                        npcWalkSeqFrameIdCounts: renderable.npcWalkSeqFrameIdCounts,
                        npcWalkSeqFrameLengthOffsets: renderable.npcWalkSeqFrameLengthOffsets,
                        npcWalkSeqFrameLengthCounts: renderable.npcWalkSeqFrameLengthCounts,
                        npcSeqFrameLengthsPacked: renderable.npcSeqFrameLengthsPacked,
                        npcDrawRangeIndices: renderable.npcDrawRangeIndices,
                        npcIdleAnimFrameOffsetsBase: renderable.npcIdleFrameOffsetsBase,
                        npcIdleAnimFrameCountsBase: renderable.npcIdleFrameCountsBase,
                        npcWalkAnimFrameOffsetsBase: renderable.npcWalkFrameOffsetsBase,
                        npcWalkAnimFrameCountsBase: renderable.npcWalkFrameCountsBase,
                        npcAnimFramesBasePacked: renderable.npcAnimFramesBasePacked,
                        outNpcPatchesPacked: renderable.npcTickBasePatches,
                        npcIdleAnimFrameOffsetsAlpha: renderable.npcIdleFrameOffsetsAlpha,
                        npcIdleAnimFrameCountsAlpha: renderable.npcIdleFrameCountsAlpha,
                        npcWalkAnimFrameOffsetsAlpha: renderable.npcWalkFrameOffsetsAlpha,
                        npcWalkAnimFrameCountsAlpha: renderable.npcWalkFrameCountsAlpha,
                        npcAnimFramesAlphaPacked: renderable.npcAnimFramesAlphaPacked,
                        npcNullAlphaFrameOffset: renderable.npcNullAlphaFrameOffset,
                        outNpcAlphaPatchesPacked: renderable.npcTickAlphaPatches,
                    });
                    if (!registered) {
                        if (strictCppWasm) {
                            this.strictFailure("registerDrawRangeTickStateFailed");
                        }
                        renderable.resetCppTickStateLifecycle();
                    }
                }
                const tickResult = tickAdvanceAndEmitBasePatchesForState(
                    renderable.id,
                    cycleNowFixed,
                    clientTicksElapsed,
                );
                if (tickResult) {
                    renderable.applyLocAnimationStateToObjects();
                    renderable.applyNpcFrameStateToObjects();
                    renderable.locTickBasePatchCount = tickResult.locBasePatchCount | 0;
                    renderable.locTickAlphaPatchCount = tickResult.locAlphaPatchCount | 0;
                    renderable.locTickLodPatchCount = tickResult.locLodPatchCount | 0;
                    renderable.locTickLodAlphaPatchCount = tickResult.locLodAlphaPatchCount | 0;
                    renderable.locTickInteractPatchCount = tickResult.locInteractPatchCount | 0;
                    renderable.locTickInteractAlphaPatchCount =
                        tickResult.locInteractAlphaPatchCount | 0;
                    renderable.locTickInteractLodPatchCount =
                        tickResult.locInteractLodPatchCount | 0;
                    renderable.locTickInteractLodAlphaPatchCount =
                        tickResult.locInteractLodAlphaPatchCount | 0;
                    renderable.npcTickBasePatchCount = tickResult.npcBasePatchCount | 0;
                    renderable.npcTickAlphaPatchCount = tickResult.npcAlphaPatchCount | 0;
                    tickedWithWasm = true;

                    if (wantDebugTick && preLocFrameIds) {
                        // Validate that the wasm-emitted patch stream matches the frame selection
                        // that is now applied to the LocAnimated objects.
                        const patches = renderable.locTickBasePatches;
                        const patchCount = renderable.locTickBasePatchCount | 0;
                        const patchMap = new Map<number, [number, number, number]>();
                        const safePatchCount = Math.min(patchCount, Math.floor(patches.length / 4));
                        for (let p = 0; p < safePatchCount; p++) {
                            const off = p * 4;
                            const drawRangeIndex = patches[off + 0] | 0;
                            patchMap.set(drawRangeIndex, [
                                patches[off + 1] | 0,
                                patches[off + 2] | 0,
                                patches[off + 3] | 0,
                            ]);
                        }
                        const locs = renderable.locsAnimated;
                        for (let li = 0; li < locs.length; li++) {
                            const oldFrame = preLocFrameIds[li] | 0;
                            const newFrame = renderable.locFrameIds[li] | 0;
                            if (oldFrame === newFrame) {
                                continue;
                            }
                            const loc = locs[li];
                            const drawRangeIndex = loc.drawRangeIndex | 0;
                            const expected = loc.anim.frames?.[newFrame];
                            const actual = patchMap.get(drawRangeIndex);
                            if (!expected) {
                                console.warn(
                                    "[map-render-backend][tick-debug] missing expected frame",
                                    {
                                        square: `${(mapInfo as any).mapX}:${(mapInfo as any).mapY}`,
                                        locIndex: li,
                                        drawRangeIndex,
                                        oldFrame,
                                        newFrame,
                                        seqId: renderable.locSeqIds?.[li] ?? -1,
                                    },
                                );
                                continue;
                            }
                            const expOff = expected[0] | 0;
                            const expEl = expected[1] | 0;
                            const expInst = expected[2] | 0;
                            if (!actual) {
                                console.warn(
                                    "[map-render-backend][tick-debug] frame changed but no patch emitted",
                                    {
                                        square: `${(mapInfo as any).mapX}:${(mapInfo as any).mapY}`,
                                        locIndex: li,
                                        drawRangeIndex,
                                        oldFrame,
                                        newFrame,
                                        expected: [expOff, expEl, expInst],
                                        patchCount,
                                        seqId: renderable.locSeqIds?.[li] ?? -1,
                                        hasAnimMaya: renderable.locSeqHasAnimMaya?.[li] ?? -1,
                                    },
                                );
                                break;
                            }
                            if (
                                actual[0] !== expOff ||
                                actual[1] !== expEl ||
                                actual[2] !== expInst
                            ) {
                                console.warn(
                                    "[map-render-backend][tick-debug] patch mismatch for changed frame",
                                    {
                                        square: `${(mapInfo as any).mapX}:${(mapInfo as any).mapY}`,
                                        locIndex: li,
                                        drawRangeIndex,
                                        oldFrame,
                                        newFrame,
                                        expected: [expOff, expEl, expInst],
                                        actual,
                                        patchCount,
                                        seqId: renderable.locSeqIds?.[li] ?? -1,
                                        frameStep: renderable.locSeqFrameSteps?.[li] ?? -1,
                                        hasAnimMaya: renderable.locSeqHasAnimMaya?.[li] ?? -1,
                                        animMayaDur: renderable.locSeqAnimMayaDurations?.[li] ?? -1,
                                    },
                                );
                                break;
                            }
                        }
                    }
                } else if (strictCppWasm) {
                    this.strictFailure("tickAdvanceAndEmitBasePatchesFailed");
                }
            }

            if (tickedWithWasm) {
                continue;
            }

            if (renderable) {
                unregisterDrawRangeTickState(renderable.id);
                renderable.resetCppTickStateLifecycle();
                renderable.clearTickPatchStreams();
            }

            for (const loc of map.locsAnimated) {
                loc.update(seqFrameLoader, cycle);
            }
            for (let t = 0; t < clientTicksElapsed; t++) {
                for (const npc of map.npcs) {
                    npc.updateMovement(seqTypeLoader, seqFrameLoader);
                }
            }
        }
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
