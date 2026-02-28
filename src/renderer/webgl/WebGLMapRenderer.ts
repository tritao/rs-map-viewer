import { vec2 } from "gl-matrix";
import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { GameType } from "../../rs/cache/CacheInfo";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { CacheSession } from "../../rs/loaders/CacheSession";
import { isWebGL2Supported } from "../../util/DeviceUtil";
import { Camera } from "../Camera";
import { DrawRange } from "../DrawRange";
import { MapSquareInfo } from "../MapManager";
import { MapRenderer, TextureFilterMode } from "../MapRenderer";
import { FrameStats, RendererStats } from "../Renderer";
import { SdMapData } from "../loader/SdMapData";
import { PostProcessPass } from "./core/PostProcessPass";
import { RenderTargets } from "./core/RenderTargets";
import { WebGLGeometrySystem } from "./systems/WebGLGeometrySystem";
import { WebGLInteractionSystem, type InteractionsCallback } from "./systems/WebGLInteractionSystem";
import { WebGLTextureSystem } from "./systems/WebGLTextureSystem";
import { createWebGLDevice } from "./core/WebGLDevice";
import { WebGLPrograms } from "./core/WebGLPrograms";
import { WebGLMapSquare } from "./renderables/WebGLMapSquare";
import { DrawCallKey, WebGLRenderable } from "./renderables/WebGLRenderable";
import {
    MapRenderWorkBuilder,
    type MapRenderWorkInput,
} from "../MapRenderWorkBuilder";
import type { InteractionControllerRenderer, InteractionInput } from "../interaction/InteractionState";
import type { TickControllerRenderer } from "../patch/TickCapability";
import { NpcDataTextureRing } from "./texture/NpcDataTextureRing";
import type { NpcGpuDataConsumer, NpcGpuFrameData } from "../npc/NpcGpuData";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../npc/NpcGpuData";

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

