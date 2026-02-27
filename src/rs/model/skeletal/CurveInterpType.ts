export enum CurveInterpType {
    // Extrapolation mode used when sampling outside the curve range.
    CONSTANT = 0,
    LINEAR = 1,
    CYCLE = 2,
    CYCLE_OFFSET = 3,
    PING_PONG = 4,
}

export function getInterpTypeForId(id: number): CurveInterpType {
    if (id < 0 || id > CurveInterpType.PING_PONG) {
        return CurveInterpType.CONSTANT;
    }
    return id;
}
