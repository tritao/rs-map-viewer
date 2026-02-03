import { ByteSource } from "./ByteSource";

export class ByteSourceSlice implements ByteSource {
    constructor(
        readonly source: ByteSource,
        readonly start: number,
        readonly size: number,
    ) {
        if (start < 0) {
            throw new Error("Invalid start");
        }
        if (size < 0) {
            throw new Error("Invalid size");
        }
        if (start + size > source.size) {
            throw new Error(`Slice out of bounds. start=${start}, size=${size}, sourceSize=${source.size}`);
        }
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
        this.source.readInto(this.start + offset, target, targetOffset, length);
    }
}

