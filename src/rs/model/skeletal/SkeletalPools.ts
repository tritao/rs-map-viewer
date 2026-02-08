import { mat4, quat, vec3 } from "gl-matrix";

import { MatrixPool } from "./MatrixPool";
import { QuatPool } from "./QuatPool";

export class SkeletalPools {
    readonly matrices: MatrixPool;
    readonly quats: QuatPool;

    readonly rotateAxis: vec3 = vec3.create();
    readonly scaleVector: vec3 = vec3.create();

    constructor(matrixCapacity: number = 100, quatCapacity: number = 100) {
        this.matrices = new MatrixPool(matrixCapacity);
        this.quats = new QuatPool(quatCapacity);
    }

    reset(): void {
        this.matrices.reset();
        this.quats.reset();
        vec3.zero(this.rotateAxis);
        vec3.set(this.scaleVector, 1, 1, 1);
    }
}
