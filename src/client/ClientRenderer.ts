import { clamp } from "../util/MathUtil";
import { Client } from "./Client";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import { InteractType } from "../renderer/InteractType";
import { INTERACTION_RADIUS } from "../renderer/Interactions";
import { MenuTargetType } from "../rs/MenuEntry";
import { isTouchDevice } from "../util/DeviceUtil";
import { WebGLMapRenderer } from "../renderer/webgl/WebGLMapRenderer";
import { MapManager, MapManagerUpdateMode, MapSquareInfo } from "../renderer/MapManager";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { InputManager } from "../util/InputManager";
import { CacheLoaders } from "../rs/cache/CacheLoaders";
import { Camera, Ray } from "../renderer/Camera";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { MapRenderer, MapSquareRenderable } from "../renderer/MapRenderer";
import { MapData } from "../renderer/loader/MapData";
import { Game, GameEvents } from "./game/Game";
import { renderGameView } from "./game/GameRenderer";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { WebGLMapSquare } from "../renderer/webgl/WebGLMapSquare";
import { SceneBuffer } from "../renderer/buffer/SceneBuffer";
import { InteractiveObject } from "./game/InteractiveObject";
import { addAnimatedModelAnimationFrames } from "../renderer/loader/SdRenderableDataLoader";
import { Actor } from "./game/renderable/actor/Actor";
import { DynamicNpcData } from "../renderer/npc/NpcData";
import { Scene } from "../rs/scene/Scene";
import { vec3 } from "gl-matrix";

export class ClientRenderer extends RendererMainLoop implements GameEvents {
    inputManager: InputManager;
    cacheLoaders: CacheLoaders;
    workerPool: RenderDataWorkerPool;

    game: Game;

    ray: Ray;
    camera: Camera;
    pathfinder: Pathfinder;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    lastKnownMapX: number = -1;
    lastKnownMapY: number = -1;

    renderer: MapRenderer<MapSquareRenderable, MapData>;

    // State
    lastClientTick: number = 0;
    lastTick: number = 0;

