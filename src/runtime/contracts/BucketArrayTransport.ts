export function packBucketedInt32Arrays<K extends string>(
    keys: ReadonlyArray<K>,
    buckets: Readonly<Record<K, Int32Array>>,
): Readonly<{
    bucketLengths: Int32Array;
    packed: Int32Array;
}> {
    const lengths = new Int32Array(keys.length);
    let totalLength = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const bucket = buckets[key];
        const len = bucket?.length ?? 0;
        lengths[i] = len | 0;
        totalLength += len | 0;
    }
    const packed = new Int32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const bucket = buckets[key];
        if (!(bucket instanceof Int32Array) || bucket.length <= 0) {
            continue;
        }
        packed.set(bucket, offset);
        offset += bucket.length | 0;
    }
    return { bucketLengths: lengths, packed };
}

export function unpackBucketedInt32Arrays<K extends string>(
    keys: ReadonlyArray<K>,
    bucketLengths: Int32Array,
    packed: Int32Array,
    errorContext: string,
): Record<K, Int32Array> {
    const buckets = {} as Record<K, Int32Array>;
    let offset = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const len = bucketLengths[i] | 0;
        if (len < 0 || offset + len > packed.length) {
            throw new Error(`${errorContext}: invalid packed bucket for key=${key}`);
        }
        buckets[key] = packed.subarray(offset, offset + len);
        offset += len;
    }
    if (offset !== packed.length) {
        throw new Error(`${errorContext}: packed bucket length mismatch`);
    }
    return buckets;
}
