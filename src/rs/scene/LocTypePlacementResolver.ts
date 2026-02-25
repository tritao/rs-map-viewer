import { LocModelType } from "../config/loctype/LocModelType";
import { LocType } from "../config/loctype/LocType";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { VarProvider } from "../config/vartype/VarProvider";

export type LocPlacementModelVariant = Readonly<{
    type: LocModelType;
    rotation: number;
}>;

export function expandLocPlacementModelVariants(
    type: LocModelType,
    rotation: number,
): ReadonlyArray<LocPlacementModelVariant> {
    switch (type) {
        case LocModelType.NORMAL_DIAGIONAL:
            return [{ type: LocModelType.NORMAL, rotation: rotation + 4 }];
        case LocModelType.WALL_CORNER:
            return [
                { type: LocModelType.WALL_CORNER, rotation: rotation + 4 },
                { type: LocModelType.WALL_CORNER, rotation: (rotation + 1) & 3 },
            ];
        case LocModelType.WALL_DECORATION_OUTSIDE:
            return [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation }];
        case LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE:
            return [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation: rotation + 4 }];
        case LocModelType.WALL_DECORATION_DIAGONAL_INSIDE: {
            const insideRotation = (rotation + 2) & 3;
            return [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation: insideRotation + 4 }];
        }
        case LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE: {
            const insideRotation = (rotation + 2) & 3;
            return [
                { type: LocModelType.WALL_DECORATION_INSIDE, rotation: rotation + 4 },
                { type: LocModelType.WALL_DECORATION_INSIDE, rotation: insideRotation + 4 },
            ];
        }
        default:
            return [{ type, rotation }];
    }
}

export function resolveLocTypeForPlacement(
    id: number,
    locTypeLoader: LocTypeLoader,
    varProvider: VarProvider,
): LocType | undefined {
    const locResult = locTypeLoader.tryLoad(id);
    if (!locResult.ok) {
        return undefined;
    }
    let locType = locResult.value;
    if (locType.transforms) {
        // If a transform resolves to -1/unloadable, treat it as "no loc present".
        // This matches `LocType.transform()` semantics and avoids rendering hidden transform states.
        return locType.transform(varProvider, locTypeLoader);
    }
    return locType;
}
