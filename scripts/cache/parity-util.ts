export type StatusKind = "not_found" | "decode_failed" | "unsupported" | "other";

export function toStatusKind(kind: string | undefined): StatusKind {
    if (kind === "not_found" || kind === "decode_failed" || kind === "unsupported") return kind;
    return "other";
}

export function statusKindFromCppStatus(status: string | undefined): StatusKind {
    if (!status) return "other";
    if (status === "NotFound" || status === "OutOfRange") return "not_found";
    if (
        status === "DecodeError" ||
        status === "BadFormat" ||
        status === "Truncated" ||
        status === "ChecksumMismatch" ||
        status === "SizeMismatch"
    ) {
        return "decode_failed";
    }
    if (status === "Unsupported") return "unsupported";
    return "other";
}

export function fnv1a32UpdateInt(h: number, v: number): number {
    const x = v >>> 0;
    h ^= x & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}
