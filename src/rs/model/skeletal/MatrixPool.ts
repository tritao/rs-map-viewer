import { mat4 } from "gl-matrix";

export class MatrixPool {
    private count: number = 0;
    private readonly pool: mat4[];

    constructor(private readonly capacity: number) {
        this.pool = new Array(capacity);
    }

    reset(): void {
        this.count = 0;
    }

    get(): mat4 {
        if (this.count === 0) {
            return mat4.create();
        }
        const m = this.pool[--this.count]!;
        mat4.identity(m);
        return m;
    }

    release(m: mat4): void {
        if (this.count < this.capacity) {
            this.pool[this.count++] = m;
        }
    }
}
