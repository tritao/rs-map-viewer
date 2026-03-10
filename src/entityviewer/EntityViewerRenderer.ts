import type { ModelRenderData } from "../maprender/build/ModelRenderDataBuilder";
import { RendererMainLoop } from "../renderer/RendererMainLoop";
import {
    type SetEntityRenderDataOptions,
    WebGLEntityRenderer,
} from "../renderer/webgl/WebGLEntityRenderer";
import { createRendererTexturePolicy } from "../rs/cache/CacheInfo";
import type { CacheSession } from "../rs/loaders/CacheSession";

export class EntityViewerRenderer extends RendererMainLoop {
    declare renderer: WebGLEntityRenderer;
    readonly session: CacheSession;
    renderTargetKey: string | undefined;

    constructor(session: CacheSession) {
        super();
        this.session = session;
        const texturePolicy = createRendererTexturePolicy(session.cache.info);
        this.renderer = new WebGLEntityRenderer({
            textureLoader: session.loaders.textureLoader,
            isNewTextureAnim: texturePolicy.isNewTextureAnim,
            maxTexturePreloadCount: texturePolicy.maxTexturePreloadCount,
        });
    }

    setRenderData(
        renderData: ModelRenderData | undefined,
        options?: SetEntityRenderDataOptions,
    ): void {
        this.renderer.setRenderData(renderData, options);
    }

    setOrbitDistance(distance: number): void {
        this.renderer.setOrbitDistance(distance);
    }

    setPitch(pitch: number): void {
        this.renderer.setPitch(pitch);
    }

    setYaw(yaw: number): void {
        this.renderer.setYaw(yaw);
    }

    getOrbitDistance(): number {
        return this.renderer.getOrbitDistance();
    }

    getPitch(): number {
        return this.renderer.getPitch();
    }

    getYaw(): number {
        return this.renderer.getYaw();
    }
}
