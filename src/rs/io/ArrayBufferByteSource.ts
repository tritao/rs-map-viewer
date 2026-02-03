import { ByteSource } from "./ByteSource";
import { ByteSourceSlice } from "./ByteSourceSlice";

export class ArrayBufferByteSource implements ByteSource {
    constructor(readonly buffer: ArrayBuffer | SharedArrayBuffer) {}

    get size(): number {
        return this.buffer.byteLength;
    }

    slice(start: number, size: number): ByteSource {
        return new ByteSourceSlice(this, start, size);
    }

    tryGetUint8ArrayView(): Uint8Array {
        return new Uint8Array(this.buffer);
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
            throw new Error(`Read out of bounds. offset=${offset}, length=${length}, size=${this.size}`);
        }
        if (length === 0) {
            return;
        }

        target.set(new Uint8Array(this.buffer, offset, length), targetOffset);
    }
}
