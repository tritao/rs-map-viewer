import { clamp } from "../util/MathUtil";
import { WebGLModelRenderer } from "../renderer/webgl/WebGLModelRenderer";
import { CacheViewer } from "./CacheViewer";

export class CacheViewerRenderer extends WebGLModelRenderer {

    constructor(public cacheViewer: CacheViewer) {
        super(cacheViewer.cacheLoaders, cacheViewer.inputManager,
            cacheViewer.workerPool, cacheViewer.camera);
    }

    override async init() {
        this.inputManager.init(this.canvas);
        super.init();
    }

    override async cleanUp(): Promise<void> {
        this.inputManager.cleanUp();
        super.cleanUp();
    }

    override update(time: number, deltaTime: number) {
        this.handleInput(deltaTime);
        super.update(time, deltaTime);
    }

    handleInput(deltaTime: number) {
        this.handleKeyInput(deltaTime);
        this.handleMouseInput();
        this.handleJoystickInput(deltaTime);
    }

    handleKeyInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.inputManager;
        const camera = this.cacheViewer.camera;

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

        const deltaPos = 16 * (this.cacheViewer.cameraSpeed * cameraSpeedMult) * deltaTimeSec;
        const deltaHeight = 8 * (this.cacheViewer.cameraSpeed * cameraSpeedMult) * deltaTimeSec;

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
        const camera = this.cacheViewer.camera;

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

        const camera = this.cacheViewer.camera;

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

        const frameTime = performance.now() - this.rendererStats.frameStart;

        if (this.inputManager.isKeyDown("KeyH")) {
            this.cacheViewer.debugText = `MapManager: ${this.rendererStats.mapManagerTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyJ")) {
            this.cacheViewer.debugText = `Interactions: ${this.rendererStats.interactionsTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyK")) {
            this.cacheViewer.debugText = `Tick: ${this.rendererStats.tickTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyL")) {
            this.cacheViewer.debugText = `Opaque Pass: ${this.rendererStats.opaquePassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyB")) {
            this.cacheViewer.debugText = `Opaque Npc Pass: ${this.rendererStats.opaqueNpcPassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyN")) {
            this.cacheViewer.debugText = `Transparent Pass: ${this.rendererStats.transparentPassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyM")) {
            this.cacheViewer.debugText = `Transparent Npc Pass: ${this.rendererStats.transparentNpcPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyV")) {
            this.cacheViewer.debugText = `Frame Time: ${frameTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyU")) {
            this.cacheViewer.debugText = `Frame Time Js: ${this.stats.frameTimeJs.toFixed(2)}ms`;
        }

        if (window.wallpaperFpsLimit !== undefined) {
            this.fpsLimit = window.wallpaperFpsLimit;
        }

        if (this.cacheViewer.camera.updated) {
            this.cacheViewer.updateSearchParams();
        }

        this.inputManager.onFrameEnd();
        this.cacheViewer.camera.onFrameEnd();

        // this.mapViewer.debugText = `Frame Time Js: ${this.stats.frameTimeJs.toFixed(3)}`;
    }
}
