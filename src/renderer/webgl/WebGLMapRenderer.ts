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

import type { ObjRenderData, SdMapData } from "../../maprender/MapRenderPayload";
import { Camera } from "../Camera";
import type { TextureService } from "../../rs/loaders/Loaders";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import type { DrawRange } from "../../shared/DrawRange";
import {
    FRAME_RENDER_LIST_FLAG_IS_INTERACT,
    FRAME_RENDER_LIST_FLAG_IS_LOD,
    FRAME_RENDER_LIST_STRIDE,
} from "../RenderFramePacket";
import type { RenderFramePacket } from "../RenderFramePacket";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../NpcGpuFrame";
import {
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
    getLocTickPatchStreamIndex,
    getNpcTickPatchStreamIndex,
} from "../../shared/TickPatchLayout";
import { isWebGL2Supported } from "../../util/DeviceUtil";
import {
    ensureDrawRangePatchBackendInit,
    resetDrawRangePatchBackend,
} from "../../wasm/DrawRangePatchBackend";
import { MapRenderer, TextureFilterMode } from "../MapRenderer";
import { FrameStats, RendererStats } from "../Renderer";
import { NpcDataTextureRing } from "./NpcDataTextureRing";
import { PostProcessPass } from "./PostProcessPass";
import { RenderTargets } from "./RenderTargets";
import { createWebGLDevice } from "./WebGLDevice";
import { WebGLFramePacketState } from "./WebGLFramePacketState";
import { type InteractionsCallback, WebGLInteractionSystem } from "./WebGLInteractionSystem";
import { WebGLMapSquare } from "./WebGLMapSquare";
import { WebGLPrograms } from "./WebGLPrograms";
import { WebGLTextureSystem } from "./WebGLTextureSystem";
import { applyDrawRangePatches } from "./applyDrawRangePatches";
import type {
    InteractionControllerRenderer,
    InteractionSnapshotRenderer,
    InteractionInput,
} from "../MapRenderer";

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

type FrameRenderMap = {
    mapId: number;
    map: WebGLMapSquare;
    npcRangeStart: number;
    npcRangeCount: number;
    isInteract: boolean;
    isLod: boolean;
};

type PendingMapObjRenderUpdate = Readonly<{
    hasObjRenderDataUpdate: boolean;
    objRenderData?: ObjRenderData;
    hiddenObjIndicesPacked?: Int32Array;
}>;

type WebGLMapRendererDeps = Readonly<{
    cacheName: string;
    textureLoader: TextureService;
    isNewTextureAnim: boolean;
    maxTexturePreloadCount?: number;
}>;

export class WebGLMapRenderer extends MapRenderer<WebGLMapSquare, SdMapData> {
    protected readonly textures: WebGLTextureSystem;
    private readonly interactions: WebGLInteractionSystem;
    protected readonly programs = new WebGLPrograms();
    private readonly renderTargets = new RenderTargets();
    private readonly postProcessPass = new PostProcessPass();
    private readonly npcDataTextureRing = new NpcDataTextureRing(NPC_DATA_TEXTURE_RING_SIZE);
    private readonly framePacketState = new WebGLFramePacketState();
    private npcDataTexture: Texture | undefined;
    private hoveredMapIdsPackedScratch = new Int32Array(0);
    private readonly frameRenderMapsScratch: FrameRenderMap[] = [];
    private readonly visibleUsedTextureIdsScratch: Int32Array[] = [];
    private readonly warnedNpcMissingGeometryOrRangesMapIds = new Set<number>();
    private readonly pendingObjRenderUpdatesByMapId = new Map<number, PendingMapObjRenderUpdate>();
    private readonly drawRangeScratch: DrawRange = [0, 0, 1];

    app!: PicoApp;
    gl!: WebGL2RenderingContext;

    quadPositions?: VertexBuffer;
    quadArray?: VertexArray;

    // Uniforms
    sceneUniformBuffer?: UniformBuffer;

    cameraPosUni: vec2 = vec2.fromValues(0, 0);
    resolutionUni: vec2 = vec2.fromValues(0, 0);
    renderDistanceUni = new Float32Array(1);
    fogDepthUni = new Float32Array(1);
    currentTimeUni = new Float32Array(1);
    brightnessUni = new Float32Array(1);
    colorBandingUni = new Float32Array(1);
    isNewTextureAnimUni = new Float32Array(1);
    debugTextureModeUni = new Float32Array(1);

