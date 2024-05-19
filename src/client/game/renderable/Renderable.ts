import { VertexNormal } from "../../../rs/model/VertexNormal";
import { CacheableNode } from "../collection/CacheableNode";
import { Model } from "./Model";

export abstract class Renderable extends CacheableNode {
    public verticesNormal: VertexNormal[] | null = null;

    public modelHeight: number = 1000;

    constructor() {
        super();
    }

    //public renderAtPoint(i: number, j: number, k: number, l: number, i1: number, j1: number, k1: number, l1: number, i2: number) {
    //    const model: Model = this.getRotatedModel();
    //    if (model != null) {
    //        this.modelHeight = model.modelHeight;
    //        model.renderAtPoint(i, j, k, l, i1, j1, k1, l1, i2);
    //    }
    //}

    abstract getRotatedModel(): Model | null;
}
