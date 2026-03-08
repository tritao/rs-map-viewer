import { mat4, vec2, vec3 } from "gl-matrix";
import { App as PicoApp, PicoGL, Program, UniformBuffer } from "picogl";

import { GameType } from "../../rs/cache/CacheInfo";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import { RS_TO_RADIANS } from "../../rs/MathConstants";
import type { DrawRange } from "../../runtime/contracts/DrawRange";
import type { StandaloneRenderData } from "../../runtime/build/StandaloneRenderDataBuilder";
import { createWebGLDevice } from "./WebGLDevice";
import { createSceneDrawCall } from "./WebGLDrawCallUtil";
import { WebGLSceneResources } from "./WebGLSceneResources";
import { WebGLTextureSystem } from "./WebGLTextureSystem";
import { createEntityProgram } from "./shaders/Shaders";
import type { Renderer } from "../Renderer";
import { FrameStats, RendererStats } from "../Renderer";

const DRAW_RANGE_STRIDE = 3;
export type SetEntityRenderDataOptions = Readonly<{
    resetCamera?: boolean;
}>;

export class WebGLEntityRenderer implements Renderer {
    stats = new FrameStats();
    rendererStats = new RendererStats();

    private readonly textures = new WebGLTextureSystem(new Set<number>());
    private readonly cameraPosUni = new Float32Array(2);
    private readonly mapPosUni = vec2.fromValues(0, 0);
    private readonly renderDistanceUni = new Float32Array([1024]);
    private readonly fogDepthUni = new Float32Array([64]);
    private readonly currentTimeUni = new Float32Array(1);
    private readonly brightnessUni = new Float32Array([1]);
    private readonly colorBandingUni = new Float32Array([255]);
    private readonly isNewTextureAnimUni = new Float32Array(1);
    private readonly debugTextureModeUni = new Float32Array(1);
    private readonly skyColor = new Float32Array([0.42, 0.42, 0.46, 1]);
    private readonly drawRangeScratch: DrawRange = [0, 0, 1];
    private readonly emptyUsedTextureIds = new Int32Array(0);
    private readonly visibleUsedTextureIds: Int32Array[] = [this.emptyUsedTextureIds];
    private readonly projectionMatrix = mat4.create();
    private readonly viewMatrix = mat4.create();
    private readonly viewProjMatrix = mat4.create();
    private readonly eye = vec3.create();
    private readonly target = vec3.create();
    private readonly up = vec3.fromValues(0, 1, 0);

    private renderable: WebGLSceneResources | undefined;
    private renderData: StandaloneRenderData | undefined;
    private fitRadius = 256;
    private orbitDistance = 8;
    private pitch = -180;
    private yaw = 1024;

    private sceneUniformBuffer?: UniformBuffer;
    private mainProgram?: Program;
    private mainAlphaProgram?: Program;

    private app!: PicoApp;
    private gl!: WebGL2RenderingContext;
    private isNewTextureAnim = false;

    constructor(private readonly session: CacheSession) {}

    setRenderData(
        renderData: StandaloneRenderData | undefined,
        options: SetEntityRenderDataOptions = {},
    ): void {
        this.renderData = renderData;
        this.fitRadius = renderData?.fitRadius ?? 256;
        if (options.resetCamera ?? true) {
            this.resetCameraToFit();
        }
        if (this.app) {
            this.reloadRenderable();
        }
    }

    initCache(): void {}

