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
import { Camera } from "../../mapviewer/Camera";
import { DrawRange } from "../DrawRange";
import { MapRenderer, TextureFilterMode } from "../MapRenderer";
import { FrameStats, RendererStats } from "../Renderer";
import { SdMapData } from "../../maprender/payload/SdMapData";
import { PostProcessPass } from "./PostProcessPass";
import { RenderTargets } from "./RenderTargets";
import { WebGLInteractionSystem, type InteractionsCallback } from "./WebGLInteractionSystem";
import { WebGLTextureSystem } from "./WebGLTextureSystem";
import { createWebGLDevice } from "./WebGLDevice";
import { WebGLPrograms } from "./WebGLPrograms";
import { WebGLMapSquare } from "./WebGLMapSquare";
import {
    type InteractionControllerRenderer,
    type InteractionInput,
    type InteractionSnapshotRenderer,
} from "../../runtime/contracts/Interaction";
import { NpcDataTextureRing } from "./NpcDataTextureRing";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../../runtime/entities/NpcGpuData";
import {
    chooseLocTickPatchVariant,
    chooseNpcTickPatchVariant,
} from "../../runtime/contracts/TickPatchStreams";
import {
    FRAME_RENDER_LIST_FLAG_HAS_NPCS,
    FRAME_RENDER_LIST_FLAG_IS_INTERACT,
    FRAME_RENDER_LIST_FLAG_IS_LOD,
    FRAME_RENDER_LIST_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
} from "../../runtime/contracts/FramePacket";
import type { FramePacket } from "../../runtime/contracts/FramePacket";
import { applyDrawRangePatches } from "./applyDrawRangePatches";
import {
    ensureDrawRangePatchBackendInit,
    resetDrawRangePatchBackend,
} from "../../wasm/DrawRangePatchBackend";
import { WebGLFramePacketState } from "./WebGLFramePacketState";

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

type FrameRenderMap = {
    mapId: number;
    map: WebGLMapSquare;
    hasNpcs: boolean;
    isInteract: boolean;
    isLod: boolean;
};

export class WebGLMapRenderer
    extends MapRenderer<WebGLMapSquare, SdMapData>
{
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

    override getInteractionControllerRenderer(): InteractionControllerRenderer | undefined {
        return this;
    }

    override getInteractionSnapshotRenderer(): InteractionSnapshotRenderer | undefined {
        return this;
    }

    override applyFramePacket(packet: FramePacket | undefined): void {
        this.framePacketState.apply(packet);
        if (!packet) {
            this.npcDataTexture = undefined;
        }
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
            this.loadMapSquareRenderable(
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
            const writtenIndex = this.npcDataTextureRing.write(
                this.app,
                ringIndex,
                packedNpcData,
            );
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
        frameRenderMaps: ReadonlyArray<FrameRenderMap>,
        npcDataTexture: Texture | undefined,
    ): void {
        const totalMaps = frameRenderMaps.length | 0;
        this.app.disable(PicoGL.BLEND);
        const opaquePassStart = performance.now();
        for (let i = 0; i < totalMaps; i++) {
            const entry = frameRenderMaps[i]!;
            this.renderLocMapPass(entry.map, false, entry.isInteract, entry.isLod);
        }
        this.rendererStats.opaquePassTime = performance.now() - opaquePassStart;

        const opaqueNpcPassStart = performance.now();
        if (this.loadNpcs) {
            for (let i = 0; i < totalMaps; i++) {
                const entry = frameRenderMaps[i]!;
                if (!entry.hasNpcs) {
                    continue;
                }
                this.renderNpcMapPass(
                    entry.map,
                    entry.mapId,
                    false,
                    npcDataTexture,
                );
            }
        }
        this.rendererStats.opaqueNpcPassTime = performance.now() - opaqueNpcPassStart;

        this.app.enable(PicoGL.BLEND);
        const transparentPassStart = performance.now();
        for (let i = totalMaps - 1; i >= 0; i--) {
            const entry = frameRenderMaps[i]!;
            this.renderLocMapPass(entry.map, true, entry.isInteract, entry.isLod);
        }
        this.rendererStats.transparentPassTime = performance.now() - transparentPassStart;

        const transparentNpcPassStart = performance.now();
        if (this.loadNpcs) {
            for (let i = totalMaps - 1; i >= 0; i--) {
                const entry = frameRenderMaps[i]!;
                if (!entry.hasNpcs) {
                    continue;
                }
                this.renderNpcMapPass(
                    entry.map,
                    entry.mapId,
                    true,
                    npcDataTexture,
                );
            }
        }
        this.rendererStats.transparentNpcPassTime = performance.now() - transparentNpcPassStart;
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

    private renderNpcMapPass(
        map: WebGLMapSquare,
        mapId: number,
        isAlpha: boolean,
        npcDataTexture: Texture | undefined,
    ): void {
        const drawData = this.getNpcMapDrawCall(map, mapId, npcDataTexture);
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
        const variant = chooseLocTickPatchVariant(isAlpha, isInteract, isLod) as number;
        const mapId = renderable.id | 0;
        const entryIndex = frame.mapIdToIndex.get(mapId);
        if (entryIndex !== undefined) {
            const streamIndex = variant | 0; // loc variants 0..7
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
            // npc variants occupy streams 8..9 in the packet
            const npcVariant = chooseNpcTickPatchVariant(isAlpha) as number;
            const streamIndex = (8 + (npcVariant | 0)) | 0;
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
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }
            let item = out[write];
            if (!item) {
                item = {
                    mapId,
                    map,
                    hasNpcs: (flags & FRAME_RENDER_LIST_FLAG_HAS_NPCS) !== 0,
                    isInteract: (flags & FRAME_RENDER_LIST_FLAG_IS_INTERACT) !== 0,
                    isLod: (flags & FRAME_RENDER_LIST_FLAG_IS_LOD) !== 0,
                };
                out[write] = item;
            } else {
                item.mapId = mapId;
                item.map = map;
                item.hasNpcs = (flags & FRAME_RENDER_LIST_FLAG_HAS_NPCS) !== 0;
                item.isInteract = (flags & FRAME_RENDER_LIST_FLAG_IS_INTERACT) !== 0;
                item.isLod = (flags & FRAME_RENDER_LIST_FLAG_IS_LOD) !== 0;
            }
            write = (write + 1) | 0;
        }
        out.length = write;
        return out;
    }

    private collectVisibleUsedTextureIds(frameRenderMaps: ReadonlyArray<FrameRenderMap>): Int32Array[] {
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
        mapId: number,
        npcDataTexture: Texture | undefined,
    ): Readonly<{ drawCall: DrawCall; drawRangesPacked: Int32Array }> | undefined {
        if (!npcDataTexture) {
            return undefined;
        }
        const packetOffset = this.framePacketState.getNpcDataOffsetForCurrentRing(mapId);
        const dataOffset = packetOffset !== undefined ? packetOffset | 0 : -1;
        if (dataOffset === -1) {
            return undefined;
        }
        const { drawCall, drawRangesPacked } = map.drawCallNpc;
        drawCall.uniform("u_npcDataOffset", dataOffset);
        drawCall.texture("u_npcDataTexture", npcDataTexture);
        return { drawCall, drawRangesPacked };
    }
}
