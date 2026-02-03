import { ByteSource } from "./ByteSource";

/**
 * Helper for offset-based reads against a `ByteSource`.
 *
 * - If the source exposes a contiguous view, reads are zero-copy (subarray views).
 * - Otherwise, reads are serviced via `readInto` into a reusable scratch buffer.
 *
 * The returned `Uint8Array` from `readSlice` is only valid until the next call to
 * `readSlice` when using the scratch-buffer path.
 */
export class ByteSourceAccess {
    private static readonly EMPTY: Uint8Array = new Uint8Array(0);

    private readonly view: Uint8Array | null;
    private scratch: Uint8Array;

    constructor(
        readonly source: ByteSource,
        scratch: Uint8Array = new Uint8Array(16),
    ) {
        const v = source.tryGetUint8ArrayView();
        this.view = v && v.byteLength === source.size ? v : null;
        this.scratch = scratch;
    }

    readSlice(offset: number, length: number): Uint8Array {
        if (length < 0) {
            throw new Error("Invalid length");
        }
        if (offset < 0 || offset + length > this.source.size) {
            throw new Error(`Read out of bounds. offset=${offset}, length=${length}, size=${this.source.size}`);
        }
        if (length === 0) {
            return ByteSourceAccess.EMPTY;
        }

        if (this.view) {
            return this.view.subarray(offset, offset + length);
        }

        if (this.scratch.byteLength < length) {
            this.scratch = new Uint8Array(length);
        }
        this.source.readInto(offset, this.scratch, 0, length);
        return this.scratch.subarray(0, length);
    }
}