    async init(canvas: HTMLCanvasElement): Promise<void> {
        const device = createWebGLDevice(canvas);
        this.app = device.app;
        this.gl = device.gl;

        const programs = await this.app.createPrograms(
            createEntityProgram(false, false),
            createEntityProgram(false, true),
        );
        [this.mainProgram, this.mainAlphaProgram] = programs;

        this.sceneUniformBuffer = this.app.createUniformBuffer([
            PicoGL.FLOAT_MAT4,
            PicoGL.FLOAT_MAT4,
            PicoGL.FLOAT_MAT4,
            PicoGL.FLOAT_VEC4,
            PicoGL.FLOAT_VEC2,
            PicoGL.FLOAT,
            PicoGL.FLOAT,
            PicoGL.FLOAT,
            PicoGL.FLOAT,
            PicoGL.FLOAT,
            PicoGL.FLOAT,
            PicoGL.FLOAT,
        ]);

        this.isNewTextureAnim =
            this.session.cache.info.game === GameType.Runescape &&
            this.session.cache.info.revision >= 681;
        this.textures.init(
            this.app,
            this.gl,
            this.session.getTextureLoader(),
            this.session.cache.info,
            PicoGL.LINEAR_MIPMAP_LINEAR as unknown as never,
            this.stats.frameCount,
        );
        this.reloadRenderable();
    }

    async cleanUp(): Promise<void> {
        this.renderable?.delete();
        this.renderable = undefined;
        this.mainProgram?.delete();
        this.mainProgram = undefined;
        this.mainAlphaProgram?.delete();
        this.mainAlphaProgram = undefined;
        this.textures.dispose();
    }

    render(time: number, _deltaTime: number, resized: boolean): void {
        this.rendererStats.frameStart = performance.now();
        if (!this.renderable || !this.sceneUniformBuffer || !this.mainProgram || !this.mainAlphaProgram) {
            return;
        }
        if (resized) {
            this.app.resize(this.app.width, this.app.height);
        }

        this.updateCameraMatrices(this.app.width, this.app.height);
        this.currentTimeUni[0] = time / 1000;
        this.isNewTextureAnimUni[0] = this.isNewTextureAnim ? 1 : 0;
        this.debugTextureModeUni[0] = 0;
        this.sceneUniformBuffer.set(0, this.viewProjMatrix as Float32Array)
            .set(1, this.viewMatrix as Float32Array)
            .set(2, this.projectionMatrix as Float32Array)
            .set(3, this.skyColor)
            .set(4, this.cameraPosUni)
            .set(5, this.renderDistanceUni)
            .set(6, this.fogDepthUni)
            .set(7, this.currentTimeUni)
            .set(8, this.brightnessUni)
            .set(9, this.colorBandingUni)
            .set(10, this.isNewTextureAnimUni)
            .set(11, this.debugTextureModeUni)
            .update();

        this.visibleUsedTextureIds[0] = this.renderData?.usedTextureIds ?? this.emptyUsedTextureIds;
        this.textures.updateVisibleResidency(this.visibleUsedTextureIds, this.stats.frameCount, false);

        this.app.defaultDrawFramebuffer();
        this.app.disable(PicoGL.CULL_FACE);
        this.app.disable(PicoGL.BLEND);
        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.clearColor(this.skyColor[0], this.skyColor[1], this.skyColor[2], 1.0);
        this.app.clear();
        this.drawRenderable(false);
        this.app.enable(PicoGL.BLEND);
        this.drawRenderable(true);
    }

    onResize(width: number, height: number): void {
        this.app.resize(width, height);
    }

    onFrameEnd(): void {
        this.stats.onFrameEnd();
    }

    setOrbitDistance(distance: number): void {
        this.orbitDistance = Math.max(0.5, distance);
    }

    setPitch(pitch: number): void {
        this.pitch = pitch | 0;
    }

    setYaw(yaw: number): void {
        this.yaw = yaw | 0;
    }

    getOrbitDistance(): number {
        return this.orbitDistance;
    }

    getPitch(): number {
        return this.pitch;
    }

    getYaw(): number {
        return this.yaw;
    }

    private resetCameraToFit(): void {
        const fitRadiusWorldUnits = this.fitRadius / 128;
        this.target[0] = 0;
        this.target[1] = 0;
        this.target[2] = 0;
        this.orbitDistance = Math.max(4, fitRadiusWorldUnits * 4);
        this.pitch = -180;
        this.yaw = 1024;
    }

