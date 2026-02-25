import assert from "node:assert/strict";

import { LocModelType } from "../../src/rs/config/loctype/LocModelType";
import { expandLocPlacementModelVariants } from "../../src/rs/scene/LocTypePlacementResolver";

function normalize(
    variants: ReadonlyArray<Readonly<{ type: LocModelType; rotation: number }>>,
): Array<{ type: number; rotation: number }> {
    return variants.map((variant) => ({
        type: variant.type | 0,
        rotation: variant.rotation | 0,
    }));
}

function runRegression(): void {
    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.NORMAL, 2)),
        [{ type: LocModelType.NORMAL, rotation: 2 }],
        "normal placement passthrough",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.NORMAL_DIAGIONAL, 2)),
        [{ type: LocModelType.NORMAL, rotation: 6 }],
        "normal diagonal remap",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.WALL_CORNER, 1)),
        [
            { type: LocModelType.WALL_CORNER, rotation: 5 },
            { type: LocModelType.WALL_CORNER, rotation: 2 },
        ],
        "wall corner dual variants",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.WALL_DECORATION_INSIDE, 3)),
        [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation: 3 }],
        "wall decoration inside passthrough",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.WALL_DECORATION_OUTSIDE, 3)),
        [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation: 3 }],
        "wall decoration outside remap",
    );

    assert.deepEqual(
        normalize(
            expandLocPlacementModelVariants(LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE, 3),
        ),
        [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation: 7 }],
        "wall decoration diagonal outside remap",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.WALL_DECORATION_DIAGONAL_INSIDE, 3)),
        [{ type: LocModelType.WALL_DECORATION_INSIDE, rotation: 5 }],
        "wall decoration diagonal inside remap",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE, 3)),
        [
            { type: LocModelType.WALL_DECORATION_INSIDE, rotation: 7 },
            { type: LocModelType.WALL_DECORATION_INSIDE, rotation: 5 },
        ],
        "wall decoration diagonal double remap",
    );

    assert.deepEqual(
        normalize(expandLocPlacementModelVariants(LocModelType.FLOOR_DECORATION, 0)),
        [{ type: LocModelType.FLOOR_DECORATION, rotation: 0 }],
        "floor decoration passthrough",
    );
}

async function main(): Promise<void> {
    runRegression();
    console.log("loc-placement-model-variant-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
