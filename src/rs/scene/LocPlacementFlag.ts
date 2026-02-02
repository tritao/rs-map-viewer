export enum LocPlacementFlag {
    TypeMask = 0x1f,
    RotationMask = 0xc0,
    RotationShift = 6,
}

export function packLocPlacement(type: number, rotation: number): number {
    return (
        ((rotation & 0x3) << LocPlacementFlag.RotationShift) |
        (type & LocPlacementFlag.TypeMask)
    );
}

export function getLocPlacementType(packed: number): number {
    return packed & LocPlacementFlag.TypeMask;
}

export function getLocPlacementRotation(packed: number): number {
    return (packed & LocPlacementFlag.RotationMask) >> LocPlacementFlag.RotationShift;
}