    private updateCameraMatrices(width: number, height: number): void {
        const aspect = Math.max(1, width) / Math.max(1, height);
        mat4.perspective(this.projectionMatrix, (90 * Math.PI) / 180, aspect, 0.1, 4096);

        const yaw = (this.yaw - 1024) * RS_TO_RADIANS;
        const pitch = this.pitch * RS_TO_RADIANS;
        const horizontalDistance = Math.cos(pitch) * this.orbitDistance;

        this.eye[0] = this.target[0] + Math.sin(yaw) * horizontalDistance;
        this.eye[1] = this.target[1] - Math.sin(pitch) * this.orbitDistance;
        this.eye[2] = this.target[2] + Math.cos(yaw) * horizontalDistance;

        this.cameraPosUni[0] = this.eye[0];
        this.cameraPosUni[1] = this.eye[2];

        mat4.lookAt(this.viewMatrix, this.eye, this.target, this.up);
        mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);
    }

    private reloadRenderable(): void {
        this.renderable?.delete();
        this.renderable = undefined;
        const textureArray = this.textures.getTextureArray();
        const textureSlotLut = this.textures.getTextureSlotLut();
        const textureMaterials = this.textures.getMaterialsTexture();
        if (
            !this.renderData ||
            !this.sceneUniformBuffer ||
            !this.mainProgram ||
            !this.mainAlphaProgram ||
            !textureArray ||
            !textureSlotLut ||
            !textureMaterials
        ) {
            return;
        }

        const renderable = WebGLSceneResources.createStandalone();
        renderable.createBuffers(this.app, this.renderData);
        renderable.createModelInfoTextures(this.app, this.renderData);
        const createDrawCall = (
            program: Program,
            modelInfoTexture: unknown,
            drawRangesPacked: Int32Array,
        ) =>
            this.createStandaloneDrawCall(
                renderable,
                program,
                modelInfoTexture,
                drawRangesPacked,
                textureArray,
                textureMaterials,
                textureSlotLut,
            );
        renderable.createDrawCalls(
            this.renderData,
            createDrawCall,
            this.mainProgram,
            this.mainAlphaProgram,
        );
        renderable.usedTextureIds = this.renderData.usedTextureIds;
        this.renderable = renderable;
    }

    private createStandaloneDrawCall(
        renderable: WebGLSceneResources,
        program: Program,
        modelInfoTexture: unknown,
        drawRangesPacked: Int32Array,
        textureArray: unknown,
        textureMaterials: unknown,
        textureSlotLut: unknown,
    ) {
        const drawCall = createSceneDrawCall(this.app, {
            program,
            vertexArray: renderable.vertexArray,
            sceneUniformBuffer: this.sceneUniformBuffer!,
            timeLoaded: 0,
            mapPos: this.mapPosUni,
            textureArray: textureArray as never,
            textureMaterials: textureMaterials as never,
            textureSlotLut: textureSlotLut as never,
            drawRangesPacked,
            modelInfoTexture: modelInfoTexture as never,
        });
        return { drawCall, drawRangesPacked };
    }

    private drawRenderable(isAlpha: boolean): void {
        if (!this.renderable) {
            return;
        }
        const drawData = this.renderable.getDrawCall(isAlpha, false, false);
        if (!drawData || drawData.drawRangesPacked.length <= 0) {
            return;
        }
        const drawCount = (drawData.drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0;
        for (let i = 0; i < drawCount; i++) {
            const off = i * DRAW_RANGE_STRIDE;
            drawData.drawCall.uniform("u_drawId", i);
            this.drawRangeScratch[0] = drawData.drawRangesPacked[off + 0] | 0;
            this.drawRangeScratch[1] = drawData.drawRangesPacked[off + 1] | 0;
            this.drawRangeScratch[2] = drawData.drawRangesPacked[off + 2] | 0;
            drawData.drawCall.drawRanges(this.drawRangeScratch);
            drawData.drawCall.draw();
        }
    }
}