    constructor(public client: Client) {
        super();
        this.inputManager = client.inputManager;
        this.cacheLoaders = client.cacheLoaders;
        this.workerPool = client.workerPool;
        this.camera = client.camera;
        this.ray = new Ray();
        this.pathfinder = client.pathfinder;
        this.renderer = new WebGLMapRenderer(
            this.cacheLoaders, this.workerPool, this.inputManager, client.renderDistance,
            client.unloadDistance, client.lodDistance, this.camera)
        this.mapManager = new MapManager(
            this.workerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
        this.mapManager.mode = MapManagerUpdateMode.Loaded;

        this.game = client.game;
        this.game.events = this;
        this.game.cacheLoaders = this.cacheLoaders;
    }

    onChatboxMessage(message: string): void {
        console.log(message);
    }

    onMapRegionLoad(chunkX: number, chunkY: number): void {
        let mapX = Math.floor(chunkX / 8);
        let mapY = Math.floor(chunkY / 8);

        this.lastKnownMapX = mapX;
        this.lastKnownMapY = mapY;

        this.mapManager.loadMap(mapX, mapY);
    }

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const mapData = await this.renderer.loadMapData(mapX, mapY);
        if (mapData) {
            if (this.renderer.isValidMapData(mapData)) {
                this.mapManager.addMap(mapX, mapY);
                this.renderer.addMap(mapData);

                this.client.setMapImageUrl(
                    mapData.mapX,
                    mapData.mapY,
                    URL.createObjectURL(mapData.minimapBlob),
                    true,
                    false,
                );
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

        this.game.init();

        try {
            const username = "Wildy" + Math.floor(Math.random() * 1000);
            await this.game.login(username, "test123");
        } catch (ex: any) {
            console.error(ex);
        }

    }

    initCache(): void {
        this.renderer.initCache();
        this.mapManager.init(
            this.cacheLoaders.mapFileIndex,
            SceneBuilder.fillEmptyTerrain(this.cacheLoaders.cache.info),
        );
        this.mapManager.update(
            this.camera,
            this.renderer.stats.frameCount,
            this.renderer.renderDistance,
            this.renderer.unloadDistance,
        );
    }

    override async cleanUp(): Promise<void> {
        super.cleanUp();
        this.inputManager.cleanUp();
        this.mapManager.cleanUp();
    }

    override update(time: number, deltaTime: number) {
        this.game.processGameLoop();

        this.handleInput(deltaTime);

        const hasMovementKey =
            this.inputManager.isKeyDown('ArrowLeft') ||
            this.inputManager.isKeyDown('ArrowRight') ||
            this.inputManager.isKeyDown('ArrowUp') ||
            this.inputManager.isKeyDown('ArrowDown');

        if (hasMovementKey && this.game.localPlayer) {
            const localX = this.game.localPlayer.worldX >> 7;
            const localY = this.game.localPlayer.worldY >> 7;

            let deltaX = 0;
            let deltaY = 0;

            if (this.inputManager.isKeyDown('ArrowLeft'))
                deltaX -= 1;
            else if (this.inputManager.isKeyDown('ArrowRight'))
                deltaX += 1;
            else if (this.inputManager.isKeyDown('ArrowUp'))
                deltaY += 1;
            else if (this.inputManager.isKeyDown('ArrowDown'))
                deltaY -= 1;

            console.log('hasMovementKey delta x,y', deltaX, deltaY);

            this.game.simulateWalk(this.game.localPlayer, localX, localY,
                localX + deltaX, localY + deltaY);
        }

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

    processClick(x: number, y: number) {
        const viewportSize = this.renderer.getViewportDimensions();

        this.ray.fromMouseAndProjection(
            x,
            y,
            viewportSize.width,
            viewportSize.height,
            this.camera.invViewProjMatrix,
        );

        const maxMapY = (Scene.UNITS_LEVEL_HEIGHT * 3) / 128;

        const pos = vec3.copy(vec3.create(), this.ray.origin);
        const distance = vec3.distance(pos, this.ray.destination);
        let stepCount = 0;
        let map: MapSquareInfo | undefined;
        let foundTile = false;

        let tileX = -1;
        let tileZ = -1;

        for (let i = 0; i < distance && pos[1] < maxMapY; i++) {
            const mapX = (pos[0] / Scene.MAP_SQUARE_SIZE) | 0;
            const mapZ = (pos[2] / Scene.MAP_SQUARE_SIZE) | 0;

            if (!map || map.mapX !== mapX || map.mapY !== mapZ) {
                map = this.mapManager.getMap(mapX, mapZ);
                if (!map) {
                    break;
                }
            }

            tileX = pos[0] - mapX * Scene.MAP_SQUARE_SIZE;
            tileZ = pos[2] - mapZ * Scene.MAP_SQUARE_SIZE;

            const mapRenderable = this.renderer.getMap(map.mapId) as WebGLMapSquare;
            if (!mapRenderable) {
                continue;
            }

            const height = mapRenderable.getHeight(0, tileX, tileZ);
            if (pos[1] > height) {
                // tile selected
                foundTile = true;
                break;
            }

            vec3.add(pos, pos, this.ray.direction);
            stepCount++;
        }

        if (foundTile) {
            // convert to scene local tile
            const sceneX = pos[0] - this.game.viewportOriginTileX;
            const sceneZ = pos[2] - this.game.viewportOriginTileY;
            console.log('found tile', sceneX, sceneZ);

            this.game.processWalk(this.game.localPlayer, sceneX | 0, sceneZ | 0);
        }
    }

    tickPass(time: number, ticksElapsed: number, clientTicksElapsed: number): void {
        const cycle = time / 0.02;

        const seqFrameLoader = this.cacheLoaders.seqFrameLoader;
        const seqTypeLoader = this.cacheLoaders.seqTypeLoader;

        for (let i = 0; i < this.renderer.visibleMapCount; i++) {
            const mapInfo = this.renderer.visibleMaps[i];
            const map = this.renderer.getMap(mapInfo.mapId)!;
            if (!map || !map.canRender(this.renderer.stats.frameCount)) {
                continue;
            }

            for (const loc of map.locsAnimated) {
                loc.update(seqFrameLoader, cycle);
            }

            for (let t = 0; t < ticksElapsed; t++) {
                for (const npc of map.npcs) {
                    npc.updateServerMovement(this.pathfinder, map.borderSize, map.collisionMaps);
                }
            }

            for (let t = 0; t < clientTicksElapsed; t++) {
                for (const npc of map.npcs) {
                    npc.updateMovement(seqTypeLoader, seqFrameLoader);
                }
            }
        }
    }

    override render(time: number, deltaTime: number, resized: boolean) {
        renderGameView(this.game);

        this.rebuildActors();

        super.render(time, deltaTime, resized);
    }

    rebuildActors() {
        for (const _map of this.renderer.loadedMaps.values()) {
            const map = _map as WebGLMapSquare;
            map.clearDynamicNpcs();
        }

        const textureLoader = this.cacheLoaders.textureLoader;
        const textureIdIndexMap = new Map<number, number>();
        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);

        const scene = this.game.currentScene;
        for (let i = 0; i < scene.sceneSpawnRequestsCacheCurrentPos; i++) {
            const interactiveObject: InteractiveObject = scene.sceneSpawnRequests[i]!;
            this.renderActor(interactiveObject, sceneBuf);
        }

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);
        const renderer = this.renderer as WebGLMapRenderer;
        renderer.dynamicNpcBuffers.createDynamicBuffers(renderer.app, vertices, indices);

        for (const _map of this.renderer.loadedMaps.values()) {
            const map = _map as WebGLMapSquare;
            map.createDynamicNpcs(renderer.dynamicNpcBuffers);
        }

        scene.clearInteractiveObjectCache();
    }

    private renderActor(interactiveObject: InteractiveObject, sceneBuf: SceneBuffer) {
        const localX = interactiveObject.worldX >> 7;
        const localY = interactiveObject.worldY >> 7;

        const model = interactiveObject.renderable!.getRotatedModel(this.cacheLoaders);

        const actor = interactiveObject.renderable! as Actor;
        const seqId = actor.primaryAnimSeq!;

        let animFrames = addAnimatedModelAnimationFrames(sceneBuf, model!, seqId);

        const npcWorldTileX = (this.game.viewportOriginTileX + localX);
        const npcWorldTileY = (this.game.viewportOriginTileY + localY);

        const mapX = Math.floor(npcWorldTileX / 64);
        const mapY = Math.floor(npcWorldTileY / 64);

        const tileX = npcWorldTileX % 64;
        const tileY = npcWorldTileY % 64;

        const diffTileX = localX - tileX;
        const diffTileY = localY - tileY;

        const worldX = actor.worldX - diffTileX * 128;
        const worldY = actor.worldY - diffTileY * 128;

        const data: DynamicNpcData = {
            id: -1,
            x: worldX,
            y: worldY,
            spawnX: tileX,
            spawnY: tileY,
            rotation: actor.currentRotation,
            level: interactiveObject.z,
            idleAnim: animFrames,
            walkAnim: animFrames,
            idleAnimSeqId: actor.idleAnimation,
            walkAnimSeqId: actor.walkAnimationId,
        };

        const mapId = getMapSquareId(mapX, mapY);
        const map = this.renderer.loadedMaps.get(mapId) as WebGLMapSquare;
        if (map) {
            map.addDynamicNpc(data);
        }
    }

    handleInput(deltaTime: number) {
        this.handleKeyInput(deltaTime);
        this.handleMouseInput();
        this.handleJoystickInput(deltaTime);
    }

    handleKeyInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.inputManager;
        const camera = this.client.camera;

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

        const deltaPos = 16 * (this.client.cameraSpeed * cameraSpeedMult) * deltaTimeSec;
        const deltaHeight = 8 * (this.client.cameraSpeed * cameraSpeedMult) * deltaTimeSec;

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
        const camera = this.client.camera;

        if (this.inputManager.isPointerLock()) {
            this.client.closeMenu();
        }

        // mouse/touch controls
        const deltaMouseX = this.inputManager.getDeltaMouseX();
        const deltaMouseY = this.inputManager.getDeltaMouseY();

        if (this.inputManager.isClick) {
            const mouseX = this.inputManager.mouseX;
            const mouseY = this.inputManager.mouseY;
            this.processClick(mouseX, mouseY);
        }

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

        const camera = this.client.camera;

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
            this.client.debugText = `MapManager: ${this.mapManagerTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyJ")) {
            this.client.debugText = `Interactions: ${rendererStats.interactionsTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyK")) {
            this.client.debugText = `Tick: ${rendererStats.tickTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyL")) {
            this.client.debugText = `Opaque Pass: ${rendererStats.opaquePassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyB")) {
            this.client.debugText = `Opaque Npc Pass: ${rendererStats.opaqueNpcPassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyN")) {
            this.client.debugText = `Transparent Pass: ${rendererStats.transparentPassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyM")) {
            this.client.debugText = `Transparent Npc Pass: ${rendererStats.transparentNpcPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyV")) {
            this.client.debugText = `Frame Time: ${frameTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyU")) {
            this.client.debugText = `Frame Time Js: ${frameStats.frameTimeJs.toFixed(2)}ms`;
        }

        if (this.client.camera.updated) {
            this.client.updateSearchParams();
        }

        this.inputManager.onFrameEnd();
        this.client.camera.onFrameEnd();

        // this.Client.debugText = `Frame Time Js: ${this.stats.frameTimeJs.toFixed(3)}`;
    }

    checkInteractions(interactReady: boolean, interactBuffer: Float32Array,
        closestInteractIndices: Map<number, number[]>): void {
        const frameCount = this.renderer.stats.frameCount;

        const isMouseDown = this.inputManager.dragX !== -1 || this.inputManager.dragY !== -1;
        const picked = this.inputManager.pickX !== -1 && this.inputManager.pickY !== -1;

        if (!interactReady && !picked)
            return;

        const menuCooldown = isTouchDevice ? 50 : 10;

        if (
            this.inputManager.mouseX === -1 ||
            this.inputManager.mouseY === -1 ||
            frameCount - this.client.menuOpenedFrame < menuCooldown
        ) {
            return;
        }

        // Don't auto close menu on touch devices
        if (this.client.menuOpen && !picked && !isMouseDown && isTouchDevice) {
            return;
        }

        if (!picked && !this.client.tooltips) {
            this.client.closeMenu();
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
                    const locType = this.client.cacheLoaders.locTypeLoader.load(interactId);
                    if (locType.name === "null" && !this.client.debugId) {
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
                            onClick: this.client.closeMenu,
                        });
                    }

                    examineEntries.push({
                        option: "Examine",
                        targetId: locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: locType.name,
                        targetLevel: -1,
                        onClick: this.client.onExamine,
                    });
                } else if (interactType === InteractType.OBJ) {
                    const objType = this.client.cacheLoaders.objTypeLoader.load(interactId);
                    if (objType.name === "null" && !this.client.debugId) {
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
                            onClick: this.client.closeMenu,
                        });
                    }

                    examineEntries.push({
                        option: "Examine",
                        targetId: objType.id,
                        targetType: MenuTargetType.OBJ,
                        targetName: objType.name,
                        targetLevel: -1,
                        onClick: this.client.onExamine,
                    });
                } else if (interactType === InteractType.NPC) {
                    let npcType = this.client.cacheLoaders.npcTypeLoader.load(interactId);
                    if (npcType.transforms) {
                        const transformed = npcType.transform(
                            this.client.cacheLoaders.varManager,
                            this.client.cacheLoaders.npcTypeLoader,
                        );
                        if (!transformed) {
                            continue;
                        }
                        npcType = transformed;
                    }
                    if (npcType.name === "null" && !this.client.debugId) {
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
                            onClick: this.client.closeMenu,
                        });
                    }

                    examineEntries.push({
                        option: "Examine",
                        targetId: npcType.id,
                        targetType: MenuTargetType.NPC,
                        targetName: npcType.name,
                        targetLevel: npcType.combatLevel,
                        onClick: this.client.onExamine,
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
            onClick: this.client.closeMenu,
        });
        menuEntries.push(...examineEntries);
        menuEntries.push({
            option: "Cancel",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: this.client.closeMenu,
        });

        this.client.menuOpen = picked;
        if (picked) {
            this.client.menuOpenedFrame = frameCount;
        }
        this.client.menuX = this.inputManager.mouseX;
        this.client.menuY = this.inputManager.mouseY;
        this.client.menuEntries = menuEntries;
    }
}
