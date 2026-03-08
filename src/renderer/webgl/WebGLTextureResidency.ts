import PicoGL, { App as PicoApp, Texture } from "picogl";

import type { TextureService } from "../../rs/loaders/Loaders";
import { TextureFilterMode, getMaxAnisotropy } from "../MapRenderer";
import { createTextureArray } from "./PicoTexture";
import { TEXTURE_ID_LUT_HEIGHT, TEXTURE_ID_LUT_WIDTH } from "./texture/TextureIdLut";
import { TextureResidencyPolicy } from "./texture/TextureResidencyPolicy";

const TEXTURE_SIZE = 128;
const MAX_TEXTURE_SLOTS = 256;

export class WebGLTextureResidency {
    textureArray?: Texture;
    textureSlotLut?: Texture;

    private app?: PicoApp;
    private gl?: WebGL2RenderingContext;
    private textureLoader?: TextureService;
    private debugLastResidencyLogFrame = 0;

    private readonly policy: TextureResidencyPolicy;

    constructor(private readonly loadedTextureIdsOut: Set<number>) {
        this.policy = new TextureResidencyPolicy(loadedTextureIdsOut);
    }

    getTextureIds(): ReadonlyArray<number> {
        return this.policy.getTextureIds();
    }

    init(
        app: PicoApp,
        gl: WebGL2RenderingContext,
        textureLoader: TextureService,
        maxPreloadTexturesHint: number | undefined,
        textureFilterMode: TextureFilterMode,
        frameCount: number,
    ): void {
        this.app = app;
        this.gl = gl;
        this.textureLoader = textureLoader;
        this.policy.frameCount = frameCount | 0;

        this.policy.setTextureIds(textureLoader.getTextureIds());

        this.initTextureSlotLut();
        this.initTextureArray(maxPreloadTexturesHint, textureFilterMode);
    }

    dispose(): void {
        this.textureArray?.delete();
        this.textureArray = undefined;

        this.textureSlotLut?.delete();
        this.textureSlotLut = undefined;

        this.policy.resetForNewTextureArray(0);
        this.policy.setTextureIds([]);

        this.app = undefined;
        this.gl = undefined;
        this.textureLoader = undefined;
    }

