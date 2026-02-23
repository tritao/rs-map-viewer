#pragma once

#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

struct SceneCommandStream;
struct SceneData;

inline constexpr i32 kTerrainTileSize = 128;

void computeOverlayEdgeEligibility(
    i32 shapeRaw,
    i32 rotation,
    bool blendable,
    bool outWorld[4]) noexcept;

i32 adjustUnderlayLight(i32 hsl, i32 light) noexcept;

i32 adjustOverlayLight(i32 hsl, i32 light) noexcept;

i32 mixHsl(i32 hslA, i32 hslB) noexcept;

// Emits terrain faces for a single tile (shape+rotation already resolved).
Status appendTerrainTileGeometry(
    const SceneData& scene,
    i32 level,
    i32 x,
    i32 y,
    i32 vertexOffset,
    i32 shapeId,
    i32 rotation,
    bool hasOverlay,
    bool hasUnderlay,
    i32 underlayHslSw,
    i32 underlayHslSe,
    i32 underlayHslNe,
    i32 underlayHslNw,
    i32 overlayHslSw,
    i32 overlayHslSe,
    i32 overlayHslNe,
    i32 overlayHslNw,
    i32 overlayHslSAvg,
    i32 overlayHslEAvg,
    i32 overlayHslNAvg,
    i32 overlayHslWAvg,
    bool useOverlayEdgeHsls,
    i32 underlayTexturePacked,
    i32 underlayTextureSize,
    const i32* overlayCornerTexturePacked,
    const i32* overlayCornerTextureSize,
    const i32* overlayEdgeTexturePacked,
    const i32* overlayEdgeTextureSize,
    bool* outFaceColorsAAllValid,
    SceneCommandStream* debugOut,
    Vec<u8>* outVertices,
    Vec<i32>* outIndices,
    i32* outLevelElements) noexcept;

} // namespace rs
