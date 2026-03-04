import PicoGL, { type App as PicoApp, type Texture } from "picogl";

import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { TextureService } from "../../rs/loaders/Loaders";
import type { TextureFilterMode } from "../MapRenderer";
import { WebGLTextureResidency } from "./WebGLTextureResidency";
import { buildTextureMaterialsTable } from "./texture/TextureMaterialsTable";

export class WebGLTextureSystem {
    readonly residency: WebGLTextureResidency;
    private materialsTexture?: Texture;

    constructor(loadedTextureIdsOut: Set<number>) {
        this.residency = new WebGLTextureResidency(loadedTextureIdsOut);
    }

    init(
        app: PicoApp,
        gl: WebGL2RenderingContext,
        textureLoader: TextureService,
        cacheInfo: CacheInfo,
        textureFilterMode: TextureFilterMode,
        frameCount: number,
    ): void {
        this.residency.init(app, gl, textureLoader, cacheInfo, textureFilterMode, frameCount);
        this.rebuildMaterialsTexture(app, textureLoader);
    }

    dispose(): void {
        this.residency.dispose();
        this.materialsTexture?.delete();
        this.materialsTexture = undefined;
    }

    logDebugStats(): void {
        this.residency.logDebugStats();
    }

    updateFiltering(textureFilterMode: TextureFilterMode): void {
        this.residency.updateFiltering(textureFilterMode);
    }

    updateVisibleResidency(
        visibleUsedTextureIds: ReadonlyArray<Int32Array>,
        frameCount: number,
        debugLog: boolean,
    ): void {
        this.residency.updateVisibleResidency(visibleUsedTextureIds, frameCount, debugLog);
    }

    onLoadedTextures(textures: Map<number, Int32Array>, frameCount: number): void {
        this.residency.onLoadedTextures(textures, frameCount);
    }

    getTextureIds(): ReadonlyArray<number> {
        return this.residency.getTextureIds();
    }

    getTextureArray(): Texture | undefined {
        return this.residency.textureArray;
    }

    getTextureSlotLut(): Texture | undefined {
        return this.residency.textureSlotLut;
    }

    getMaterialsTexture(): Texture | undefined {
        return this.materialsTexture;
    }

    private rebuildMaterialsTexture(app: PicoApp, textureLoader: TextureService): void {
        if (this.materialsTexture) {
            this.materialsTexture.delete();
            this.materialsTexture = undefined;
        }

        const { data, width, height } = buildTextureMaterialsTable(
            this.getTextureIds(),
            textureLoader,
        );

        this.materialsTexture = app.createTexture2D(data, width, height, {
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            internalFormat: PicoGL.RGBA8I,
        });
    }
}