    logDebugStats(): void {
        console.log(
            `texture debug: slots=${this.policy.textureSlotCount - 1} visible=${
                this.policy.visibleTextureIds.size
            } resident=${this.policy.textureIdToSlot.size} free=${
                this.policy.freeTextureSlots.length
            }`,
        );

        const sampleIds: number[] = [];
        for (const id of this.policy.visibleTextureIds) {
            sampleIds.push(id);
            if (sampleIds.length >= 10) break;
        }

        const samplePixelStride = 97;
        const samplePixelCount = 512;
        for (const textureId of sampleIds) {
            const index = this.policy.getTextureIdPlus1(textureId) ?? -1;
            const slot = this.policy.textureIdToSlot.get(textureId) ?? 0;
            const pixels = this.policy.texturePixelCache.get(textureId);
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

    updateFiltering(textureFilterMode: TextureFilterMode): void {
        const gl = this.gl;
        if (!gl || !this.textureArray) {
            throw new Error("Texture residency is not initialized");
        }

        this.textureArray.bind(0);

        if (textureFilterMode === TextureFilterMode.DISABLED) {
            gl.texParameteri(PicoGL.TEXTURE_2D_ARRAY, PicoGL.TEXTURE_MIN_FILTER, PicoGL.NEAREST);
            gl.texParameteri(PicoGL.TEXTURE_2D_ARRAY, PicoGL.TEXTURE_MAG_FILTER, PicoGL.NEAREST);
        } else if (textureFilterMode === TextureFilterMode.BILINEAR) {
            gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_NEAREST,
            );
            gl.texParameteri(PicoGL.TEXTURE_2D_ARRAY, PicoGL.TEXTURE_MAG_FILTER, PicoGL.LINEAR);
        } else {
            gl.texParameteri(
                PicoGL.TEXTURE_2D_ARRAY,
                PicoGL.TEXTURE_MIN_FILTER,
                PicoGL.LINEAR_MIPMAP_LINEAR,
            );
            gl.texParameteri(PicoGL.TEXTURE_2D_ARRAY, PicoGL.TEXTURE_MAG_FILTER, PicoGL.LINEAR);
        }

        const maxAnisotropy = Math.min(
            getMaxAnisotropy(textureFilterMode),
            PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY,
        );
        gl.texParameteri(PicoGL.TEXTURE_2D_ARRAY, PicoGL.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
    }

    onLoadedTextures(textures: Map<number, Int32Array>, frameCount: number): void {
        this.policy.frameCount = frameCount | 0;
        if (!this.textureArray || !this.textureSlotLut || !this.policy.textureSlotLutData) {
            throw new Error("Texture residency is not initialized");
        }

        let updatedCount = 0;
        let lutDirty = false;
        for (const [id, pixels] of textures) {
            this.policy.cacheTexturePixels(id, pixels);
            if (this.policy.textureIdToSlot.has(id)) {
                continue;
            }
            const result = this.policy.ensureTextureInSlot(
                id,
                pixels,
                this.policy.visibleTextureIds,
                {
                    tryLoadPixels: (textureId) =>
                        this.textureLoader?.tryGetPixelsArgb(textureId, TEXTURE_SIZE, true, 1.0),
                    uploadToSlot: (textureId, slot, px) =>
                        this.uploadTextureToSlot(textureId, slot, px),
                },
            );
            lutDirty ||= result.lutDirty;
            updatedCount += result.updated ? 1 : 0;
        }

        if (lutDirty) {
            this.textureSlotLut.data(this.policy.textureSlotLutData);
        }
        if (updatedCount > 0) {
            this.textureArray.bind(0);
            this.gl!.generateMipmap(PicoGL.TEXTURE_2D_ARRAY);
        }
    }

    updateVisibleResidency(
        visibleUsedTextureIds: ReadonlyArray<Int32Array>,
        frameCount: number,
        debugLog: boolean,
    ): void {
        this.policy.updateVisibleTextureIds(visibleUsedTextureIds, frameCount | 0);

        if (
            !this.textureArray ||
            !this.textureSlotLut ||
            !this.policy.textureSlotLutData ||
            !this.gl
        ) {
            return;
        }

        const { updatedCount, lutDirty, missingOversubscribed, missingUnknown, missingDecode } =
            this.policy.ensureVisibleTextures({
                tryLoadPixels: (textureId) =>
                    this.textureLoader?.tryGetPixelsArgb(textureId, TEXTURE_SIZE, true, 1.0),
                uploadToSlot: (textureId, slot, px) =>
                    this.uploadTextureToSlot(textureId, slot, px),
            });

        if (lutDirty) {
            this.textureSlotLut.data(this.policy.textureSlotLutData);
        }
        if (updatedCount > 0) {
            this.textureArray.bind(0);
            this.gl.generateMipmap(PicoGL.TEXTURE_2D_ARRAY);
        }

        if (debugLog) {
            const frame = this.policy.frameCount | 0;
            if (frame - this.debugLastResidencyLogFrame >= 60) {
                this.debugLastResidencyLogFrame = frame;
                console.log(
                    `texture residency: visible=${this.policy.visibleTextureIds.size} slots=${
                        this.policy.textureSlotCount - 1
                    } resident=${this.policy.textureIdToSlot.size} free=${
                        this.policy.freeTextureSlots.length
                    } updated=${updatedCount} missing(oversub~)=${missingOversubscribed} missing(unknown~)=${missingUnknown} missing(decode~)=${missingDecode}`,
                );
            }
        }
    }

    private initTextureSlotLut(): void {
        if (!this.app) {
            throw new Error("Texture residency is not initialized");
        }

        this.textureSlotLut?.delete();
        this.textureSlotLut = undefined;

        const lutData = this.policy.initTextureSlotLutData();
        this.textureSlotLut = this.app.createTexture2D(
            lutData,
            TEXTURE_ID_LUT_WIDTH,
            TEXTURE_ID_LUT_HEIGHT,
            {
                internalFormat: PicoGL.R16UI,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
            },
        );
    }

    private initTextureArray(maxPreloadTexturesHint: number | undefined, filterMode: TextureFilterMode) {
        if (!this.app || !this.gl || !this.textureLoader) {
            throw new Error("Texture residency is not initialized");
        }
        const gl = this.gl;
        const textureLoader = this.textureLoader;

        this.textureArray?.delete();
        this.textureArray = undefined;

        console.time("load textures");

        const pixelCount = TEXTURE_SIZE * TEXTURE_SIZE;
        const maxArrayLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
        const slotCount = Math.max(2, Math.min(maxArrayLayers, MAX_TEXTURE_SLOTS));
        this.policy.resetForNewTextureArray(slotCount);

        const pixels = new Int32Array(slotCount * pixelCount);
        pixels.fill(0xffffffff, 0, pixelCount);

        console.log(
            `init texture slots: slots=${slotCount} maxLayers=${maxArrayLayers} textureIds=${
                this.policy.getTextureIds().length
            }`,
        );

        if (this.policy.getTextureIds().length + 1 > slotCount) {
            console.warn(
                `Texture array slots capped: textures=${this.policy.getTextureIds().length} slots=${
                    slotCount - 1
                } maxLayers=${maxArrayLayers}. Some textures may appear missing.`,
            );
        }

        const maxPreloadTextures = this.policy.computeMaxPreloadTextures(maxPreloadTexturesHint);
        const textureIds = this.policy.getTextureIds();
        for (let i = 0; i < maxPreloadTextures; i++) {
            const slot = i + 1;
            const textureId = textureIds[i];
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
            this.policy.onPreloadedTexture(textureId, slot, texturePixels);
        }
        this.policy.initFreeSlotsAfterPreload(maxPreloadTextures);

        this.textureArray = createTextureArray(
            this.app,
            new Uint8Array(pixels.buffer),
            TEXTURE_SIZE,
            TEXTURE_SIZE,
            slotCount,
            { wrapS: PicoGL.REPEAT, wrapT: PicoGL.REPEAT },
        );

        this.updateFiltering(filterMode);

        if (this.textureSlotLut && this.policy.textureSlotLutData) {
            this.textureSlotLut.data(this.policy.textureSlotLutData);
        }
        const texErr = gl.getError();
        if (texErr !== gl.NO_ERROR) {
            console.error("Texture array init GL error", texErr);
        }
        console.timeEnd("load textures");
    }

    private uploadTextureToSlot(textureId: number, slot: number, pixels: Int32Array): void {
        if (!this.textureArray || !this.gl) {
            throw new Error("Texture residency is not initialized");
        }
        const expectedPixels = TEXTURE_SIZE * TEXTURE_SIZE;
        if (pixels.length !== expectedPixels) {
            throw new Error(
                `Invalid texture upload for texture ${textureId}: expected ${expectedPixels} pixels, got ${pixels.length}`,
            );
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
    }
}
