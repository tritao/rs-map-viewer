import { ModelData } from "../../../rs/model/ModelData";
import { Model as BuiltModel } from "../../../rs/model/Model";
import { ModelLoader } from "../../../rs/model/ModelLoader";
import { Renderable } from "./Renderable";
import { TextureLoader } from "../../../rs/texture/TextureLoader";

export class Model extends Renderable {
    static loader: ModelLoader;

    static getModel(id: number): Model | undefined {
        const data = this.loader.getModel(id);
        if (!data) return undefined;

        return new Model(data);
    }

    static merge(length: number, models: Model[]): Model {
        const merged = ModelData.merge(models.map(m => m.modelData), length);
        return new Model(merged)
    }

    model!: BuiltModel | null;

    constructor(readonly modelData: ModelData) {
        super();
    }

    getBuiltModel(textureLoader: TextureLoader): BuiltModel {
        if (this.model == null) {
            this.model = this.modelData.light(
                textureLoader,
                0 + 64,
                0 + 768,
                -50,
                -10,
                -50,
            );
        }

        return this.model;
    }

    getRotatedModel(): Model {
        throw new Error("Method not implemented.");
    }
}