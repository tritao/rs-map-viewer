import { IdkType } from "../../../rs/config/idktype/IdkType";
import { IdkTypeLoader } from "../../../rs/config/invtype/IdkTypeLoader";
import { Model } from "../renderable/Model";

export class IdentityKit {
    public static count: number = 0;

    public static cache: IdentityKit[] = [];

    public static loadCache(idkLoader: IdkTypeLoader) {
        IdentityKit.count = idkLoader.getCount();
        IdentityKit.cache = Array(IdentityKit.count).fill(null);
        for (let i = 0; i < IdentityKit.count; i++) {
            if (IdentityKit.cache[i] == null) {
                IdentityKit.cache[i] = new IdentityKit(idkLoader.load(i));
            }
        }
    }

    public static loadFromCache(id: number): IdentityKit | null {
        return IdentityKit.cache![id];
    }

    constructor(readonly idk: IdkType) { }

    public isBodyModelCached(): boolean {
        if (this.idk.modelIds == null) {
            return true;
        }

        return false;

        let isCached: boolean = true;
        for (let i = 0; i < this.idk.modelIds.length; i++) {
            //if (!Model.loaded(this.idk.modelIds[i])) {
            //    isCached = false;
            //}
        }

        return isCached;
    }

    public getBodyModel(): Model | null {
        if (this.idk.modelIds == null) {
            return null;
        }

        const models: Model[] = Array(this.idk.modelIds.length).fill(undefined);
        for (let model: number = 0; model < this.idk.modelIds.length; model++) {
            const loadedModel = Model.getModel(this.idk.modelIds[model]);
            if (loadedModel) {
                models[model] = loadedModel;
            }
        }

        let model: Model;
        if (models.length === 1) {
            model = models[0];
        } else {
            model = Model.merge(models.length, models);
        }

        for (let color: number = 0; color < 6; color++) {
            if (this.idk.recolorFrom[color] === 0) {
                break;
            }
            //model.replaceColor(this.idk.recolorFrom[color],
            //    this.idk.recolorTo[color]);
        }

        return model;
    }

    public getHeadModel(): Model | null {
        const models: (Model | null)[] = [null, null, null, null, null];
        //let count: number = 0;
        //for (let model: number = 0; model < 5; model++) {
        //    if (this.headModelIds[model] !== -1) {
        //        models[count++] = Model.getModel(this.headModelIds[model]);
        //    }
        //}
        let model = null;
        //const model: Model = new Model(count, models);
        //for (let color: number = 0; color < 6; color++) {
        //    {
        //        if (this.originalModelColors[color] === 0) { break; }
        //        model.replaceColor(this.originalModelColors[color], this.modifiedModelColors[color]);
        //    }
        //}
        return model;
    }

}