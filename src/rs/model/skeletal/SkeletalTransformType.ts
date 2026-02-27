export enum SkeletalTransformType {
    NONE = 0,
    BONE = 1,
    // Likely a non-bone transform targeting billboard/attachment-style channels (see base transform types
    // 8/9/10 in older clients). Not observed in our local OSRS caches so far.
    BILLBOARD_TRANSFORM_A = 2,
    // Non-bone transform that targets `SeqTransformType.LIGHT` base slots (e.g. H/S/L-style face color tweaks).
    // Note: although many caches only populate 3 channels, the format's channel table allows up to 6.
    LIGHT = 3,
    ALPHA = 4,
    // Likely a non-bone transform targeting billboard/attachment-style channels (see base transform types
    // 8/9/10 in older clients). Not observed in our local OSRS caches so far.
    BILLBOARD_TRANSFORM_B = 5,
}

export function getTransformTypeForId(id: number): SkeletalTransformType {
    if (id < 0 || id > SkeletalTransformType.BILLBOARD_TRANSFORM_B) {
        return SkeletalTransformType.NONE;
    }
    return id;
}

const CURVE_COUNTS = [0, 9, 3, 6, 1, 3];

export function getCurveCount(type: SkeletalTransformType): number {
    return CURVE_COUNTS[type];
}
