import Denque from "denque";
import { Program, Texture, UniformBuffer } from "picogl";
import { CacheLoaders } from "../../rs/cache/CacheLoaders";
import { InputManager } from "../../util/InputManager";
import { RenderDataWorkerPool } from "../../worker/RenderDataWorkerPool";
import { Camera } from "../Camera";
import { SdModelData } from "../loader/SdModelData";
import { SdModelDataLoader } from "../loader/SdModelDataLoader";
import { ModelManager } from "../ModelManager";
import { WebGLMapRenderer } from "./WebGLMapRenderer";
import { WebGLModel } from "./WebGLModel";

const DEFAULT_RENDER_DISTANCE = 512;

export class WebGLModelRenderer extends WebGLMapRenderer {
    modelDataLoader = new SdModelDataLoader();
    modelsToLoad: Denque<SdModelData> = new Denque();
    modelManager!: ModelManager<WebGLModel>;

    constructor(
        cacheLoaders: CacheLoaders, inputManager: InputManager,
        workerPool: RenderDataWorkerPool, camera: Camera) {
        super(cacheLoaders, workerPool, inputManager, DEFAULT_RENDER_DISTANCE, 0, 0, camera);
        this.setSkyColor(255, 255, 255);
        this.setMaxLevel(0);
        this.setLoadLocs(false);
        this.setLoadNpcs(false);
        this.setLoadObjs(false);
    }

    async init(canvas: HTMLCanvasElement): Promise<void> {
        await super.init(canvas);
        this.modelManager = new ModelManager(
            this.workerPool.size * 2,
            this.queueLoadModel.bind(this),
        );
    }

    async queueLoadModel(modelId: number): Promise<void> {
        // const modelData = await this.workerPool.queueLoad<
        //     SdModelLoaderInput,
        //     SdModelData | undefined,
        //     SdModelDataLoader
        // >(this.modelDataLoader, {
        //     modelId,
        //     loadedTextureIds: this.loadedTextureIds,
        // });

        // if (modelData) {
        //     //if (this.isValidMapData(modelData)) {
        //         this.modelsToLoad.push(modelData);
        //     //}
        // } else {
        //     //this.mapManager.addInvalidMap(mapX, mapY);
        // }
    }

    loadModel(
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        modelData: SdModelData,
        time: number,
    ): void {
        const { modelId } = modelData;

        const frameCount = this.stats.frameCount;
        this.modelManager.addModel(
            modelId,
            WebGLModel.load(
                this.cacheLoaders.seqTypeLoader,
                this.cacheLoaders.npcTypeLoader,
                this.cacheLoaders.basTypeLoader,
                this.app,
                mainProgram,
                mainAlphaProgram,
                npcProgram,
                textureArray,
                textureMaterials,
                sceneUniformBuffer,
                modelData,
                time,
                frameCount,
            ),
        );

        this.updateTextureArray(modelData.loadedTextures);
    }

    render(time: number, deltaTime: number, resized: boolean): void {
        super.render(time, deltaTime, resized);
    }

    override loadPending(timeSec: number) {
        super.loadPending(timeSec);

        // Load new models
        const modelData = this.modelsToLoad.shift();
        if (modelData) {
            this.loadModel(
                this.mainProgram!,
                this.mainAlphaProgram!,
                this.npcProgram!,
                this.textureArray!,
                this.textureMaterials!,
                this.sceneUniformBuffer!,
                modelData,
                timeSec,
            );
        }
    }

    override async cleanUp(): Promise<void> {
        this.clearModels();
        super.cleanUp();
    }

    clearModels(): void {
        this.modelsToLoad.clear();
    }
}
