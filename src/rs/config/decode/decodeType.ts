import { Result, err, ok } from "../../../util/Result";
import { CacheInfo } from "../../cache/CacheInfo";
import { DecodeError, decodeFailedError } from "../../core/DecodeError";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

export type TypeConstructor<T extends Type> = new (id: number, cacheInfo: CacheInfo) => T;

type TypeDecodeMetadata = Readonly<{
    opcode: number;
    offset: number;
}>;

function tryReadTypeDecodeMetadata(cause: unknown): TypeDecodeMetadata | undefined {
    if (
        typeof cause !== "object" ||
        cause === null ||
        !("opcode" in cause) ||
        !("offset" in cause)
    ) {
        return undefined;
    }
    const opcode = (cause as { opcode?: unknown }).opcode;
    const offset = (cause as { offset?: unknown }).offset;
    if (typeof opcode !== "number" || typeof offset !== "number") {
        return undefined;
    }
    return { opcode, offset };
}

export function decodeTypeFromBuffer<T extends Type>(
    typeConstructor: TypeConstructor<T>,
    cacheInfo: CacheInfo,
    id: number,
    buffer: ByteBuffer,
): Result<T, DecodeError> {
    const typeName = typeConstructor.name || "Type";
    const type = new typeConstructor(id, cacheInfo);

    try {
        type.decode(buffer);
        type.post();
        return ok(type);
    } catch (cause) {
        const typeDecodeMeta = tryReadTypeDecodeMetadata(cause);
        const opcode = typeDecodeMeta?.opcode;
        const offset = typeDecodeMeta?.offset ?? buffer.offset;
        return err(
            decodeFailedError({
                typeName,
                id,
                message: `${typeName}: decode failed for id=${id}`,
                cause,
                opcode,
                offset,
            }),
        );
    }
}

export function decodeTypeFromBytes<T extends Type>(
    typeConstructor: TypeConstructor<T>,
    cacheInfo: CacheInfo,
    id: number,
    bytes: Uint8Array,
): Result<T, DecodeError> {
    return decodeTypeFromBuffer(typeConstructor, cacheInfo, id, new ByteBuffer(bytes));
}
