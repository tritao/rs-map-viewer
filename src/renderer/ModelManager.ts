import { vec4 } from "gl-matrix";
import { WebGLModel } from "./webgl/WebGLModel";

type LoadModelFunction = (modelId: number) => void;

export interface ModelId {
    modelId: number;

    canRender(frameCount: number): boolean;

    delete(): void;
}

export class ModelManager<T extends WebGLModel> {
    invalidModelIds: Set<number> = new Set();
    loadingModelIds: Set<number> = new Set();

    renderBounds: vec4 = vec4.fromValues(-1, -1, -1, -1);

    visibleModels: T[] = [];

    models: Map<number, T> = new Map();

    constructor(
        readonly maxQueuedTasks: number,
        readonly loadModelFunction: LoadModelFunction,
    ) {}

    init(): void {
        this.cleanUp();
        // for (let x = 0; x < ModelManager.MAX_MAP_X; x++) {
        //     for (let y = 0; y < ModelManager.MAX_MAP_Y; y++) {
        //         if (mapFileIndex.getTerrainArchiveId(x, y) === -1) {
        //             this.invalidModelIds.add(getMapSquareId(x, y));
        //         }
        //     }
        // }
        console.log("Invalid model count", this.invalidModelIds.size);
    }

    clearModels(): void {
        this.invalidModelIds.clear();
        this.loadingModelIds.clear();
        for (const map of this.models.values()) {
            map.delete();
        }
        this.models.clear();
    }

    addModel(modelId: number, model: T): void {
        this.loadingModelIds.delete(modelId);
        this.invalidModelIds.delete(modelId);
        const oldModel = this.models.get(modelId);
        if (oldModel) {
            oldModel.delete();
        }
        this.models.set(modelId, model);
    }

    removeModel(modelId: number): void {
        const model = this.models.get(modelId);
        if (model) {
            model.delete();
            this.models.delete(modelId);
        }
    }

    addInvalidModel(modelId: number): void {
        this.invalidModelIds.add(modelId);
        this.loadingModelIds.delete(modelId);
    }

    loadModel(modelId: number): void {
        if (
            this.models.has(modelId) ||
            this.invalidModelIds.has(modelId) ||
            this.loadingModelIds.has(modelId) ||
            this.loadingModelIds.size > this.maxQueuedTasks
        ) {
            return;
        }
        console.log("Loading model", modelId);
        this.loadingModelIds.add(modelId);
        this.loadModelFunction(modelId);
    }

    cleanUp(): void {
        this.renderBounds.fill(-1);
        this.clearModels();
    }
}