    isNewTextureAnim: boolean = false;

    debugTextureMode: number = 0;

    constructor(
        readonly cacheResources: WebGLMapRendererDeps,
        renderDistance: number,
        unloadDistance: number,
        lodDistance: number,
        readonly camera: Camera,
        onInteractions?: InteractionsCallback,
    ) {
        super(cacheResources.cacheName, renderDistance, unloadDistance, lodDistance);
        this.stats = new FrameStats();
        this.rendererStats = new RendererStats();
        this.textures = new WebGLTextureSystem(this.loadedTextureIds);
        this.interactions = new WebGLInteractionSystem(onInteractions);
    }

    static isSupported(): boolean {
        return isWebGL2Supported;
    }

    override getInteractionControllerRenderer(): InteractionControllerRenderer | undefined {
        return this;
    }

    override getInteractionSnapshotRenderer(): InteractionSnapshotRenderer | undefined {
        return this;
    }

    override applyFramePacket(packet: RenderFramePacket | undefined): void {
        if (packet?.runtimeRenderUpdates) {
            for (let index = 0; index < packet.runtimeRenderUpdates.updates.length; index++) {
                const update = packet.runtimeRenderUpdates.updates[index];
                if (!update) {
                    continue;
                }
                this.applyMapObjRenderDataUpdate(update.mapId | 0, update);
            }
        }
        this.framePacketState.apply(packet);
        if (!packet) {
            this.npcDataTexture = undefined;
        }
    }

    private applyMapObjRenderDataUpdate(
        mapId: number,
        update: PendingMapObjRenderUpdate,
    ): void {
        const normalizedMapId = mapId | 0;
        this.pendingObjRenderUpdatesByMapId.set(normalizedMapId, update);
        const map = this.loadedMaps.get(normalizedMapId);
        const textureArray = this.textures.getTextureArray();
        const textureSlotLut = this.textures.getTextureSlotLut();
        const textureMaterials = this.textures.getMaterialsTexture();
        if (
            !map ||
            !textureArray ||
            !textureSlotLut ||
            !textureMaterials ||
            !this.sceneUniformBuffer ||
            !this.programs.mainProgram ||
            !this.programs.mainAlphaProgram
        ) {
            return;
        }
        map.replaceObjRenderData(
            this.app,
            this.programs.mainProgram,
            this.programs.mainAlphaProgram,
            textureArray,
            textureMaterials,
            textureSlotLut,
            this.sceneUniformBuffer,
            update,
        );
    }

    setInteractionInput(input: InteractionInput): void {
        this.interactions.setInput(input);
    }

    getHoveredMapIdsPacked(): Int32Array {
        const hovered = this.interactions.getHoveredMapIds();
        const count = hovered.size | 0;
        if ((this.hoveredMapIdsPackedScratch.length | 0) !== count) {
            this.hoveredMapIdsPackedScratch = new Int32Array(count);
        }
        let write = 0;
        for (const mapId of hovered) {
            this.hoveredMapIdsPackedScratch[write++] = mapId | 0;
        }
        return this.hoveredMapIdsPackedScratch;
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
        ensureDrawRangePatchBackendInit();

        console.log("Renderer init");
    }

    initCache(): void {
        this.isNewTextureAnim = this.cacheResources.isNewTextureAnim;
        this.warnedNpcMissingGeometryOrRangesMapIds.clear();
        this.pendingObjRenderUpdatesByMapId.clear();

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
            this.cacheResources.textureLoader,
            this.cacheResources.maxTexturePreloadCount,
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
        const mapId = getMapSquareId(mapX, mapY);
        const textureArray = this.textures.getTextureArray();
        const textureSlotLut = this.textures.getTextureSlotLut();
        const textureMaterials = this.textures.getMaterialsTexture();
        if (!textureArray || !textureSlotLut || !textureMaterials || !this.sceneUniformBuffer) {
            return;
        }
        const objUpdate = this.pendingObjRenderUpdatesByMapId.get(mapId);

        this.loadedMaps.set(
            mapId,
            this.loadMapSquareRenderable(
                this.app,
                this.programs,
                textureArray,
                textureMaterials,
                textureSlotLut,
                this.sceneUniformBuffer,
                mapData,
                objUpdate?.objRenderData,
                objUpdate?.hiddenObjIndicesPacked,
                time,
                this.stats.frameCount,
            ),
        );

        this.textures.onLoadedTextures(mapData.loadedTextures, this.stats.frameCount);
    }

