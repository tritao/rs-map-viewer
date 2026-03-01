export type TickPatchStream = Readonly<{ patches: Int32Array; count: number }>;

export const enum LocTickPatchVariant {
    Base = 0,
    Alpha = 1,
    Lod = 2,
    LodAlpha = 3,
    Interact = 4,
    InteractAlpha = 5,
    InteractLod = 6,
    InteractLodAlpha = 7,
}

export const enum NpcTickPatchVariant {
    Base = 0,
    Alpha = 1,
}

export function chooseLocTickPatchVariant(
    isAlpha: boolean,
    isInteract: boolean,
    isLod: boolean,
): LocTickPatchVariant {
    if (isInteract) {
        if (isLod) {
            return isAlpha ? LocTickPatchVariant.InteractLodAlpha : LocTickPatchVariant.InteractLod;
        }
        return isAlpha ? LocTickPatchVariant.InteractAlpha : LocTickPatchVariant.Interact;
    }
    if (isLod) {
        return isAlpha ? LocTickPatchVariant.LodAlpha : LocTickPatchVariant.Lod;
    }
    return isAlpha ? LocTickPatchVariant.Alpha : LocTickPatchVariant.Base;
}

export function chooseNpcTickPatchVariant(isAlpha: boolean): NpcTickPatchVariant {
    return isAlpha ? NpcTickPatchVariant.Alpha : NpcTickPatchVariant.Base;
}
