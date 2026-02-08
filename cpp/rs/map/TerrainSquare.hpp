#pragma once

#include <cstddef>

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "TerrainConstants.hpp"

namespace rs {

struct TerrainSquare final {
    // Flattened arrays with index order: [level][x][y] (x-major), matching TS loops.
    Vec<i32> tileHeights{};
    Vec<u8> tileRenderFlags{};
    Vec<u16> tileUnderlays{};
    Vec<i16> tileOverlays{};
    Vec<u8> tileShapes{};
    Vec<u8> tileRotations{};

    Result<void> init(Allocator& alloc) noexcept {
        tileHeights = Vec<i32>(alloc);
        tileRenderFlags = Vec<u8>(alloc);
        tileUnderlays = Vec<u16>(alloc);
        tileOverlays = Vec<i16>(alloc);
        tileShapes = Vec<u8>(alloc);
        tileRotations = Vec<u8>(alloc);

        const std::size_t total = static_cast<std::size_t>(TerrainConstants::MAX_LEVELS) *
            static_cast<std::size_t>(TerrainConstants::MAP_SQUARE_SIZE) *
            static_cast<std::size_t>(TerrainConstants::MAP_SQUARE_SIZE);

        auto rr = tileHeights.resize(total);
        if (!rr.isOk()) return rr;
        rr = tileRenderFlags.resize(total);
        if (!rr.isOk()) return rr;
        rr = tileUnderlays.resize(total);
        if (!rr.isOk()) return rr;
        rr = tileOverlays.resize(total);
        if (!rr.isOk()) return rr;
        rr = tileShapes.resize(total);
        if (!rr.isOk()) return rr;
        rr = tileRotations.resize(total);
        if (!rr.isOk()) return rr;
        return Result<void>::ok();
    }

    static constexpr std::size_t idx(i32 level, i32 x, i32 y) noexcept {
        return static_cast<std::size_t>(level) * TerrainConstants::MAP_SQUARE_SIZE * TerrainConstants::MAP_SQUARE_SIZE +
            static_cast<std::size_t>(x) * TerrainConstants::MAP_SQUARE_SIZE +
            static_cast<std::size_t>(y);
    }

    i32& height(i32 level, i32 x, i32 y) noexcept { return tileHeights[idx(level, x, y)]; }
    u8& renderFlags(i32 level, i32 x, i32 y) noexcept { return tileRenderFlags[idx(level, x, y)]; }
    u16& underlay(i32 level, i32 x, i32 y) noexcept { return tileUnderlays[idx(level, x, y)]; }
    i16& overlay(i32 level, i32 x, i32 y) noexcept { return tileOverlays[idx(level, x, y)]; }
    u8& shape(i32 level, i32 x, i32 y) noexcept { return tileShapes[idx(level, x, y)]; }
    u8& rotation(i32 level, i32 x, i32 y) noexcept { return tileRotations[idx(level, x, y)]; }

    const i32& height(i32 level, i32 x, i32 y) const noexcept { return tileHeights[idx(level, x, y)]; }
};

} // namespace rs

