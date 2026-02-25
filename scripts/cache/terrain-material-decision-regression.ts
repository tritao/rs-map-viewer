import assert from "node:assert/strict";

import {
    type TerrainTileMaterialDecisionParams,
    computeTerrainTileMaterialDecision,
} from "../../src/rs/scene/computeSceneTileModel";
import { HSL_RGB_MAP, adjustOverlayLight, packHsl } from "../../src/rs/util/ColorUtil";

function makeParams(
    overrides: Partial<TerrainTileMaterialDecisionParams>,
): TerrainTileMaterialDecisionParams {
    const underlayTypeLoader = {
        tryLoad(id: number) {
            if (id === 1) {
                return { ok: true as const, value: { textureId: 9, textureSize: 64 } };
            }
            if (id === 2) {
                return { ok: true as const, value: { textureId: 12, textureSize: 32 } };
            }
            return { ok: false as const };
        },
    };

    const overlayTypeLoader = {
        tryLoad(id: number) {
            if (id === 10) {
                return {
                    ok: true as const,
                    value: {
                        textureId: 3,
                        primaryRgb: 0,
                        hue: 10,
                        saturation: 20,
                        lightness: 30,
                        secondaryRgb: -1,
                        secondaryHue: 0,
                        secondarySaturation: 0,
                        secondaryLightness: 0,
                    },
                };
            }
            if (id === 11) {
                return {
                    ok: true as const,
                    value: {
                        textureId: -1,
                        primaryRgb: 0,
                        hue: 30,
                        saturation: 40,
                        lightness: 50,
                        secondaryRgb: 0x123456,
                        secondaryHue: 60,
                        secondarySaturation: 70,
                        secondaryLightness: 80,
                    },
                };
            }
            return { ok: false as const };
        },
    };

    const textureLoader = {
        isSd(textureId: number) {
            return textureId === 3 || textureId === 9;
        },
        getAverageHsl(textureId: number) {
            return textureId === 3 ? 120 : 0;
        },
    };

    return {
        underlayId: -1,
        overlayId: -1,
        underlayTypeLoader: underlayTypeLoader as any,
        overlayTypeLoader: overlayTypeLoader as any,
        textureLoader: textureLoader as any,
        ...overrides,
    };
}

function runRegression(): void {
    assert.deepEqual(
        computeTerrainTileMaterialDecision(makeParams({})),
        {
            underlayTextureId: -1,
            underlayTextureSize: 128,
            overlayRgb: 0,
            hasOverlay: false,
        },
        "empty underlay/overlay",
    );

    assert.deepEqual(
        computeTerrainTileMaterialDecision(makeParams({ underlayId: 1 })),
        {
            underlayTextureId: 9,
            underlayTextureSize: 64,
            overlayRgb: 0,
            hasOverlay: false,
        },
        "underlay sd texture selected",
    );

    assert.deepEqual(
        computeTerrainTileMaterialDecision(makeParams({ underlayId: 2 })),
        {
            underlayTextureId: -1,
            underlayTextureSize: 128,
            overlayRgb: 0,
            hasOverlay: false,
        },
        "underlay non-sd texture ignored",
    );

    const expectedOverlayFromTexture = HSL_RGB_MAP[adjustOverlayLight(120, 96)];
    assert.deepEqual(
        computeTerrainTileMaterialDecision(makeParams({ underlayId: 1, overlayId: 10 })),
        {
            underlayTextureId: 9,
            underlayTextureSize: 64,
            overlayRgb: expectedOverlayFromTexture,
            hasOverlay: true,
        },
        "overlay rgb from texture average hsl",
    );

    const expectedOverlayFromSecondary = HSL_RGB_MAP[adjustOverlayLight(packHsl(60, 70, 80), 96)];
    assert.deepEqual(
        computeTerrainTileMaterialDecision(makeParams({ underlayId: 1, overlayId: 11 })),
        {
            underlayTextureId: 9,
            underlayTextureSize: 64,
            overlayRgb: expectedOverlayFromSecondary,
            hasOverlay: true,
        },
        "overlay secondary color overrides base",
    );

    const expectedOverlayFromCorners = HSL_RGB_MAP[adjustOverlayLight(40, 96)];
    assert.deepEqual(
        computeTerrainTileMaterialDecision(
            makeParams({
                underlayId: 1,
                overlayId: 10,
                overlayPrimaryCorners: {
                    minimapHsl: new Int32Array([20, 60, -2, -2]),
                } as any,
            }),
        ),
        {
            underlayTextureId: 9,
            underlayTextureSize: 64,
            overlayRgb: expectedOverlayFromCorners,
            hasOverlay: true,
        },
        "overlay corners minimap hsl average",
    );

    assert.deepEqual(
        computeTerrainTileMaterialDecision(makeParams({ underlayId: 1, overlayId: 999 })),
        {
            underlayTextureId: 9,
            underlayTextureSize: 64,
            overlayRgb: 0,
            hasOverlay: false,
        },
        "missing overlay falls back to underlay-only",
    );
}

async function main(): Promise<void> {
    runRegression();
    console.log("terrain-material-decision-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
