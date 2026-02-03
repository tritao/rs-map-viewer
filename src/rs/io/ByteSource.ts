export interface ByteSource {
    readonly size: number;

    readInto(
        offset: number,
        target: Uint8Array,
        targetOffset?: number,
        length?: number,
    ): void;

    /**
     * Optional fast-path for sources backed by contiguous memory.
     *
     * Intended to avoid RTTI-style checks (`instanceof`) and to map cleanly to
     * native/WASM spans/slices.
     */
    tryGetUint8ArrayView?(): Uint8Array | null;
}
