import { CacheInfo } from "../../cache/CacheInfo";
import { DecodeError, decodeFailedError } from "../../errors/DecodeError";
import { TypeDecodeError } from "../../errors/TypeDecodeError";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Result, err, ok } from "../../../util/Result";
import { Type } from "../Type";

export type TypeConstructor<T extends Type> = new (id: number, cacheInfo: CacheInfo) => T;

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
        const typeDecodeMeta =
            typeof cause === "object" &&
            cause !== null &&
            "opcode" in cause &&
            "offset" in cause &&
            typeof (cause as { opcode?: unknown }).opcode === "number" &&
            typeof (cause as { offset?: unknown }).offset === "number"
                ? { opcode: (cause as { opcode: number }).opcode, offset: (cause as { offset: number }).offset }
                : undefined;
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
