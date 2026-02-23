#pragma once

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

struct SceneData;
struct UnderlayFloorType;
struct OverlayFloorType;

struct TerrainTileSample final {
    bool hasOverlay = false;
    bool useOverlayEdgeHsls = false;

    i32 underlayTexturePacked = -1;
    i32 underlayTextureSize = 128;

    i32 underlayBlendSw = -1;
    i32 underlayBlendSe = -1;
    i32 underlayBlendNe = -1;
    i32 underlayBlendNw = -1;

    i32 overlayCornerBaseHsl[4] = {-1, -1, -1, -1};
    i32 overlayEdgeBaseHsl[4] = {-1, -1, -1, -1};
    i32 overlayCornerTexturePacked[4] = {-1, -1, -1, -1};
    i32 overlayCornerTextureSize[4] = {128, 128, 128, 128};
    i32 overlayEdgeTexturePacked[4] = {-1, -1, -1, -1};
    i32 overlayEdgeTextureSize[4] = {128, 128, 128, 128};
};

struct TerrainTypeProvider final {
    void* ctx = nullptr;

    Status (*tryLoadUnderlay)(void* ctx, i32 underlayIdMinusOne, const UnderlayFloorType** out) noexcept = nullptr;
    Status (*tryLoadOverlay)(void* ctx, i32 overlayIdMinusOne, const OverlayFloorType** out) noexcept = nullptr;
};

Status sampleTerrainTile(
    const SceneData& scene,
    i32 cacheGame,
    i32 cacheRevision,
    Span<const i32> textureIds,
    const TerrainTypeProvider& provider,
    i32 level,
    i32 x,
    i32 y,
    bool smoothUnderlays,
    TerrainTileSample* out) noexcept;

} // namespace rs
