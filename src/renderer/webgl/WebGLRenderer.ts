import Denque from "denque";
import PicoGL, { Texture } from "picogl";
import { InputManager } from "../../util/InputManager";
import { RenderDataWorkerPool } from "../../worker/RenderDataWorkerPool";
import { CacheSession } from "../../rs/runtime/createCacheSession";
import { Camera } from "../Camera";
import { SdRenderableData } from "../loader/SdRenderableData";
import { SdRenderableDataLoader } from "../loader/SdRenderableDataLoader";
import { SdRenderableLoaderInput } from "../loader/SdRenderableLoaderInput";
import { RenderableType } from "../Renderer";
import { WebGLMapRenderer } from "./WebGLMapRenderer";
import { WebGLRenderable } from "./WebGLRenderable";

const DEFAULT_RENDER_DISTANCE = 512;

export class WebGLRenderer extends WebGLMapRenderer {
    renderableDataLoader = new SdRenderableDataLoader();

    renderablesToLoad: Denque<SdRenderableData> = new Denque();
    loadedRenderables: Map<number, WebGLRenderable> = new Map();

    constructor(
        session: CacheSession, inputManager: InputManager,
        workerPool: RenderDataWorkerPool, camera: Camera) {
        super(session, workerPool, inputManager, DEFAULT_RENDER_DISTANCE, 0, 0, camera);
        this.setSkyColor(255, 255, 255);
        this.setMaxLevel(0);
        this.setLoadLocs(false);
        this.setLoadNpcs(false);
        this.setLoadObjs(false);
    }

    async init(canvas: HTMLCanvasElement): Promise<void> {
        await super.init(canvas);
    }

    // Models
    async loadData(type: RenderableType, ids: number[]): Promise<SdRenderableData | undefined> {
        const data = await this.workerPool.queueLoad<
            SdRenderableLoaderInput,
            SdRenderableData | undefined,
            SdRenderableDataLoader
        >(this.renderableDataLoader, {
            type,
            ids,
            loadedTextureIds: this.loadedTextureIds,
        });

        return data;
    }

    addRenderable(modelData: SdRenderableData): void {
        this.renderablesToLoad.push(modelData);
    }

    removeRenderable(modelId: number) {
        let model = this.loadedRenderables.get(modelId);
        if (model) {
            model.delete();
            this.loadedRenderables.delete(modelId);
        }
    }

    loadRenderable(
        data: SdRenderableData,
        time: number,
    ): void {
        const { ids: id } = data;

        const frameCount = this.stats.frameCount;
        this.loadedRenderables.set(
            id,
            WebGLRenderable.load(
                this.session.loaders.seqTypeLoader,
                this.session.loaders.npcTypeLoader,
                this.session.loaders.basTypeLoader,
                this.app,
                this.mainProgram!,
                this.mainAlphaProgram!,
                this.npcProgram!,
                this.textureArray!,
                this.textureMaterials!,
                this.sceneUniformBuffer!,
                data,
                time,
                frameCount,
            ),
        );

        this.updateTextureArray(data.loadedTextures);
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

    override render(time: number, deltaTime: number, resized: boolean): void {
        this.npcRenderCount = 0;
        for (const [_, renderable] of this.loadedRenderables.entries()) {
            if (!renderable || renderable.type != RenderableType.NPC) {
                continue;
            }

            this.addNpcRenderData(renderable);
        }

        super.render(time, deltaTime, resized);
    }

    override renderOpaquePass(): void {
        for (const [_, renderable] of this.loadedRenderables.entries()) {
            if (!renderable || renderable.type != RenderableType.Model) {
                continue;
            }

            const isInteract = false;
            const isLod = false;
            const { drawCall, drawRanges } = renderable.getDrawCall(false, isInteract, isLod);
            if (!drawCall) {
                continue;
            }

            for (const loc of renderable.locsAnimated) {
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

    override renderOpaqueNpcPass(npcDataTextureIndex: number, npcDataTexture: Texture | undefined): void {
        if (!npcDataTexture) {
            return;
        }

        for (const [_, renderable] of this.loadedRenderables.entries()) {
            if (!renderable || renderable.type != RenderableType.NPC) {
                continue;
            }

            const npcs = renderable.npcs;

            if (npcs.length === 0) {
                continue;
            }

            let dataOffset = renderable.npcDataTextureOffsets[npcDataTextureIndex];
            dataOffset = 0;

            if (dataOffset === -1) {
                continue;
            }

            const { drawCall, drawRanges } = renderable.drawCallNpc;

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

    override loadPending(timeSec: number) {
        super.loadPending(timeSec);

        for (let i = 0; i < this.renderablesToLoad.length; i++) {
            const data = this.renderablesToLoad.get(i);
            if (data) {
                this.loadRenderable(data, timeSec);
            }
        }

        this.clearModels();
    }

    override async cleanUp(): Promise<void> {
        this.clearModels();
        super.cleanUp();
    }

    clearModels(): void {
        this.renderablesToLoad.clear();
    }
}
