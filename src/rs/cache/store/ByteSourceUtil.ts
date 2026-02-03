import { ByteSource } from "../../io/ByteSource";

export function readAllBytes(source: ByteSource): Uint8Array {
    const out = new Uint8Array(source.size);
    source.readInto(0, out);
    return out;
}

