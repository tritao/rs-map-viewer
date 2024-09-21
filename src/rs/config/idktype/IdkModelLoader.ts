import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { IdkType } from "./IdkType";
import { IdkTypeLoader } from "./IdkTypeLoader";

export class IdkModelLoader {
    modelCache: Map<number, Model>;

    constructor(
        readonly idkTypeLoader: IdkTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
    ) {
        this.modelCache = new Map();
    }

    getModel(idkType: IdkType): Model | undefined {
        let model = this.modelCache.get(idkType.id);
        if (!model) {
            const models = new Array<ModelData>(idkType.modelIds.length);
            for (let i = 0; i < models.length; i++) {
                const modelData = this.modelLoader.getModel(idkType.modelIds[i]);
                if (modelData) {
                    models[i] = modelData;
                }
            }

            const merged = ModelData.merge(models, models.length);

            if (idkType.recolorFrom) {
                const retexture =
                    idkType.cacheInfo.game === "runescape" && idkType.cacheInfo.revision <= 377;
                for (let i = 0; i < idkType.recolorFrom.length; i++) {
                    merged.recolor(idkType.recolorFrom[i], idkType.recolorTo[i]);
                    if (retexture) {
                        merged.retexture(idkType.recolorFrom[i], idkType.recolorTo[i]);
                    }
                }
            }

            if (idkType.retextureFrom) {
                for (let i = 0; i < idkType.retextureFrom.length; i++) {
                    merged.retexture(idkType.retextureFrom[i], idkType.retextureTo[i]);
                }
            }

            const ambient = 0;
            const contrast = 0;
            model = merged.light(
                this.textureLoader,
                ambient + 64,
                contrast * 5 + 850,
                -30,
                -50,
                -30,
            );

            this.modelCache.set(idkType.id, model);
        }

        return model;
    }

    clearCache(): void {
        this.modelCache.clear();
    }
}
