import { vec2 } from "gl-matrix";
import { button, folder } from "leva";
import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Program,
    Renderbuffer,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { GameType } from "../../rs/cache/CacheInfo";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { CacheSession } from "../../rs/runtime/createCacheSession";
import { TileRenderFlag } from "../../rs/scene/Scene";
import { isWebGL2Supported, pixelRatio } from "../../util/DeviceUtil";
import { InputManager } from "../../util/InputManager";
import { RenderDataWorkerPool } from "../../worker/RenderDataWorkerPool";
import { Camera } from "../Camera";
import { DrawRange, NULL_DRAW_RANGE } from "../DrawRange";
import { INTERACTION_RADIUS, INTERACT_BUFFER_COUNT, Interactions } from "../Interactions";
import { MapRenderer, TextureFilterMode, getMaxAnisotropy } from "../MapRenderer";
import { FrameStats } from "../Renderer";
import { SdMapData } from "../loader/SdMapData";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../loader/SdMapLoaderInput";
import { createTextureArray } from "./PicoTexture";
import { RendererStats } from "./RendererStats";
import { WebGLMapSquare } from "./WebGLMapSquare";
import { WebGLRenderable } from "./WebGLRenderable";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
} from "./shaders/Shaders";

const MAX_TEXTURES = 2048;
const TEXTURE_SIZE = 128;
const MAX_TEXTURE_SLOTS = 256;
const MAX_TEXTURE_UPLOADS_PER_FRAME = 16;
const MAX_TEXTURE_PIXEL_CACHE = 512;

const enum EnsureTextureStatus {
    Ok = 0,
    UnknownTexture = 1,
    Oversubscribed = 2,
    DecodeFailed = 3,
}

export class WebGLMapRenderer extends MapRenderer<WebGLMapSquare, SdMapData> {
    dataLoader: SdMapDataLoader;

    app!: PicoApp;
    gl!: WebGL2RenderingContext;

    quadPositions?: VertexBuffer;
    quadArray?: VertexArray;

    // Shaders
    shadersPromise?: Promise<Program[]>;
    mainProgram?: Program;
    mainAlphaProgram?: Program;
    npcProgram?: Program;
    frameProgram?: Program;
    frameFxaaProgram?: Program;

    // Uniforms
    sceneUniformBuffer?: UniformBuffer;

    cameraPosUni: vec2 = vec2.fromValues(0, 0);
    resolutionUni: vec2 = vec2.fromValues(0, 0);

    colorTarget?: Renderbuffer;
    interactTarget?: Renderbuffer;
    depthTarget?: Renderbuffer;
    framebuffer?: Framebuffer;

    textureColorTarget?: Texture;
    textureFramebuffer?: Framebuffer;

    interactColorTarget?: Texture;
    interactFramebuffer?: Framebuffer;

    // Textures
    textureArray?: Texture;
    textureMaterials?: Texture;
    textureSlotLut?: Texture;

    textureIds: number[] = [];
    textureIdToIndex: Map<number, number> = new Map();

    private textureIdToSlot: Map<number, number> = new Map();
    private freeTextureSlots: number[] = [];
    private textureLastUsedFrame: Map<number, number> = new Map();
    private textureSlotLutData?: Uint16Array;
    private textureSlotCount: number = 0;

    private visibleTextureIds: Set<number> = new Set();
    private texturePixelCache: Map<number, Int32Array> = new Map();

    frameDrawCall?: DrawCall;
    frameFxaaDrawCall?: DrawCall;

    interactions: Interactions[];
    hoveredMapIds: Set<number> = new Set();
    closestInteractIndices: Map<number, number[]> = new Map();
    interactBuffer?: Float32Array;

    npcRenderCount: number = 0;
    npcRenderData: Uint16Array = new Uint16Array(16 * 4);

    npcDataTextureBuffer: (Texture | undefined)[] = new Array(5);

    isNewTextureAnim: boolean = false;

    debugTextureMode: number = 0;

    private debugLastResidencyLogFrame: number = 0;

    private logTextureDebugStats(): void {
        const cacheInfo = this.session.cache.info;
        const textureLoader = this.session.loaders.textureLoader as unknown as {
            constructor?: { name?: string };
        };
        console.log(
            `texture debug: cache=${cacheInfo.name} game=${cacheInfo.game} rev=${
                cacheInfo.revision
            } loader=${textureLoader?.constructor?.name ?? "unknown"} slots=${
                this.textureSlotCount - 1
            } visible=${this.visibleTextureIds.size} resident=${this.textureIdToSlot.size} free=${
                this.freeTextureSlots.length
            }`,
        );

        const sampleIds: number[] = [];
        for (const id of this.visibleTextureIds) {
            sampleIds.push(id);
            if (sampleIds.length >= 10) break;
        }

        const samplePixelStride = 97;
        const samplePixelCount = 512;
        for (const textureId of sampleIds) {
            const index = this.textureIdToIndex.get(textureId) ?? -1;
            const slot = this.textureIdToSlot.get(textureId) ?? 0;
            const pixels = this.texturePixelCache.get(textureId);
            if (!pixels) {
                console.log(
                    `texture debug: id=${textureId} index=${index} slot=${slot} pixels=missing`,
                );
                continue;
            }

            let chroma = 0;
            const n = Math.min(samplePixelCount, pixels.length);
            for (let i = 0; i < n; i++) {
                const p = pixels[(i * samplePixelStride) % pixels.length] | 0;
                const r = (p >> 16) & 0xff;
                const g = (p >> 8) & 0xff;
                const b = p & 0xff;
                if (r !== g || g !== b) {
                    chroma++;
                }
            }
            const p0 = pixels[0] | 0;
            console.log(
                `texture debug: id=${textureId} index=${index} slot=${slot} chroma=${chroma}/${n} p0=0x${(
                    p0 >>> 0
                )
                    .toString(16)
                    .padStart(8, "0")}`,
            );
        }
    }

