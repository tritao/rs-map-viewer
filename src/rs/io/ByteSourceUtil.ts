import { ByteSource } from "./ByteSource";

export function readAllBytes(source: ByteSource): Uint8Array {
    const out = new Uint8Array(source.size);
    source.readInto(0, out);
    return out;
}

/**
 * Returns a contiguous view of the source bytes when available, otherwise allocates and copies.
 *
 * By convention, callers must treat the returned bytes as read-only.
 */
export function getOrCopyBytes(source: ByteSource): Uint8Array {
    const view = source.tryGetUint8ArrayView();
    if (view) {
        return view;
    }
    return readAllBytes(source);
}
