import type { StandaloneRenderData } from "../runtime/build/StandaloneRenderDataBuilder";
import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { GameType } from "../rs/cache/CacheInfo";
import type { CacheSession } from "../rs/loaders/CacheSession";
import { WebGLEntityRenderer, type SetEntityRenderDataOptions } from "../renderer/webgl/WebGLEntityRenderer";

export class EntityViewerRenderer extends RendererMainLoop {
    declare renderer: WebGLEntityRenderer;
    readonly session: CacheSession;
    renderTargetKey: string | undefined;

    constructor(session: CacheSession) {
        super();
        this.session = session;
        this.renderer = new WebGLEntityRenderer({
            textureLoader: session.loaders.textureLoader,
            isNewTextureAnim:
                session.cache.info.game === GameType.Runescape &&
                session.cache.info.revision >= 681,
            maxTexturePreloadCount:
                session.cache.info.game === GameType.Runescape &&
                session.cache.info.revision >= 508
                    ? 64
                    : undefined,
        });
    }

    setRenderData(
        renderData: StandaloneRenderData | undefined,
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