    constructor(
        readonly session: CacheSession,
        readonly workerPool: RenderDataWorkerPool,
        readonly inputManager: InputManager,
        renderDistance: number,
        unloadDistance: number,
        lodDistance: number,
        readonly camera: Camera,
    ) {
        super(session.cache, renderDistance, unloadDistance, lodDistance);
        this.dataLoader = new SdMapDataLoader();
        this.stats = new FrameStats();
        this.rendererStats = new RendererStats();
        this.interactions = new Array(INTERACT_BUFFER_COUNT);
        for (let i = 0; i < INTERACT_BUFFER_COUNT; i++) {
            this.interactions[i] = new Interactions(INTERACTION_RADIUS);
        }
    }

    static isSupported(): boolean {
        return isWebGL2Supported;
    }

    getViewportDimensions(): { width: number; height: number } {
        return { width: this.app.width, height: this.app.height };
    }

    async init(canvas: HTMLCanvasElement): Promise<void> {
        this.app = PicoGL.createApp(canvas);
        this.gl = this.app.gl as WebGL2RenderingContext;

        // hack to get the right multi draw extension for picogl
        const state: any = this.app.state;
        const ext = this.gl.getExtension("WEBGL_multi_draw");
        PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED = ext;
        state.extensions.multiDrawInstanced = ext;

        this.hasMultiDraw = !!PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED;

        this.gl.getExtension("EXT_float_blend");

        this.app.enable(PicoGL.CULL_FACE);
        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthFunc(PicoGL.LEQUAL);
        this.app.enable(PicoGL.BLEND);
        this.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);

        this.quadPositions = this.app.createVertexBuffer(
            PicoGL.FLOAT,
            2,
            new Float32Array([-1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1]),
        );
        this.quadArray = this.app.createVertexArray().vertexAttributeBuffer(0, this.quadPositions);

        this.shadersPromise = this.initShaders();

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

        this.initFramebuffers();

        this.initTextures();

