export type DecodeErrorKind = "not_found" | "decode_failed";

export type DecodeError = {
    kind: DecodeErrorKind;
    message: string;
    typeName?: string;
    id?: number;
    resourceName?: string;
    resourceIndex?: number;
    opcode?: number;
    offset?: number;
    cause?: unknown;
};

export function notFoundError(typeName: string, id: number): DecodeError {
    return { kind: "not_found", message: `${typeName}: data not found for id=${id}`, typeName, id };
}

export function decodeFailedError(options: {
    typeName: string;
    id?: number;
    resourceName?: string;
    resourceIndex?: number;
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
        resourceName: options.resourceName,
        resourceIndex: options.resourceIndex,
        opcode: options.opcode,
        offset: options.offset,
        cause: options.cause,
    };
}

export function isDecodeNotFound(error: DecodeError): boolean {
    return error.kind === "not_found";
}

export function decodeErrorToString(error: DecodeError): string {
    const details: string[] = [];
    if (error.typeName) {
        details.push(`type=${error.typeName}`);
    }
    if (error.id !== undefined) {
        details.push(`id=${error.id}`);
    }
    if (error.resourceName !== undefined) {
        details.push(`name=${error.resourceName}`);
    }
    if (error.resourceIndex !== undefined) {
        details.push(`index=${error.resourceIndex}`);
    }
    if (error.opcode !== undefined) {
        details.push(`opcode=${error.opcode}`);
    }
    if (error.offset !== undefined) {
        details.push(`offset=${error.offset}`);
    }

    return details.length > 0 ? `${error.message} (${details.join(" ")})` : error.message;
}

export function withDecodeErrorContext(
    error: DecodeError,
    context: {
        typeName?: string;
        id?: number;
        resourceName?: string;
        resourceIndex?: number;
    },
): DecodeError {
    return {
        ...error,
        typeName: error.typeName ?? context.typeName,
        id: error.id ?? context.id,
        resourceName: error.resourceName ?? context.resourceName,
        resourceIndex: error.resourceIndex ?? context.resourceIndex,
    };
}
