import { quat } from "gl-matrix";

export class QuatPool {
    private count: number = 0;
    private readonly pool: quat[];

    constructor(private readonly capacity: number) {
        this.pool = new Array(capacity);
    }

    reset(): void {
        this.count = 0;
    }

    get(): quat {
        if (this.count === 0) {
            return quat.create();
        }
        const q = this.pool[--this.count]!;
        quat.identity(q);
        return q;
    }

    release(q: quat): void {
        if (this.count < this.capacity) {
            this.pool[this.count++] = q;
        }
    }
}
