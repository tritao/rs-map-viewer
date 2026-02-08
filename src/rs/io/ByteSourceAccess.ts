import { ByteSource } from "./ByteSource";

/**
 * Helper for offset-based reads against a `ByteSource`.
 *
 * This intentionally separates:
 * - **Borrowed** reads (`tryView`): returns a view only when the underlying source is contiguous.
 * - **Copy** reads (`copyBytes`/`readInto`): always copy via `readInto`.
 */
export class ByteSourceAccess {
    private static readonly EMPTY: Uint8Array = new Uint8Array(0);

    private readonly view: Uint8Array | null;

    constructor(readonly source: ByteSource) {
        const v = source.tryGetUint8ArrayView();
        this.view = v && v.byteLength === source.size ? v : null;
    }

    tryView(offset: number, length: number): Uint8Array | null {
        if (length < 0) {
            throw new Error("Invalid length");
        }
        if (offset < 0 || offset + length > this.source.size) {
            throw new Error(
                `Read out of bounds. offset=${offset}, length=${length}, size=${this.source.size}`,
            );
        }
        if (length === 0) {
            return ByteSourceAccess.EMPTY;
        }

        return this.view ? this.view.subarray(offset, offset + length) : null;
    }

    copyBytes(offset: number, length: number): Uint8Array {
        if (length < 0) {
            throw new Error("Invalid length");
        }
        if (offset < 0 || offset + length > this.source.size) {
            throw new Error(
                `Read out of bounds. offset=${offset}, length=${length}, size=${this.source.size}`,
            );
        }
        if (length === 0) {
            return ByteSourceAccess.EMPTY;
        }
        const out = new Uint8Array(length);
        this.source.readInto(offset, out);
        return out;
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
        if (offset < 0 || offset + length > this.source.size) {
            throw new Error(
                `Read out of bounds. offset=${offset}, length=${length}, size=${this.source.size}`,
            );
        }
        this.source.readInto(offset, target, targetOffset, length);
    }
}
