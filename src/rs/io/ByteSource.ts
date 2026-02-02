export interface ByteSource {
    readonly size: number;

    readInto(
        offset: number,
        target: Uint8Array,
        targetOffset?: number,
        length?: number,
    ): void;
}

