export enum CurveType {
    NONE = 0,
    ROTATE_X = 1,
    ROTATE_Y = 2,
    ROTATE_Z = 3,
    TRANSLATE_X = 4,
    TRANSLATE_Y = 5,
    TRANSLATE_Z = 6,
    SCALE_X = 7,
    SCALE_Y = 8,
    SCALE_Z = 9,
    ROTATE_X_ALT = 10,
    ROTATE_Y_ALT = 11,
    ROTATE_Z_ALT = 12,
    TRANSLATE_X_ALT = 13,
    TRANSLATE_Y_ALT = 14,
    TRANSLATE_Z_ALT = 15,
    ALPHA = 16,
}

export function getCurveTypeForId(id: number): CurveType {
    if (id < 0 || id > CurveType.ALPHA) {
        return CurveType.NONE;
    }
    return id;
}

// Maps `CurveType` ids (as encoded in cache data) to a curve-channel index within
// each `SkeletalTransformType` bucket:
// - `BONE` uses indices 0..8: rot(0..2), trans(3..5), scale(6..8).
// - Some non-bone transform types use alternate ids (10..15) that map to 0..5.
// - `ALPHA` maps to channel 0.
const CURVE_INDICES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 0];

export function getCurveIndex(type: CurveType): number {
    return CURVE_INDICES[type];
}