    onResize(width: number, height: number): void {
        this.app.resize(width, height);
    }

    render(time: number, deltaTime: number, resized: boolean): void {
        this.rendererStats.frameStart = performance.now();
        this.rendererStats.drawCalls = 0;
        this.rendererStats.drawRangeCalls = 0;
        this.rendererStats.multiDrawCalls = 0;
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
        const frameRenderMaps = this.collectFrameRenderMaps();
        this.textures.updateVisibleResidency(
            this.collectVisibleUsedTextureIds(frameRenderMaps),
            this.stats.frameCount,
            this.debugTextureMode !== 0,
        );

        this.renderSceneToFramebuffer();
        if (this.framePacketState.isNpcDataTextureDirty()) {
            const packedNpcData = this.framePacketState.getNpcGpuFrameData() ?? {
                width: 16,
                height: 1,
                data: new Uint16Array(16 * 4),
            };
            const ringIndex = this.framePacketState.getNpcDataRingIndex();
            const writtenIndex = this.npcDataTextureRing.write(this.app, ringIndex, packedNpcData);
            this.framePacketState.setNpcDataRingIndex(writtenIndex);
            this.npcDataTexture = this.npcDataTextureRing.get(writtenIndex);
            this.framePacketState.markNpcDataTextureClean();
        }
        this.renderPasses(frameRenderMaps, this.npcDataTexture);
        this.postProcessPass.blitSceneToTexture(this.app, this.gl, this.renderTargets);
        this.interactions.frame(
            this.gl,
            this.app,
            this.msaaEnabled,
            this.renderTargets.interactFramebuffer!,
            this.stats.frameCount,
            this.rendererStats,
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
        this.renderDistanceUni[0] = this.renderDistance;
        this.fogDepthUni[0] = this.fogDepth;
        this.currentTimeUni[0] = timeSec;
        this.brightnessUni[0] = this.brightness;
        this.colorBandingUni[0] = this.colorBanding;
        this.isNewTextureAnimUni[0] = this.isNewTextureAnim ? 1 : 0;
        this.debugTextureModeUni[0] = this.debugTextureMode;

        this.sceneUniformBuffer!.set(0, this.camera.viewProjMatrix as Float32Array)
            .set(1, this.camera.viewMatrix as Float32Array)
            .set(2, this.camera.projectionMatrix as Float32Array)
            .set(3, this.skyColor as Float32Array)
            .set(4, this.cameraPosUni as Float32Array)
            .set(5, this.renderDistanceUni)
            .set(6, this.fogDepthUni)
            .set(7, this.currentTimeUni)
            .set(8, this.brightnessUni)
            .set(9, this.colorBandingUni)
            .set(10, this.isNewTextureAnimUni)
            .set(11, this.debugTextureModeUni)
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
        frameRenderMaps: ReadonlyArray<FrameRenderMap>,
        npcDataTexture: Texture | undefined,
    ): void {
        const totalMaps = frameRenderMaps.length | 0;
        this.app.disable(PicoGL.BLEND);
        const opaquePassStart = performance.now();
        this.renderStaticMapPasses(frameRenderMaps, totalMaps, false);
        this.rendererStats.opaquePassTime = performance.now() - opaquePassStart;

        const opaqueNpcPassStart = performance.now();
        this.renderNpcMapPasses(frameRenderMaps, totalMaps, false, npcDataTexture);
        this.rendererStats.opaqueNpcPassTime = performance.now() - opaqueNpcPassStart;

        this.app.enable(PicoGL.BLEND);
        const transparentPassStart = performance.now();
        this.renderStaticMapPasses(frameRenderMaps, totalMaps, true);
        this.rendererStats.transparentPassTime = performance.now() - transparentPassStart;

        const transparentNpcPassStart = performance.now();
        this.renderNpcMapPasses(frameRenderMaps, totalMaps, true, npcDataTexture);
        this.rendererStats.transparentNpcPassTime = performance.now() - transparentNpcPassStart;
    }

    private renderStaticMapPasses(
        frameRenderMaps: ReadonlyArray<FrameRenderMap>,
        totalMaps: number,
        isAlpha: boolean,
    ): void {
        if (isAlpha) {
            for (let i = totalMaps - 1; i >= 0; i--) {
                this.renderStaticMapPass(frameRenderMaps[i]!, isAlpha);
            }
            return;
        }
        for (let i = 0; i < totalMaps; i++) {
            this.renderStaticMapPass(frameRenderMaps[i]!, isAlpha);
        }
    }

    private renderStaticMapPass(entry: FrameRenderMap, isAlpha: boolean): void {
        this.renderLocMapPass(entry.map, isAlpha, entry.isInteract, entry.isLod);
        if (this.loadObjs) {
            this.renderObjMapPass(entry.map, isAlpha, entry.isInteract, entry.isLod);
        }
    }

    private renderNpcMapPasses(
        frameRenderMaps: ReadonlyArray<FrameRenderMap>,
        totalMaps: number,
        isAlpha: boolean,
        npcDataTexture: Texture | undefined,
    ): void {
        if (!this.loadNpcs) {
            return;
        }
        if (isAlpha) {
            for (let i = totalMaps - 1; i >= 0; i--) {
                this.renderNpcMapEntry(frameRenderMaps[i]!, isAlpha, npcDataTexture);
            }
            return;
        }
        for (let i = 0; i < totalMaps; i++) {
            this.renderNpcMapEntry(frameRenderMaps[i]!, isAlpha, npcDataTexture);
        }
    }

    private renderNpcMapEntry(
        entry: FrameRenderMap,
        isAlpha: boolean,
        npcDataTexture: Texture | undefined,
    ): void {
        if ((entry.npcRangeCount | 0) <= 0) {
            return;
        }
        this.renderNpcMapPass(
            entry.map,
            entry.npcRangeStart | 0,
            entry.npcRangeCount | 0,
            isAlpha,
            npcDataTexture,
        );
    }

    private renderLocMapPass(
        map: WebGLMapSquare,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): void {
        const drawData = this.getLocMapDrawCall(map, isAlpha, isInteract, isLod);
        this.applyLocAnimationPatchesForPass(
            map,
            isAlpha,
            isInteract,
            isLod,
            drawData.drawCall,
            drawData.drawRangesPacked,
        );
        this.draw(drawData.drawCall, drawData.drawRangesPacked);
    }

    private renderObjMapPass(
        map: WebGLMapSquare,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): void {
        const drawData = map.getObjDrawCall(isAlpha, isInteract, isLod);
        if (!drawData) {
            return;
        }
        this.draw(drawData.drawCall, drawData.drawRangesPacked);
    }

    private renderNpcMapPass(
        map: WebGLMapSquare,
        npcRangeStart: number,
        npcRangeCount: number,
        isAlpha: boolean,
        npcDataTexture: Texture | undefined,
    ): void {
        const drawData = this.getNpcMapDrawCall(
            map,
            npcRangeStart | 0,
            npcRangeCount | 0,
            npcDataTexture,
        );
        if (!drawData) {
            return;
        }
        this.applyNpcAnimationPatchesForPass(
            map,
            isAlpha,
            drawData.drawCall,
            drawData.drawRangesPacked,
        );
        this.draw(drawData.drawCall, drawData.drawRangesPacked);
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

    applyLocAnimationPatchesForPass(
        renderable: WebGLMapSquare,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void {
        const frame = this.framePacketState.getTickPatches();
        if (!frame) {
            return;
        }
        const mapId = renderable.id | 0;
        const entryIndex = frame.mapIdToIndex.get(mapId);
        if (entryIndex !== undefined) {
            const streamIndex = getLocTickPatchStreamIndex(isAlpha, isInteract, isLod);
            const idx = (entryIndex * TICK_PATCH_STREAM_COUNT + streamIndex) | 0;
            const count = frame.streamCounts[idx] | 0;
            if (count > 0) {
                const off = frame.streamOffsets[idx] | 0;
                const len = (count * TICK_PATCH_ENTRY_STRIDE) | 0;
                const end = Math.min((off + len) | 0, frame.patchesPacked.length | 0);
                const slice = frame.patchesPacked.subarray(off, end);
                applyDrawRangePatches(drawCall, drawRangesPacked, slice, count);
            }
        }
    }

    applyNpcAnimationPatchesForPass(
        renderable: WebGLMapSquare,
        isAlpha: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void {
        const frame = this.framePacketState.getTickPatches();
        if (!frame) {
            return;
        }
        const mapId = renderable.id | 0;
        const entryIndex = frame.mapIdToIndex.get(mapId);
        if (entryIndex !== undefined) {
            const streamIndex = getNpcTickPatchStreamIndex(isAlpha);
            const idx = (entryIndex * TICK_PATCH_STREAM_COUNT + streamIndex) | 0;
            const count = frame.streamCounts[idx] | 0;
            if (count > 0) {
                const off = frame.streamOffsets[idx] | 0;
                const len = (count * TICK_PATCH_ENTRY_STRIDE) | 0;
                const end = Math.min((off + len) | 0, frame.patchesPacked.length | 0);
                const slice = frame.patchesPacked.subarray(off, end);
                applyDrawRangePatches(drawCall, drawRangesPacked, slice, count);
            }
        }
    }

    draw(drawCall: DrawCall, drawRangesPacked: Int32Array) {
        if (this.hasMultiDraw) {
            this.rendererStats.drawCalls = (this.rendererStats.drawCalls + 1) | 0;
            this.rendererStats.multiDrawCalls = (this.rendererStats.multiDrawCalls + 1) | 0;
            this.rendererStats.drawRangeCalls =
                (this.rendererStats.drawRangeCalls +
                    ((drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0)) |
                0;
            drawCall.draw();
        } else {
            const drawCount = (drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0;
            this.rendererStats.drawRangeCalls =
                (this.rendererStats.drawRangeCalls + drawCount) | 0;
            for (let i = 0; i < drawCount; i++) {
                this.rendererStats.drawCalls = (this.rendererStats.drawCalls + 1) | 0;
                const off = i * DRAW_RANGE_STRIDE;
                drawCall.uniform("u_drawId", i);
                this.drawRangeScratch[DRAW_RANGE_OFFSET_INDEX] =
                    drawRangesPacked[off + DRAW_RANGE_OFFSET_INDEX] | 0;
                this.drawRangeScratch[DRAW_RANGE_ELEMENTS_INDEX] =
                    drawRangesPacked[off + DRAW_RANGE_ELEMENTS_INDEX] | 0;
                this.drawRangeScratch[DRAW_RANGE_INSTANCES_INDEX] =
                    drawRangesPacked[off + DRAW_RANGE_INSTANCES_INDEX] | 0;
                drawCall.drawRanges(this.drawRangeScratch);
                drawCall.draw();
            }
        }
    }

    private collectFrameRenderMaps(): FrameRenderMap[] {
        const out = this.frameRenderMapsScratch;
        const packed = this.framePacketState.getRenderListPacked();
        if (packed === undefined) {
            out.length = 0;
            return out;
        }

        let write = 0;
        const entryCount = (packed.length / FRAME_RENDER_LIST_STRIDE) | 0;
        for (let i = 0; i < entryCount; i++) {
            const off = (i * FRAME_RENDER_LIST_STRIDE) | 0;
            const mapId = packed[off + 0] | 0;
            const flags = packed[off + 1] | 0;
            const map = this.loadedMaps.get(mapId);
            if (!map) {
                continue;
            }
            let item = out[write];
            if (!item) {
                item = {
                    mapId,
                    map,
                    npcRangeStart: 0,
                    npcRangeCount: 0,
                    isInteract: (flags & FRAME_RENDER_LIST_FLAG_IS_INTERACT) !== 0,
                    isLod: (flags & FRAME_RENDER_LIST_FLAG_IS_LOD) !== 0,
                };
                out[write] = item;
            } else {
                item.mapId = mapId;
                item.map = map;
                item.isInteract = (flags & FRAME_RENDER_LIST_FLAG_IS_INTERACT) !== 0;
                item.isLod = (flags & FRAME_RENDER_LIST_FLAG_IS_LOD) !== 0;
            }
            const npcDataRange = this.framePacketState.getNpcDataRangeForCurrentRing(mapId);
            if (!npcDataRange) {
                throw new Error(
                    `[map-render][strict-frame-packet] missingNpcRangeForMap mapId=${mapId | 0}`,
                );
            }
            item.npcRangeStart = npcDataRange.start | 0;
            item.npcRangeCount = npcDataRange.count | 0;
            write = (write + 1) | 0;
        }
        out.length = write;
        return out;
    }

    private collectVisibleUsedTextureIds(
        frameRenderMaps: ReadonlyArray<FrameRenderMap>,
    ): Int32Array[] {
        const out = this.visibleUsedTextureIdsScratch;
        let write = 0;
        for (let i = 0; i < frameRenderMaps.length; i++) {
            const map = frameRenderMaps[i]!.map;
            const used = map.usedTextureIds;
            if (used instanceof Int32Array && used.length > 0) {
                out[write] = used;
                write = (write + 1) | 0;
            }
        }
        out.length = write;
        return out;
    }

    async cleanUp(): Promise<void> {
        resetDrawRangePatchBackend();
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

        this.framePacketState.reset();
        this.npcDataTexture = undefined;
        this.warnedNpcMissingGeometryOrRangesMapIds.clear();
        this.pendingObjRenderUpdatesByMapId.clear();
        this.clearMaps();
        console.log("Renderer cleaned up");
    }

    private loadMapSquareRenderable(
        app: PicoApp,
        programs: WebGLPrograms,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        objRenderData: ObjRenderData | undefined,
        hiddenObjIndicesPacked: Int32Array | undefined,
        timeSec: number,
        frameCount: number,
    ): WebGLMapSquare {
        return WebGLMapSquare.load(
            app,
            programs.mainProgram!,
            programs.mainAlphaProgram!,
            programs.npcProgram!,
            textureArray,
            textureMaterials,
            textureSlotLut,
            sceneUniformBuffer,
            mapData,
            objRenderData,
            hiddenObjIndicesPacked,
            timeSec,
            frameCount,
        );
    }

    private getLocMapDrawCall(
        map: WebGLMapSquare,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): Readonly<{ drawCall: DrawCall; drawRangesPacked: Int32Array }> {
        return map.getDrawCall(isAlpha, isInteract, isLod);
    }

    private getNpcMapDrawCall(
        map: WebGLMapSquare,
        npcRangeStart: number,
        npcRangeCount: number,
        npcDataTexture: Texture | undefined,
    ): Readonly<{ drawCall: DrawCall; drawRangesPacked: Int32Array }> | undefined {
        if (!npcDataTexture) {
            return undefined;
        }
        if ((npcRangeCount | 0) <= 0) {
            return undefined;
        }
        const { drawCall, drawRangesPacked } = map.drawCallNpc;
        const hasNpcDrawRanges = (drawRangesPacked.length | 0) > 0;
        const hasNpcGeometry = map.npcVertexArray !== undefined;
        if (
            (!hasNpcDrawRanges || !hasNpcGeometry) &&
            !this.warnedNpcMissingGeometryOrRangesMapIds.has(map.id | 0)
        ) {
            this.warnedNpcMissingGeometryOrRangesMapIds.add(map.id | 0);
            console.warn(
                `[map-render][npc] frame packet has npc range but map has no npc geometry/ranges ` +
                    `(mapId=${map.id | 0} drawRangesInts=${
                        drawRangesPacked.length | 0
                    } hasNpcGeometry=${hasNpcGeometry ? 1 : 0})`,
            );
        }
        if (!hasNpcDrawRanges || !hasNpcGeometry) {
            return undefined;
        }
        drawCall.uniform("u_npcDataOffset", npcRangeStart | 0);
        drawCall.texture("u_npcDataTexture", npcDataTexture);
        return { drawCall, drawRangesPacked };
    }
}
