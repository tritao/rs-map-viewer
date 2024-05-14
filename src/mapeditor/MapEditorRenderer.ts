import { Schema } from "leva/dist/declarations/src/types";
import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { Camera } from "../renderer/Camera";
import { MapManager, MapSquareInfo } from "../renderer/MapManager";
import { CacheLoaders } from "../rs/cache/CacheLoaders";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { InputManager } from "../util/InputManager";
import { clamp } from "../util/MathUtil";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { MapEditor } from "./MapEditor";
import { EditorMapData } from "./webgl/loader/EditorMapData";
import { WebGLMapEditorRenderer } from "./webgl/WebGLMapEditorRenderer";

export class MapEditorRenderer extends RendererMainLoop {
    inputManager: InputManager;
    cacheLoaders: CacheLoaders;
    workerPool: RenderDataWorkerPool;

    camera: Camera;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    renderer: WebGLMapEditorRenderer;

    constructor(public mapEditor: MapEditor) {
        super();
        this.inputManager = mapEditor.inputManager;
        this.cacheLoaders = mapEditor.cacheLoaders;
        this.workerPool = mapEditor.workerPool;
        this.camera = mapEditor.camera;
        this.renderer = new WebGLMapEditorRenderer(
            this.cacheLoaders, this.workerPool, this.inputManager, mapEditor.renderDistance,
            mapEditor.unloadDistance, mapEditor.lodDistance, this.camera,
            () => { return this.mapEditor.selectedUnderlayId  })
        this.mapManager = new MapManager(
            this.workerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
    }

    override async init() {
        super.init();
        this.inputManager.init(this.canvas);
    }

    override render(time: number, deltaTime: number, resized: boolean): void {
        super.render(time, deltaTime, resized);
        this.mapEditor.debugText = this.renderer.debugText;
    }

    override cleanUp(): void {
        this.mapEditor.inputManager.cleanUp();
    }

    override update(time: number, deltaTime: number) {
        this.handleInput(deltaTime);

        const { width, height } = this.renderer.getViewportDimensions();
        this.camera.update(width, height);

        const renderDistance = this.renderer.renderDistance;
        const frameCount = this.renderer.stats.frameCount;

        const mapManagerStart = performance.now();
        this.mapManager.update(this.camera, frameCount, renderDistance,
            this.renderer.unloadDistance);
        this.mapManagerTime = performance.now() - mapManagerStart;

        this.renderer.visibleMapCount = this.mapManager.visibleMapCount;
        this.renderer.visibleMaps = this.mapManager.visibleMaps;

        const tickStart = performance.now();
        this.renderer.rendererStats.tickTime = performance.now() - tickStart;
    }

    initCache(): void {
        this.renderer.initCache();
        this.mapManager.init(
            this.cacheLoaders.mapFileIndex,
            SceneBuilder.fillEmptyTerrain(this.cacheLoaders.cache.info),
        );
        this.mapManager.update(
            this.mapEditor.camera,
            this.renderer.stats.frameCount,
            this.mapEditor.renderDistance,
            this.mapEditor.unloadDistance,
        );
    }

    getControls(): Schema {
        return {};
    }

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const mapData = await this.renderer.loadMapData(mapX, mapY);
        if (mapData) {
            if (this.renderer.isValidMapData(mapData)) {
                this.mapManager.addMap(mapX, mapY);
                this.renderer.addMap(mapData);
            }
        } else {
            this.mapManager.addInvalidMap(mapX, mapY);
        }
    }

    async removeLoadedMap(mapInfo: MapSquareInfo): Promise<void> {
        this.renderer.removeMap(mapInfo);
    }

    handleInput(deltaTime: number) {
        if (this.inputManager.scrollY !== 0) {
            const newBrushSize = this.renderer.brushSize - Math.sign(this.inputManager.scrollY);
            this.renderer.brushSize = clamp(newBrushSize, 0, 16);
        }

        this.handleKeyInput(deltaTime);
        this.handleMouseInput();
        this.handleJoystickInput(deltaTime);
    }

    handleKeyInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.mapEditor.inputManager;
        const camera = this.mapEditor.camera;

        let cameraSpeedMult = 1.0;
        if (inputManager.isShiftDown()) {
            cameraSpeedMult = 10.0;
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

        const deltaPos = 16 * cameraSpeedMult * deltaTimeSec;
        const deltaHeight = 8 * cameraSpeedMult * deltaTimeSec;

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
    }

    handleMouseInput() {
        const inputManager = this.mapEditor.inputManager;
        const camera = this.mapEditor.camera;

        // mouse/touch controls
        const deltaMouseX = inputManager.getDeltaMouseX();
        const deltaMouseY = inputManager.getDeltaMouseY();

        if (deltaMouseX !== 0 || deltaMouseY !== 0) {
            if (inputManager.isTouch) {
                camera.move(0, clamp(-deltaMouseY, -100, 100) * 0.004, 0);
            } else {
                camera.updatePitch(camera.pitch, deltaMouseY * 0.9);
                camera.updateYaw(camera.yaw, deltaMouseX * -0.9);
            }
        }
    }

    handleJoystickInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.mapEditor.inputManager;
        const camera = this.mapEditor.camera;

        const deltaPitch = 64 * 5 * deltaTimeSec;
        const deltaYaw = 64 * 5 * deltaTimeSec;

        // joystick controls
        const positionJoystickEvent = inputManager.positionJoystickEvent;
        const cameraJoystickEvent = inputManager.cameraJoystickEvent;

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

        if (window.wallpaperFpsLimit !== undefined) {
            this.fpsLimit = window.wallpaperFpsLimit;
        }

        if (this.mapEditor.camera.updated) {
            this.mapEditor.updateSearchParams();
        }

        this.mapEditor.inputManager.onFrameEnd();
        this.mapEditor.camera.onFrameEnd();
    }
}
