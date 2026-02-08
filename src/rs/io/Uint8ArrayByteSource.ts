import { ByteSource } from "./ByteSource";
import { ByteSourceSlice } from "./ByteSourceSlice";

export class Uint8ArrayByteSource implements ByteSource {
    constructor(readonly view: Uint8Array) {}

    get size(): number {
        return this.view.byteLength;
    }

    slice(start: number, size: number): ByteSource {
        return new ByteSourceSlice(this, start, size);
    }

    tryGetUint8ArrayView(): Uint8Array {
        return this.view;
    }

    readInto(
        offset: number,
        target: Uint8Array,
        targetOffset: number = 0,
        length: number = target.length - targetOffset,
    ): void {
        if (length < 0) {
            throw new Error("Invalid length");
        }
        if (offset < 0 || offset + length > this.size) {
            throw new Error(
                `Read out of bounds. offset=${offset}, length=${length}, size=${this.size}`,
            );
        }
        if (length === 0) {
            return;
        }

        target.set(this.view.subarray(offset, offset + length), targetOffset);
    }
}
