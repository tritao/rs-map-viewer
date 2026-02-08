export interface ByteSource {
    readonly size: number;

    slice(start: number, size: number): ByteSource;

    readInto(offset: number, target: Uint8Array, targetOffset?: number, length?: number): void;

    /**
     * Optional fast-path for sources backed by contiguous memory.
     *
     * Intended to avoid RTTI-style checks (`instanceof`) and to map cleanly to
     * native/WASM spans/slices.
     *
     * Important: the returned view must be treated as **read-only**. Callers must not mutate it.
     */
    tryGetUint8ArrayView(): Uint8Array | null;
}
