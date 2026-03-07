export const RUNTIME_BLOB_TYPE_ENTRY_DOMAIN_BASE = 100;
export const RUNTIME_BLOB_TYPE_ENTRY_KIND_MIN = 1;
export const RUNTIME_BLOB_TYPE_ENTRY_KIND_MAX = 16;

export const RuntimeBlobTypeEntryKind = {
    loc: 1,
    varbit: 2,
    model: 3,
    textureDef: 4,
    seqType: 5,
    seqFrame: 6,
    npc: 7,
    bas: 8,
    underlay: 10,
    overlay: 11,
    obj: 12,
    objSpawns: 13,
    seqBase: 15,
    skeletalSeq: 16,
} as const;

export type RuntimeBlobTypeEntryKind =
    (typeof RuntimeBlobTypeEntryKind)[keyof typeof RuntimeBlobTypeEntryKind];

const SUPPORTED_RUNTIME_BLOB_TYPE_ENTRY_KINDS = new Set<number>(
    Object.values(RuntimeBlobTypeEntryKind),
);

const NON_UPLOADED_RUNTIME_BLOB_TYPE_ENTRY_KINDS = new Set<number>([
    9,
    14, // seqAlphaHint: derived internally by C++, not uploaded by TS.
]);

export function runtimeBlobTypeEntryDomain(kind: RuntimeBlobTypeEntryKind): number {
    return RUNTIME_BLOB_TYPE_ENTRY_DOMAIN_BASE + (kind | 0);
}

export function runtimeBlobTypeEntryKindFromDomain(domain: number): number | undefined {
    const kind = (domain | 0) - RUNTIME_BLOB_TYPE_ENTRY_DOMAIN_BASE;
    if (kind < RUNTIME_BLOB_TYPE_ENTRY_KIND_MIN || kind > RUNTIME_BLOB_TYPE_ENTRY_KIND_MAX) {
        return undefined;
    }
    return kind;
}

function assertRuntimeBlobTypeEntryKindCoverage(): void {
    for (
        let kind = RUNTIME_BLOB_TYPE_ENTRY_KIND_MIN;
        kind <= RUNTIME_BLOB_TYPE_ENTRY_KIND_MAX;
        kind++
    ) {
        if (
            !SUPPORTED_RUNTIME_BLOB_TYPE_ENTRY_KINDS.has(kind) &&
            !NON_UPLOADED_RUNTIME_BLOB_TYPE_ENTRY_KINDS.has(kind)
        ) {
            throw new Error(
                `RuntimeBlobTypeEntries: unclassified type-entry kind=${kind}; ` +
                    "add support or mark it non-uploaded",
            );
        }
    }
}

assertRuntimeBlobTypeEntryKindCoverage();
