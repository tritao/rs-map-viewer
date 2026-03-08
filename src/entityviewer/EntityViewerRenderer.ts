import type { StandaloneRenderableData } from "../runtime/build/StandaloneRenderableDataBuilder";
import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import type { CacheSession } from "../rs/loaders/CacheSession";
import {
    WebGLEntityRenderer,
    type EntityViewerDebugMode,
    type SetEntityRenderDataOptions,
} from "../renderer/webgl/WebGLEntityRenderer";

export class EntityViewerRenderer extends RendererMainLoop {
    declare renderer: WebGLEntityRenderer;
    readonly session: CacheSession;
    renderTargetKey: string | undefined;

    constructor(session: CacheSession) {
        super();
        this.session = session;
        this.renderer = new WebGLEntityRenderer(session);
    }

    setRenderData(
        renderData: StandaloneRenderableData | undefined,
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

    setDebugMode(debugMode: EntityViewerDebugMode): void {
        this.renderer.setDebugMode(debugMode);
    }
}