export class WebGLMapRenderer
    extends MapRenderer<WebGLMapSquare, SdMapData>
    implements NpcGpuDataConsumer
{
    protected readonly textures: WebGLTextureSystem;
    private readonly interactions: WebGLInteractionSystem;
    protected readonly geometry = new WebGLGeometrySystem();
    private readonly scheduler = new MapRenderWorkBuilder();
    protected readonly programs = new WebGLPrograms();
    private readonly renderTargets = new RenderTargets();
    private readonly postProcessPass = new PostProcessPass();
    private readonly npcDataTextureRing = new NpcDataTextureRing(NPC_DATA_TEXTURE_RING_SIZE);
    private npcGpuFrameData: NpcGpuFrameData | undefined;

    app!: PicoApp;
    gl!: WebGL2RenderingContext;

    quadPositions?: VertexBuffer;
    quadArray?: VertexArray;

    // Uniforms
    sceneUniformBuffer?: UniformBuffer;

    cameraPosUni: vec2 = vec2.fromValues(0, 0);
    resolutionUni: vec2 = vec2.fromValues(0, 0);

    isNewTextureAnim: boolean = false;

    debugTextureMode: number = 0;

    logTextureDebugStats(): void {
        const cacheInfo = this.session.cache.info;
        const textureLoader = this.session.getTextureLoader() as unknown as {
            constructor?: { name?: string };
        };
        console.log(
            `texture debug: cache=${cacheInfo.name} game=${cacheInfo.game} rev=${
                cacheInfo.revision
            } loader=${textureLoader?.constructor?.name ?? "unknown"}`,
        );
        this.textures.logDebugStats();
    }

    constructor(
        readonly session: CacheSession,
        renderDistance: number,
        unloadDistance: number,
        lodDistance: number,
        readonly camera: Camera,
        onInteractions?: InteractionsCallback,
    ) {
        super(session.cache, renderDistance, unloadDistance, lodDistance);
        this.stats = new FrameStats();
        this.rendererStats = new RendererStats();
        this.textures = new WebGLTextureSystem(this.loadedTextureIds);
        this.interactions = new WebGLInteractionSystem(onInteractions);
    }

    static isSupported(): boolean {
        return isWebGL2Supported;
    }

    override getTickControllerRenderer(): TickControllerRenderer | undefined {
        return this;
    }

    override getInteractionControllerRenderer(): InteractionControllerRenderer | undefined {
        return this;
    }

    override getNpcGpuDataConsumerRenderer(): NpcGpuDataConsumer | undefined {
        return this;
    }

    setInteractionInput(input: InteractionInput): void {
        this.interactions.setInput(input);
    }

    getViewportDimensions(): { width: number; height: number } {
        return { width: this.app.width, height: this.app.height };
    }

    async init(canvas: HTMLCanvasElement): Promise<void> {
        const device = createWebGLDevice(canvas);
        this.app = device.app;
        this.gl = device.gl;
        this.hasMultiDraw = device.hasMultiDraw;

        this.quadPositions = this.app.createVertexBuffer(
            PicoGL.FLOAT,
            2,
            new Float32Array([-1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1]),
        );
        this.quadArray = this.app.createVertexArray().vertexAttributeBuffer(0, this.quadPositions);
        await this.programs.init(this.app, this.quadArray, this.hasMultiDraw);

        this.sceneUniformBuffer = this.app.createUniformBuffer([
            PicoGL.FLOAT_MAT4, // mat4 u_viewProjMatrix;
            PicoGL.FLOAT_MAT4, // mat4 u_viewMatrix;
            PicoGL.FLOAT_MAT4, // mat4 u_projectionMatrix;
            PicoGL.FLOAT_VEC4, // vec4 u_skyColor;
            PicoGL.FLOAT_VEC2, // vec2 u_cameraPos;
            PicoGL.FLOAT, // float u_renderDistance;
            PicoGL.FLOAT, // float u_fogDepth;
            PicoGL.FLOAT, // float u_currentTime;
            PicoGL.FLOAT, // float u_brightness;
            PicoGL.FLOAT, // float u_colorBanding;
            PicoGL.FLOAT, // float u_isNewTextureAnim;
            PicoGL.FLOAT, // float u_debugTextureMode;
        ]);

        this.renderTargets.init(this.app, this.gl, this.msaaEnabled);
        this.needsFramebufferUpdate = false;

        this.initTextures();
        this.geometry.ensureTickBackendInit();

        console.log("Renderer init");
    }

    initCache(): void {
        const cache = this.session.cache;
        this.isNewTextureAnim =
            cache.info.game === GameType.Runescape && cache.info.revision >= 681;

        if (this.app) {
            this.initTextures();
        }
        console.log(
            "Renderer initCache",
            this.app ? { width: this.app.width, height: this.app.height } : { app: null },
        );
    }

    initTextures(): void {
        this.textures.init(
            this.app,
            this.gl,
            this.session.getTextureLoader(),
            this.session.cache.info,
            this.textureFilterMode,
            this.stats.frameCount,
        );
        console.log("init textures", this.textures.getTextureIds().length);
    }

    updateTextureFiltering(): void {
        this.textures.updateFiltering(this.textureFilterMode);
    }

    loadMap(mapData: SdMapData, time: number): void {
        const { mapX, mapY } = mapData;
        const textureArray = this.textures.getTextureArray();
        const textureSlotLut = this.textures.getTextureSlotLut();
        const textureMaterials = this.textures.getMaterialsTexture();
        if (!textureArray || !textureSlotLut || !textureMaterials || !this.sceneUniformBuffer) {
            return;
        }

        this.loadedMaps.set(
            getMapSquareId(mapX, mapY),
            this.geometry.loadMapSquare(
                this.session,
                this.app,
                this.programs,
                textureArray,
                textureMaterials,
                textureSlotLut,
                this.sceneUniformBuffer,
                mapData,
                time,
                this.stats.frameCount,
            ),
        );

        this.textures.onLoadedTextures(mapData.loadedTextures, this.stats.frameCount);
    }

    onResize(width: number, height: number): void {
        this.app.resize(width, height);
    }

    update(time: number, deltaTime: number) {}

    render(time: number, deltaTime: number, resized: boolean): void {
        this.rendererStats.frameStart = performance.now();
        const timeSec = time / 1000;

        if (this.needsFramebufferUpdate) {
            this.renderTargets.initMain(this.app, this.gl, this.msaaEnabled);
            this.needsFramebufferUpdate = false;
        }

        if (
            !this.programs.mainProgram ||
            !this.programs.mainAlphaProgram ||
            !this.programs.npcProgram ||
            !this.sceneUniformBuffer ||
            !this.renderTargets.framebuffer ||
            !this.renderTargets.textureFramebuffer ||
            !this.programs.frameDrawCall ||
            !this.renderTargets.interactFramebuffer ||
            !this.textures.getTextureArray() ||
            !this.textures.getTextureSlotLut() ||
            !this.textures.getMaterialsTexture()
        ) {
            return;
        }

        if (resized) {
            this.resizeFramebuffers();
        }

        this.updateSceneUniforms(timeSec);
        const currInteractions = this.interactions.prepare(
            this.gl,
            this.stats.frameCount,
            this.rendererStats,
        );
        const scheduleInput: MapRenderWorkInput<WebGLMapSquare> = {
            camera: this.camera,
            visibleMapCount: this.visibleMapCount,
            visibleMaps: this.visibleMaps,
            loadedMaps: this.loadedMaps,
            frameCount: this.stats.frameCount,
            lodDistance: this.lodDistance,
            loadNpcs: this.loadNpcs,
            hoveredMapIds: this.interactions.getHoveredMapIds(),
        };
        const gatheredMaps = this.scheduler.gatherRenderableMaps(scheduleInput);
        this.textures.updateVisibleResidency(
            this.collectVisibleUsedTextureIds(),
            this.stats.frameCount,
            this.debugTextureMode !== 0,
        );

        this.renderSceneToFramebuffer();
        const packedNpcData = this.npcGpuFrameData ?? {
            width: 16,
            height: 1,
            data: new Uint16Array(16 * 4),
        };
        const { npcDataTextureIndex, npcDataTexture } = this.npcDataTextureRing.flush(
            this.app,
            this.stats.frameCount,
            packedNpcData,
        );
        this.renderPasses(scheduleInput, gatheredMaps, npcDataTextureIndex, npcDataTexture);
        this.postProcessPass.blitSceneToTexture(this.app, this.gl, this.renderTargets);
        this.interactions.readAtMouse(
            this.gl,
            this.app,
            this.msaaEnabled,
            this.renderTargets.interactFramebuffer!,
            currInteractions,
        );
        this.postProcessPass.present(
            this.app,
            this.renderTargets,
            this.resolutionUni as unknown as Float32Array,
            this.programs.frameDrawCall!,
            this.programs.frameFxaaDrawCall,
            this.fxaaEnabled,
        );
        this.loadPending(timeSec);
    }

    private resizeFramebuffers(): void {
        this.renderTargets.resize();

        this.resolutionUni[0] = this.app.width;
        this.resolutionUni[1] = this.app.height;
    }

    private updateSceneUniforms(timeSec: number): void {
        this.cameraPosUni[0] = this.camera.getPosX();
        this.cameraPosUni[1] = this.camera.getPosZ();

        this.sceneUniformBuffer!
            .set(0, this.camera.viewProjMatrix as Float32Array)
            .set(1, this.camera.viewMatrix as Float32Array)
            .set(2, this.camera.projectionMatrix as Float32Array)
            .set(3, this.skyColor as Float32Array)
            .set(4, this.cameraPosUni as Float32Array)
            .set(5, this.renderDistance as any)
            .set(6, this.fogDepth as any)
            .set(7, timeSec as any)
            .set(8, this.brightness as any)
            .set(9, this.colorBanding as any)
            .set(10, this.isNewTextureAnim as any)
            .set(11, this.debugTextureMode as any)
            .update();
    }

    private renderSceneToFramebuffer(): void {
        if (this.cullBackFace) {
            this.app.enable(PicoGL.CULL_FACE);
        } else {
            this.app.disable(PicoGL.CULL_FACE);
        }

        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthMask(true);

        this.app.drawFramebuffer(this.renderTargets.framebuffer!);

        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.clear();
        this.gl.clearBufferfv(PicoGL.COLOR, 0, this.skyColor);
    }

    protected renderPasses(
        scheduleInput: MapRenderWorkInput<WebGLMapSquare>,
        gatheredMaps: ReadonlyArray<WebGLMapSquare>,
        npcDataTextureIndex: number,
        npcDataTexture: Texture | undefined,
    ): void {
        this.app.disable(PicoGL.BLEND);
        const opaquePassStart = performance.now();
        const locOpaque = this.scheduler.buildLocWork<WebGLMapSquare>(
            scheduleInput,
            false,
            false,
            gatheredMaps,
        );
        this.geometry.mapDrawPasses.renderLoc(this, locOpaque);
        this.rendererStats.opaquePassTime = performance.now() - opaquePassStart;
        const opaqueNpcPassStart = performance.now();
        const npcOpaque = this.scheduler.buildNpcWork<WebGLMapSquare>(
            scheduleInput,
            false,
            false,
            gatheredMaps,
        );
        this.geometry.mapDrawPasses.renderNpc(this, npcOpaque, npcDataTextureIndex, npcDataTexture);
        this.rendererStats.opaqueNpcPassTime = performance.now() - opaqueNpcPassStart;

        this.app.enable(PicoGL.BLEND);
        const transparentPassStart = performance.now();
        const locTrans = this.scheduler.buildLocWork<WebGLMapSquare>(
            scheduleInput,
            true,
            true,
            gatheredMaps,
        );
        this.geometry.mapDrawPasses.renderLoc(this, locTrans);
        this.rendererStats.transparentPassTime = performance.now() - transparentPassStart;
        const transparentNpcPassStart = performance.now();
        const npcTrans = this.scheduler.buildNpcWork<WebGLMapSquare>(
            scheduleInput,
            true,
            true,
            gatheredMaps,
        );
        this.geometry.mapDrawPasses.renderNpc(this, npcTrans, npcDataTextureIndex, npcDataTexture);
        this.rendererStats.transparentNpcPassTime = performance.now() - transparentNpcPassStart;
    }

    loadPending(timeSec: number) {
        // Load new map squares
        const mapData = this.mapsToLoad.shift();
        if (mapData && this.isValidMapData(mapData)) {
            this.loadMap(mapData, timeSec);
        }
    }

    onFrameEnd(): void {
        this.stats.onFrameEnd();
    }

    isDrawRangePatchWasmReady(): boolean {
        return this.geometry.isTickBackendReady();
    }

    setNpcGpuFrameData(data: NpcGpuFrameData): void {
        this.npcGpuFrameData = data;
    }

    applyLocAnimationPatchesForPass(
        renderable: WebGLRenderable,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void {
        this.geometry.applyLocAnimationPatchesForPass(
            renderable,
            isAlpha,
            isInteract,
            isLod,
            drawCall,
            drawRangesPacked,
        );
    }

    applyNpcAnimationPatchesForPass(
        renderable: WebGLRenderable,
        isAlpha: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void {
        this.geometry.applyNpcAnimationPatchesForPass(
            renderable,
            isAlpha,
            drawCall,
            drawRangesPacked,
        );
    }

    draw(drawCall: DrawCall, drawRangesPacked: Int32Array) {
        if (this.hasMultiDraw) {
            drawCall.draw();
        } else {
            const drawCount = (drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0;
            const drawRange: DrawRange = [0, 0, 1];
            for (let i = 0; i < drawCount; i++) {
                const off = i * DRAW_RANGE_STRIDE;
                drawCall.uniform("u_drawId", i);
                drawRange[DRAW_RANGE_OFFSET_INDEX] =
                    drawRangesPacked[off + DRAW_RANGE_OFFSET_INDEX] | 0;
                drawRange[DRAW_RANGE_ELEMENTS_INDEX] =
                    drawRangesPacked[off + DRAW_RANGE_ELEMENTS_INDEX] | 0;
                drawRange[DRAW_RANGE_INSTANCES_INDEX] =
                    drawRangesPacked[off + DRAW_RANGE_INSTANCES_INDEX] | 0;
                drawCall.drawRanges(drawRange);
                drawCall.draw();
            }
        }
    }

    private collectVisibleUsedTextureIds(): Int32Array[] {
        const out: Int32Array[] = [];
        for (let i = 0; i < this.visibleMapCount; i++) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId);
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }
            const used = map.usedTextureIds;
            if (used instanceof Int32Array && used.length > 0) {
                out.push(used);
            }
        }
        return out;
    }

    async cleanUp(): Promise<void> {
        this.geometry.dispose();
        this.npcDataTextureRing.dispose();
        this.interactions.reset();
        await this.programs.dispose();

        this.quadArray?.delete();
        this.quadArray = undefined;

        this.quadPositions?.delete();
        this.quadPositions = undefined;

        // Uniforms
        this.sceneUniformBuffer?.delete();
        this.sceneUniformBuffer = undefined;

        this.renderTargets.dispose();

        this.textures.dispose();

        this.clearMaps();
        console.log("Renderer cleaned up");
    }
}
