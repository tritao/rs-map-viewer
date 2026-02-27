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

export type LocTickPatchProvider = Readonly<{
    getLocTickPatchCount(variant: LocTickPatchVariant): number;
    getLocTickPatches(variant: LocTickPatchVariant): Int32Array;
}>;

export type NpcTickPatchProvider = Readonly<{
    getNpcTickPatchCount(variant: NpcTickPatchVariant): number;
    getNpcTickPatches(variant: NpcTickPatchVariant): Int32Array;
}>;

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

export function selectLocTickPatchStream(
    provider: LocTickPatchProvider,
    isAlpha: boolean,
    isInteract: boolean,
    isLod: boolean,
): TickPatchStream | undefined {
    const variant = chooseLocTickPatchVariant(isAlpha, isInteract, isLod);
    const count = provider.getLocTickPatchCount(variant) | 0;
    if (count < 0) {
        return undefined;
    }
    return { patches: provider.getLocTickPatches(variant), count };
}

export function selectNpcTickPatchStream(
    provider: NpcTickPatchProvider,
    isAlpha: boolean,
): TickPatchStream | undefined {
    const variant = chooseNpcTickPatchVariant(isAlpha);
    const count = provider.getNpcTickPatchCount(variant) | 0;
    if (count < 0) {
        return undefined;
    }
    return { patches: provider.getNpcTickPatches(variant), count };
}

