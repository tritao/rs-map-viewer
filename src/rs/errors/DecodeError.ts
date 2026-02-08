export type DecodeErrorKind = "not_found" | "decode_failed";

export type DecodeError = {
    kind: DecodeErrorKind;
    message: string;
    typeName?: string;
    id?: number;
    opcode?: number;
    offset?: number;
    cause?: unknown;
};

export function notFoundError(typeName: string, id: number): DecodeError {
    return { kind: "not_found", message: `${typeName}: data not found for id=${id}`, typeName, id };
}

export function decodeFailedError(options: {
    typeName: string;
    id: number;
    message: string;
    opcode?: number;
    offset?: number;
    cause?: unknown;
}): DecodeError {
    return {
        kind: "decode_failed",
        message: options.message,
        typeName: options.typeName,
        id: options.id,
        opcode: options.opcode,
        offset: options.offset,
        cause: options.cause,
    };
}