        console.log("Renderer init");
    }

    async initShaders(): Promise<Program[]> {
        const hasMultiDraw = this.hasMultiDraw;

        const programs = await this.app.createPrograms(
            createMainProgram(hasMultiDraw, false),
            createMainProgram(hasMultiDraw, true),
            createNpcProgram(hasMultiDraw, true),
            FRAME_PROGRAM,
            FRAME_FXAA_PROGRAM,
        );

        const [mainProgram, mainAlphaProgram, npcProgram, frameProgram, frameFxaaProgram] =
            programs;
        this.mainProgram = mainProgram;
        this.mainAlphaProgram = mainAlphaProgram;
        this.npcProgram = npcProgram;
        this.frameProgram = frameProgram;
        this.frameFxaaProgram = frameFxaaProgram;

        this.frameDrawCall = this.app.createDrawCall(frameProgram, this.quadArray);
        this.frameFxaaDrawCall = this.app.createDrawCall(frameFxaaProgram, this.quadArray);

        return programs;
    }

    initFramebuffers(): void {
        this.initFramebuffer();

        this.textureColorTarget = this.app.createTexture2D(this.app.width, this.app.height, {
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
        });
        this.textureFramebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.textureColorTarget);

        // Interact
        this.interactColorTarget = this.app.createTexture2D(this.app.width, this.app.height, {
            internalFormat: PicoGL.RGBA32F,
            type: PicoGL.FLOAT,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
        });
        this.interactFramebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.interactColorTarget);
    }

    initFramebuffer(): void {
        this.framebuffer?.delete();
        this.colorTarget?.delete();
        this.interactTarget?.delete();
        this.depthTarget?.delete();

        let samples = 0;
        if (this.msaaEnabled) {
            samples = this.gl.getParameter(PicoGL.MAX_SAMPLES);
        }

        this.colorTarget = this.app.createRenderbuffer(
            this.app.width,
            this.app.height,
            PicoGL.RGBA8,
            samples,
        );
        this.interactTarget = this.app.createRenderbuffer(
            this.app.width,
            this.app.height,
            PicoGL.RGBA32F,
            samples,
        );
        this.depthTarget = this.app.createRenderbuffer(
            this.app.width,
            this.app.height,
            PicoGL.DEPTH_COMPONENT24,
            samples,
        );
        this.framebuffer = this.app
            .createFramebuffer()
            .colorTarget(0, this.colorTarget)
            .colorTarget(1, this.interactTarget)
            .depthTarget(this.depthTarget);

        this.needsFramebufferUpdate = false;
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

    override getControls() {
        return {
            ...super.getControls(),
            Debug: folder(
                {
                    "Texture Debug": {
                        value: this.debugTextureMode,
                        options: {
                            Off: 0,
                            "Missing Magenta": 1,
                            "Raw Texture": 2,
                        },
                        onChange: (v: number) => {
                            this.debugTextureMode = v;
                        },
                    },
                    "Log Texture Stats": button(() => this.logTextureDebugStats()),
                },
                { collapsed: true },
            ),
        };
    }

    initTextures(): void {
        const textureLoader = this.session.loaders.textureLoader;

        const allTextureIds = textureLoader.getTextureIds();

        this.textureIds = allTextureIds
            .filter((id) => textureLoader.isSd(id))
            .slice(0, MAX_TEXTURES - 1);

        this.textureIdToIndex.clear();
        for (let i = 0; i < this.textureIds.length; i++) {
            this.textureIdToIndex.set(this.textureIds[i], i + 1);
        }

        this.initTextureSlotLut();
        this.initTextureArray();
        this.initMaterialsTexture();

        console.log("init textures", this.textureIds, allTextureIds.length);
    }

    initTextureSlotLut(): void {
        if (this.textureSlotLut) {
            this.textureSlotLut.delete();
            this.textureSlotLut = undefined;
        }

        const textureCount = this.textureIds.length + 1;
        this.textureSlotLutData = new Uint16Array(textureCount);

        this.textureSlotLut = this.app.createTexture2D(this.textureSlotLutData, textureCount, 1, {
            internalFormat: PicoGL.R16UI,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
        });
    }

    initTextureArray() {
        const textureLoader = this.session.loaders.textureLoader;

        if (this.textureArray) {
            this.textureArray.delete();
            this.textureArray = undefined;
        }
        this.loadedTextureIds.clear();
        this.textureIdToSlot.clear();
        this.freeTextureSlots.length = 0;
        this.textureLastUsedFrame.clear();
        this.texturePixelCache.clear();

        console.time("load textures");

        const pixelCount = TEXTURE_SIZE * TEXTURE_SIZE;

        const maxArrayLayers = this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
        this.textureSlotCount = Math.max(2, Math.min(maxArrayLayers, MAX_TEXTURE_SLOTS));
        const pixels = new Int32Array(this.textureSlotCount * pixelCount);

        // White texture
        pixels.fill(0xffffffff, 0, pixelCount);

        const cacheInfo = this.session.cache.info;
        console.log(
            `init texture slots: slots=${this.textureSlotCount} maxLayers=${maxArrayLayers} textureIds=${this.textureIds.length}`,
        );

        if (this.textureIds.length + 1 > this.textureSlotCount) {
            console.warn(
                `Texture array slots capped: textures=${this.textureIds.length} slots=${
                    this.textureSlotCount - 1
                } maxLayers=${maxArrayLayers}. Some textures may appear missing.`,
            );
        }

        let maxPreloadTextures = Math.min(this.textureIds.length, this.textureSlotCount - 1);
        // we should check if the texture loader is procedural instead
        if (cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 508) {
            maxPreloadTextures = 64;
        }

        maxPreloadTextures = Math.min(maxPreloadTextures, this.textureSlotCount - 1);

        for (let i = 0; i < maxPreloadTextures; i++) {
            const slot = i + 1;
            const textureId = this.textureIds[i];
            const texturePixels = textureLoader.tryGetPixelsArgb(
                textureId,
                TEXTURE_SIZE,
                true,
                1.0,
            );
            if (texturePixels) {
                pixels.set(texturePixels, slot * pixelCount);
            } else {
                console.error("Failed loading texture", textureId);
            }
            this.textureIdToSlot.set(textureId, slot);
            if (texturePixels) {
                this.cacheTexturePixels(textureId, texturePixels);
            }
            this.touchTexture(textureId);

            const textureIndex = this.textureIdToIndex.get(textureId);
            if (textureIndex !== undefined && this.textureSlotLutData) {
                this.textureSlotLutData[textureIndex] = slot;
            }
        }

        for (let slot = maxPreloadTextures + 1; slot < this.textureSlotCount; slot++) {
            this.freeTextureSlots.push(slot);
        }

        this.textureArray = createTextureArray(
            this.app,
            new Uint8Array(pixels.buffer),
            TEXTURE_SIZE,
            TEXTURE_SIZE,
            this.textureSlotCount,
            {
                wrapS: PicoGL.REPEAT,
                wrapT: PicoGL.REPEAT,
            },
        );

        this.updateTextureFiltering();

        if (this.textureSlotLut && this.textureSlotLutData) {
            this.textureSlotLut.data(this.textureSlotLutData);
        }
        const texErr = this.gl.getError();
        if (texErr !== this.gl.NO_ERROR) {
            console.error("Texture array init GL error", texErr);
        }
        console.timeEnd("load textures");
    }

    private cacheTexturePixels(textureId: number, pixels: Int32Array): void {
        // LRU update
        if (this.texturePixelCache.has(textureId)) {
            this.texturePixelCache.delete(textureId);
        }
        this.texturePixelCache.set(textureId, pixels);
        this.loadedTextureIds.add(textureId);

        while (this.texturePixelCache.size > MAX_TEXTURE_PIXEL_CACHE) {
            const oldest = this.texturePixelCache.keys().next().value as number | undefined;
            if (oldest === undefined) {
                break;
            }
            if (this.textureIdToSlot.has(oldest)) {
                const p = this.texturePixelCache.get(oldest);
                this.texturePixelCache.delete(oldest);
                if (p) {
                    this.texturePixelCache.set(oldest, p);
                }
                continue;
            }
            this.texturePixelCache.delete(oldest);
            this.loadedTextureIds.delete(oldest);
        }
    }

    private touchTexture(textureId: number): void {
        if (textureId === -1) {
            return;
        }
        this.textureLastUsedFrame.set(textureId, this.stats.frameCount);
    }

    private evictTextureSlot(protectedTextureIds?: Set<number>): number | undefined {
        let candidateTextureId: number | undefined;
        let candidateLastUsed = Number.POSITIVE_INFINITY;

        for (const [textureId, slot] of this.textureIdToSlot) {
            if (slot === 0) {
                continue;
            }
            if (protectedTextureIds?.has(textureId)) {
                continue;
            }
            const lastUsed = this.textureLastUsedFrame.get(textureId) ?? -1;
            if (lastUsed < candidateLastUsed) {
                candidateLastUsed = lastUsed;
                candidateTextureId = textureId;
            }
        }

        if (candidateTextureId === undefined) {
            // All resident textures are protected (e.g. everything visible). Do not evict, otherwise we'd
            // thrash textures even with a static camera due to oversubscription.
            return undefined;
        }

        const slot = this.textureIdToSlot.get(candidateTextureId);
        if (slot === undefined) {
            throw new Error("Texture slot bookkeeping corrupted");
        }

        this.textureIdToSlot.delete(candidateTextureId);
        this.textureLastUsedFrame.delete(candidateTextureId);

        const textureIndex = this.textureIdToIndex.get(candidateTextureId);
        if (textureIndex !== undefined && this.textureSlotLutData) {
            this.textureSlotLutData[textureIndex] = 0;
        }

        return slot;
    }

    private ensureTextureInSlot(
        textureId: number,
        pixels: Int32Array | undefined,
        protectedTextureIds?: Set<number>,
    ): { slot: number; lutDirty: boolean; updated: boolean; status: EnsureTextureStatus } {
        const existingSlot = this.textureIdToSlot.get(textureId);
        if (existingSlot !== undefined) {
            this.touchTexture(textureId);
            return {
                slot: existingSlot,
                lutDirty: false,
                updated: false,
                status: EnsureTextureStatus.Ok,
            };
        }

        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }

        const textureIndex = this.textureIdToIndex.get(textureId);
        if (textureIndex === undefined) {
            return {
                slot: 0,
                lutDirty: false,
                updated: false,
                status: EnsureTextureStatus.UnknownTexture,
            };
        }

        let slot = this.freeTextureSlots.pop();
        if (slot === undefined) {
            slot = this.evictTextureSlot(protectedTextureIds);
            if (slot === undefined) {
                // Oversubscribed: keep output stable (missing texture) instead of cycling.
                return {
                    slot: 0,
                    lutDirty: false,
                    updated: false,
                    status: EnsureTextureStatus.Oversubscribed,
                };
            }
        }

        if (!pixels) {
            pixels = this.texturePixelCache.get(textureId);
        }

        if (!pixels) {
            const texturePixels = this.session.loaders.textureLoader.tryGetPixelsArgb(
                textureId,
                TEXTURE_SIZE,
                true,
                1.0,
            );
            if (!texturePixels) {
                console.error("Failed loading texture", textureId);
                this.freeTextureSlots.push(slot);
                return {
                    slot: 0,
                    lutDirty: false,
                    updated: false,
                    status: EnsureTextureStatus.DecodeFailed,
                };
            }
            pixels = texturePixels;
        }

        this.textureArray.bind(0);
        this.gl.texSubImage3D(
            PicoGL.TEXTURE_2D_ARRAY,
            0,
            0,
            0,
            slot,
            TEXTURE_SIZE,
            TEXTURE_SIZE,
            1,
            PicoGL.RGBA,
            PicoGL.UNSIGNED_BYTE,
            new Uint8Array(pixels.buffer),
        );

        this.textureIdToSlot.set(textureId, slot);
        this.cacheTexturePixels(textureId, pixels);
        this.touchTexture(textureId);

        let lutDirty = false;
        if (this.textureSlotLutData) {
            this.textureSlotLutData[textureIndex] = slot;
            lutDirty = true;
        }

        return { slot, lutDirty, updated: true, status: EnsureTextureStatus.Ok };
    }

    private updateVisibleTextureResidency(): void {
        this.visibleTextureIds.clear();

        for (let i = 0; i < this.visibleMapCount; i++) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId);
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }

            const used = map.usedTextureIds;
            if (!used) {
                continue;
            }

            for (let j = 0; j < used.length; j++) {
                const textureId = used[j];
                this.visibleTextureIds.add(textureId);
                this.touchTexture(textureId);
            }
        }

        if (!this.textureArray || !this.textureSlotLut || !this.textureSlotLutData) {
            return;
        }

        let updatedCount = 0;
        let lutDirty = false;
        let missingOversubscribed = 0;
        let missingUnknown = 0;
        let missingDecode = 0;

        for (const textureId of this.visibleTextureIds) {
            if (updatedCount >= MAX_TEXTURE_UPLOADS_PER_FRAME) {
                break;
            }
            if (this.textureIdToSlot.has(textureId)) {
                continue;
            }
            const result = this.ensureTextureInSlot(textureId, undefined, this.visibleTextureIds);
            lutDirty ||= result.lutDirty;
            updatedCount += result.updated ? 1 : 0;
            if (result.status === EnsureTextureStatus.Oversubscribed) {
                missingOversubscribed++;
            } else if (result.status === EnsureTextureStatus.UnknownTexture) {
                missingUnknown++;
            } else if (result.status === EnsureTextureStatus.DecodeFailed) {
                missingDecode++;
            }
        }

        if (lutDirty) {
            this.textureSlotLut.data(this.textureSlotLutData);
        }
        if (updatedCount > 0) {
            // `generateMipmap` operates on the texture bound to the currently active texture unit.
            // Ensure our texture array is bound before generating mipmaps.
            this.textureArray.bind(0);
            this.gl.generateMipmap(PicoGL.TEXTURE_2D_ARRAY);
        }

        if (this.debugTextureMode !== 0) {
            const frame = this.stats.frameCount;
            if (frame - this.debugLastResidencyLogFrame >= 60) {
                this.debugLastResidencyLogFrame = frame;
                console.log(
                    `texture residency: visible=${this.visibleTextureIds.size} slots=${
                        this.textureSlotCount - 1
                    } resident=${this.textureIdToSlot.size} free=${
                        this.freeTextureSlots.length
                    } updated=${updatedCount} missing(oversub~)=${missingOversubscribed} missing(unknown~)=${missingUnknown} missing(decode~)=${missingDecode}`,
                );
            }
        }
    }

    updateTextureFiltering(): void {
        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }

        this.textureArray.bind(0);

        if (this.textureFilterMode === TextureFilterMode.DISABLED) {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.NEAREST,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.NEAREST,
            );
        } else if (this.textureFilterMode === TextureFilterMode.BILINEAR) {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_NEAREST,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.LINEAR,
            );
        } else {
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_LINEAR,
            );
            this.gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MAG_FILTER,
                PicoGL.LINEAR,
            );
        }

        const maxAnisotropy = Math.min(
            getMaxAnisotropy(this.textureFilterMode),
            PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY,
        );

        this.gl.texParameteri(
            PicoGL.TEXTURE_2D_ARRAY,
            PicoGL.TEXTURE_MAX_ANISOTROPY_EXT,
            maxAnisotropy,
        );
    }

    updateTextureArray(textures: Map<number, Int32Array>): void {
        if (!this.textureArray) {
            throw new Error("Texture array is not initialized");
        }
        if (!this.textureSlotLut || !this.textureSlotLutData) {
            throw new Error("Texture slot LUT is not initialized");
        }

        let updatedCount = 0;
        let lutDirty = false;
        for (const [id, pixels] of textures) {
            this.cacheTexturePixels(id, pixels);
            if (this.textureIdToSlot.has(id)) {
                continue;
            }
            const result = this.ensureTextureInSlot(id, pixels, this.visibleTextureIds);
            lutDirty ||= result.lutDirty;
            updatedCount += result.updated ? 1 : 0;
        }
        if (lutDirty) {
            this.textureSlotLut.data(this.textureSlotLutData);
        }
        if (updatedCount > 0) {
            // `generateMipmap` operates on the texture bound to the currently active texture unit.
            // Ensure our texture array is bound before generating mipmaps.
            this.textureArray.bind(0);
            this.gl.generateMipmap(PicoGL.TEXTURE_2D_ARRAY);
        }
    }

    initMaterialsTexture(): void {
        const textureLoader = this.session.loaders.textureLoader;

        if (this.textureMaterials) {
            this.textureMaterials.delete();
            this.textureMaterials = undefined;
        }

        const textureCount = this.textureIds.length + 1;

        const data = new Int8Array(textureCount * 4);
        for (let i = 0; i < this.textureIds.length; i++) {
            const id = this.textureIds[i];
            const material = textureLoader.tryGetMaterial(id);
            if (!material) {
                console.error("Failed loading texture material", id);
                continue;
            }

            const index = (i + 1) * 4;
            data[index] = material.animU;
            data[index + 1] = material.animV;
            data[index + 2] = material.alphaCutOff * 255;
        }

        this.textureMaterials = this.app.createTexture2D(data, textureCount, 1, {
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            internalFormat: PicoGL.RGBA8I,
        });
    }

    override async loadMapData(mapX: number, mapY: number): Promise<SdMapData | undefined> {
        const mapData = await this.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(this.dataLoader, {
            mapX,
            mapY,
            maxLevel: this.maxLevel,
            loadObjs: this.loadObjs,
            loadNpcs: this.loadNpcs,
            loadLocs: this.loadLocs,
            smoothTerrain: this.smoothTerrain,
            minimizeDrawCalls: !this.hasMultiDraw,
            loadedTextureIds: this.loadedTextureIds,
        });

        return mapData;
    }

    loadMap(mapData: SdMapData, time: number): void {
        const { mapX, mapY } = mapData;
        this.loadedMaps.set(
            getMapSquareId(mapX, mapY),
            WebGLMapSquare.load(
                this.session.loaders.seqTypeLoader,
                this.session.loaders.npcTypeLoader,
                this.session.loaders.basTypeLoader,
                this.app,
                this.mainProgram!,
                this.mainAlphaProgram!,
                this.npcProgram!,
                this.textureArray!,
                this.textureMaterials!,
                this.textureSlotLut!,
                this.sceneUniformBuffer!,
                mapData,
                time,
                this.stats.frameCount,
            ),
        );

        this.updateTextureArray(mapData.loadedTextures);
    }

    onResize(width: number, height: number): void {
        this.app.resize(width, height);
    }

    update(time: number, deltaTime: number) {}

    render(time: number, deltaTime: number, resized: boolean): void {
        this.npcRenderCount = 0;
        this.rendererStats.frameStart = performance.now();
        const timeSec = time / 1000;

        if (this.needsFramebufferUpdate) {
            this.initFramebuffer();
        }

        if (
            !this.mainProgram ||
            !this.mainAlphaProgram ||
            !this.npcProgram ||
            !this.sceneUniformBuffer ||
            !this.framebuffer ||
            !this.textureFramebuffer ||
            !this.frameDrawCall ||
            !this.interactFramebuffer ||
            !this.textureArray ||
            !this.textureMaterials
        ) {
            return;
        }

        if (resized) {
            this.framebuffer.resize();
            this.textureFramebuffer.resize();
            this.interactFramebuffer.resize();

            this.resolutionUni[0] = this.app.width;
            this.resolutionUni[1] = this.app.height;
        }

        this.cameraPosUni[0] = this.camera.getPosX();
        this.cameraPosUni[1] = this.camera.getPosZ();

        this.sceneUniformBuffer
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

        const currInteractions =
            this.interactions[this.stats.frameCount % this.interactions.length];

        const interactionsStart = performance.now();
        if (!this.inputManager.isPointerLock()) {
            this.prepareInteractions(currInteractions);
        } else if (this.hoveredMapIds.size > 0) {
            this.hoveredMapIds.clear();
        }
        this.rendererStats.interactionsTime = performance.now() - interactionsStart;

        this.updateVisibleTextureResidency();

        if (this.cullBackFace) {
            this.app.enable(PicoGL.CULL_FACE);
        } else {
            this.app.disable(PicoGL.CULL_FACE);
        }

        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.depthMask(true);

        this.app.drawFramebuffer(this.framebuffer);

        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.clear();
        this.gl.clearBufferfv(PicoGL.COLOR, 0, this.skyColor);

        for (let i = 0; i < this.visibleMapCount; i++) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId)!;
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }

            this.addNpcRenderData(map);
        }

        const npcDataTextureIndex = this.updateNpcDataTexture();
        const npcDataTexture = this.npcDataTextureBuffer[npcDataTextureIndex];

        this.app.disable(PicoGL.BLEND);
        const opaquePassStart = performance.now();
        this.renderOpaquePass();
        this.rendererStats.opaquePassTime = performance.now() - opaquePassStart;
        const opaqueNpcPassStart = performance.now();
        this.renderOpaqueNpcPass(npcDataTextureIndex, npcDataTexture);
        this.rendererStats.opaqueNpcPassTime = performance.now() - opaqueNpcPassStart;

        this.app.enable(PicoGL.BLEND);
        const transparentPassStart = performance.now();
        this.renderTransparentPass();
        this.rendererStats.transparentPassTime = performance.now() - transparentPassStart;
        const transparentNpcPassStart = performance.now();
        this.renderTransparentNpcPass(npcDataTextureIndex, npcDataTexture);
        this.rendererStats.transparentNpcPassTime = performance.now() - transparentNpcPassStart;

        // Can't sample from renderbuffer so blit to a texture for sampling.
        this.app.readFramebuffer(this.framebuffer);

        this.app.drawFramebuffer(this.textureFramebuffer);
        this.gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
        this.app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);

        if (!this.inputManager.isPointerLock()) {
            const mouseX = this.inputManager.mouseX;
            const mouseY = this.inputManager.mouseY;
            if (mouseX !== -1 && mouseY !== -1) {
                if (this.msaaEnabled) {
                    // TODO: reading from the multisampled framebuffer is not accurate
                    this.app.drawFramebuffer(this.interactFramebuffer);
                    this.gl.readBuffer(PicoGL.COLOR_ATTACHMENT1);
                    this.app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);

                    this.app.readFramebuffer(this.interactFramebuffer);
                    this.gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
                } else {
                    this.gl.readBuffer(PicoGL.COLOR_ATTACHMENT1);
                }

                currInteractions.read(
                    this.gl,
                    (mouseX * pixelRatio) | 0,
                    (mouseY * pixelRatio) | 0,
                );
            }
        }

        this.app.disable(PicoGL.DEPTH_TEST);
        this.app.depthMask(false);

        this.app.disable(PicoGL.BLEND);

        this.app.clearMask(PicoGL.COLOR_BUFFER_BIT | PicoGL.DEPTH_BUFFER_BIT);
        this.app.clearColor(0.0, 0.0, 0.0, 1.0);
        this.app.defaultDrawFramebuffer().clear();

        if (this.frameFxaaDrawCall && this.fxaaEnabled) {
            this.frameFxaaDrawCall.uniform("u_resolution", this.resolutionUni);
            this.frameFxaaDrawCall.texture("u_frame", this.textureFramebuffer.colorAttachments[0]);
            this.frameFxaaDrawCall.draw();
        } else {
            this.frameDrawCall.texture("u_frame", this.textureFramebuffer.colorAttachments[0]);
            this.frameDrawCall.draw();
        }

        this.loadPending(timeSec);
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

    addNpcRenderData(renderable: WebGLRenderable) {
        const npcs = renderable.npcs;

        if (npcs.length === 0) {
            return;
        }

        const frameCount = this.stats.frameCount;

        renderable.npcDataTextureOffsets[frameCount % renderable.npcDataTextureOffsets.length] =
            this.npcRenderCount;

        const newCount = this.npcRenderCount + npcs.length;

        if (this.npcRenderData.length / 4 < newCount) {
            const newData = new Uint16Array(Math.ceil((newCount * 2) / 16) * 16 * 4);
            newData.set(this.npcRenderData);
            this.npcRenderData = newData;
        }

        for (const npc of npcs) {
            let offset = this.npcRenderCount * 4;

            const tileX = npc.x >> 7;
            const tileY = npc.y >> 7;

            let renderPlane = npc.level;
            if (
                renderPlane < 3 &&
                (renderable.getTileRenderFlag(1, tileX, tileY) & TileRenderFlag.Bridge) !== 0
            ) {
                renderPlane++;
            }

            this.npcRenderData[offset++] = npc.x;
            this.npcRenderData[offset++] = npc.y;
            this.npcRenderData[offset++] = (npc.rotation << 2) | renderPlane;
            this.npcRenderData[offset++] = npc.npcType.id;

            this.npcRenderCount++;
        }
    }

    updateNpcDataTexture() {
        const frameCount = this.stats.frameCount;

        const newNpcDataTextureIndex = frameCount % this.npcDataTextureBuffer.length;
        const npcDataTextureIndex = (frameCount + 1) % this.npcDataTextureBuffer.length;
        this.npcDataTextureBuffer[newNpcDataTextureIndex]?.delete();
        this.npcDataTextureBuffer[newNpcDataTextureIndex] = this.app.createTexture2D(
            this.npcRenderData,
            16,
            Math.max(Math.ceil(this.npcRenderCount / 16), 1),
            {
                internalFormat: PicoGL.RGBA16UI,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
            },
        );

        return npcDataTextureIndex;
    }

    draw(drawCall: DrawCall, drawRanges: number[][]) {
        if (this.hasMultiDraw) {
            drawCall.draw();
        } else {
            for (let i = 0; i < drawRanges.length; i++) {
                drawCall.uniform("u_drawId", i);
                drawCall.drawRanges(drawRanges[i]);
                drawCall.draw();
            }
        }
    }

    renderOpaquePass(): void {
        const cameraMapX = this.camera.getMapX();
        const cameraMapY = this.camera.getMapY();

        for (let i = 0; i < this.visibleMapCount; i++) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId)!;
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }

            const dist = map.getMapDistance(cameraMapX, cameraMapY);

            const isInteract = this.hoveredMapIds.has(map.id);
            const isLod = dist >= this.lodDistance;

            const { drawCall, drawRanges } = map.getDrawCall(false, isInteract, isLod);

            for (const loc of map.locsAnimated) {
                const frameId = loc.frame;
                const frame = loc.anim.frames[frameId | 0];

                const index = loc.getDrawRangeIndex(false, isInteract, isLod);
                if (index !== -1) {
                    drawCall.offsets[index] = frame[0];
                    (drawCall as any).numElements[index] = frame[1];

                    drawRanges[index] = frame;
                }
            }

            this.draw(drawCall, drawRanges);
        }
    }

    renderOpaqueNpcPass(npcDataTextureIndex: number, npcDataTexture: Texture | undefined): void {
        if (!npcDataTexture || !this.loadNpcs) {
            return;
        }

        for (let i = 0; i < this.visibleMapCount; i++) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId)!;
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }

            const npcs = map.npcs;

            if (npcs.length === 0) {
                continue;
            }

            const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex];
            if (dataOffset === -1) {
                continue;
            }

            const { drawCall, drawRanges } = map.drawCallNpc;

            drawCall.uniform("u_npcDataOffset", dataOffset);
            drawCall.texture("u_npcDataTexture", npcDataTexture);

            for (let i = 0; i < npcs.length; i++) {
                const npc = npcs[i];
                const anim = npc.getAnimationFrames();

                if (anim) {
                    const frameId = npc.movementFrame;
                    const frame = anim.frames[frameId];

                    (drawCall as any).offsets[i] = frame[0];
                    (drawCall as any).numElements[i] = frame[1];

                    drawRanges[i] = frame;
                }
            }

            this.draw(drawCall, drawRanges);
        }
    }

    renderTransparentPass(): void {
        const cameraMapX = this.camera.getMapX();
        const cameraMapY = this.camera.getMapY();

        for (let i = this.visibleMapCount - 1; i >= 0; i--) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId)!;
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }

            const dist = map.getMapDistance(cameraMapX, cameraMapY);

            const isInteract = this.hoveredMapIds.has(map.id);
            const isLod = dist >= this.lodDistance;

            const { drawCall, drawRanges } = map.getDrawCall(true, isInteract, isLod);

            for (const loc of map.locsAnimated) {
                if (loc.anim.framesAlpha) {
                    const frameId = loc.frame;
                    const frame = loc.anim.framesAlpha[frameId | 0];

                    const index = loc.getDrawRangeIndex(true, isInteract, isLod);
                    if (index !== -1) {
                        drawCall.offsets[index] = frame[0];
                        (drawCall as any).numElements[index] = frame[1];

                        drawRanges[index] = frame;
                    }
                }
            }

            this.draw(drawCall, drawRanges);
        }
    }

    renderTransparentNpcPass(
        npcDataTextureIndex: number,
        npcDataTexture: Texture | undefined,
    ): void {
        if (!npcDataTexture || !this.loadNpcs) {
            return;
        }

        for (let i = this.visibleMapCount - 1; i >= 0; i--) {
            const mapInfo = this.visibleMaps[i];
            const map = this.loadedMaps.get(mapInfo.mapId)!;
            if (!map || !map.canRender(this.stats.frameCount)) {
                continue;
            }

            const npcs = map.npcs;

            if (npcs.length === 0) {
                continue;
            }

            const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex];
            if (dataOffset === -1) {
                continue;
            }

            const { drawCall, drawRanges } = map.drawCallNpc;

            drawCall.uniform("u_npcDataOffset", dataOffset);
            drawCall.texture("u_npcDataTexture", npcDataTexture);

            for (let i = 0; i < npcs.length; i++) {
                const npc = npcs[i];
                const anim = npc.getAnimationFrames();

                const frameId = npc.movementFrame;
                let frame: DrawRange = NULL_DRAW_RANGE;
                if (anim && anim.framesAlpha) {
                    frame = anim.framesAlpha[frameId];
                }

                (drawCall as any).offsets[i] = frame[0];
                (drawCall as any).numElements[i] = frame[1];

                drawRanges[i] = frame;
            }

            this.draw(drawCall, drawRanges);
        }
    }

    checkInteractions(
        interactReady: boolean,
        interactBuffer: Float32Array,
        closestInteractIndices: Map<number, number[]>,
    ): void {}

    prepareInteractions(interactions: Interactions): void {
        const interactReady = interactions.check(
            this.gl,
            this.hoveredMapIds,
            this.closestInteractIndices,
        );
        if (interactReady) {
            this.interactBuffer = interactions.interactBuffer;
        }

        if (!this.interactBuffer) {
            return;
        }

        this.checkInteractions(interactReady, this.interactBuffer, this.closestInteractIndices);
    }

    async cleanUp(): Promise<void> {
        this.quadArray?.delete();
        this.quadArray = undefined;

        this.quadPositions?.delete();
        this.quadPositions = undefined;

        // Uniforms
        this.sceneUniformBuffer?.delete();
        this.sceneUniformBuffer = undefined;

        // Framebuffers
        this.framebuffer?.delete();
        this.framebuffer = undefined;

        this.colorTarget?.delete();
        this.colorTarget = undefined;

        this.interactTarget?.delete();
        this.interactTarget = undefined;

        this.depthTarget?.delete();
        this.depthTarget = undefined;

        this.textureFramebuffer?.delete();
        this.textureFramebuffer = undefined;

        this.textureColorTarget?.delete();
        this.textureColorTarget = undefined;

        this.interactFramebuffer?.delete();
        this.interactFramebuffer = undefined;

        this.interactColorTarget?.delete();
        this.interactColorTarget = undefined;

        // Textures
        this.textureArray?.delete();
        this.textureArray = undefined;

        this.textureMaterials?.delete();
        this.textureMaterials = undefined;

        this.textureSlotLut?.delete();
        this.textureSlotLut = undefined;

        for (const texture of this.npcDataTextureBuffer) {
            texture?.delete();
        }

        this.clearMaps();

        if (this.shadersPromise) {
            for (const shader of await this.shadersPromise) {
                shader.delete();
            }
            this.shadersPromise = undefined;
        }
        console.log("Renderer cleaned up");
    }
}
