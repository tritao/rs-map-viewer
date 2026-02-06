export class TypeDecodeError extends Error {
    readonly opcode: number;
    readonly offset: number;
    readonly cause?: unknown;

    constructor(message: string, options: { opcode: number; offset: number; cause?: unknown }) {
        super(message);
        this.name = "TypeDecodeError";
        this.opcode = options.opcode;
        this.offset = options.offset;
        // Keep original error available for callers that care.
        this.cause = options.cause;
    }
}
