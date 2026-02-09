#pragma once

#include <cstddef>

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

enum class SceneTileRenderFlag : u8 {
    Blocked = 0x1,
    Bridge = 0x2,
    Inside = 0x4,
    RenderOnLowerLevel = 0x8,
    ExcludeFromPlayerLevel = 0x10,
    Unknown0x20 = 0x20,
};

struct SceneLocPlacement final {
    i32 originalId = -1;
    i32 resolvedId = -1;
    i32 level = 0;
    i32 tileX = 0;
    i32 tileY = 0;
    i32 type = 0;
    i32 rotation = 0;
};

struct SceneData final {
    i32 levels = 0;
    i32 sizeX = 0;
    i32 sizeY = 0;

    // [level][x][y], with x/y spans matching TS: heights use (sizeX+1)*(sizeY+1), others use sizeX*sizeY.
    Vec<i32> tileHeights{};
    Vec<u8> tileRenderFlags{};
    Vec<u16> tileUnderlays{};
    Vec<i16> tileOverlays{};
    Vec<u8> tileShapes{};
    Vec<u8> tileRotations{};

    // Terrain collision and post-finalize metadata.
    Vec<u8> blockedByFloor{};
    Vec<u8> tileMinLevels{};

    Vec<SceneLocPlacement> locPlacements{};

    Result<void> init(i32 levels_, i32 sizeX_, i32 sizeY_, Allocator& alloc) noexcept {
        if (levels_ <= 0 || sizeX_ < 0 || sizeY_ < 0) {
            return Result<void>::err(Status::InvalidArgument);
        }
        levels = levels_;
        sizeX = sizeX_;
        sizeY = sizeY_;
        alloc_ = &alloc;

        tileHeights = Vec<i32>(alloc);
        tileRenderFlags = Vec<u8>(alloc);
        tileUnderlays = Vec<u16>(alloc);
        tileOverlays = Vec<i16>(alloc);
        tileShapes = Vec<u8>(alloc);
        tileRotations = Vec<u8>(alloc);
        blockedByFloor = Vec<u8>(alloc);
        tileMinLevels = Vec<u8>(alloc);
        locPlacements = Vec<SceneLocPlacement>(alloc);

        const std::size_t levelCount = static_cast<std::size_t>(levels);
        const std::size_t tileCount = static_cast<std::size_t>(sizeX) * static_cast<std::size_t>(sizeY);
        const std::size_t heightCount = static_cast<std::size_t>(sizeX + 1) * static_cast<std::size_t>(sizeY + 1);

        auto rr = tileHeights.resize(levelCount * heightCount);
        if (!rr.isOk()) return rr;
        rr = tileRenderFlags.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileUnderlays.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileOverlays.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileShapes.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileRotations.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = blockedByFloor.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileMinLevels.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        return Result<void>::ok();
    }

    [[nodiscard]] bool isWithinBounds(i32 level, i32 tileX, i32 tileY) const noexcept {
        return (
            level >= 0 &&
            level < levels &&
            tileX >= 0 &&
            tileX < sizeX &&
            tileY >= 0 &&
            tileY < sizeY
        );
    }

    [[nodiscard]] std::size_t tileIdx(i32 level, i32 tileX, i32 tileY) const noexcept {
        return static_cast<std::size_t>(level) * static_cast<std::size_t>(sizeX) * static_cast<std::size_t>(sizeY) +
            static_cast<std::size_t>(tileX) * static_cast<std::size_t>(sizeY) +
            static_cast<std::size_t>(tileY);
    }

    [[nodiscard]] std::size_t heightIdx(i32 level, i32 tileX, i32 tileY) const noexcept {
        const std::size_t row = static_cast<std::size_t>(sizeY + 1);
        const std::size_t plane = static_cast<std::size_t>(sizeX + 1) * row;
        return static_cast<std::size_t>(level) * plane +
            static_cast<std::size_t>(tileX) * row +
            static_cast<std::size_t>(tileY);
    }

    i32& height(i32 level, i32 tileX, i32 tileY) noexcept { return tileHeights[heightIdx(level, tileX, tileY)]; }
    const i32& height(i32 level, i32 tileX, i32 tileY) const noexcept { return tileHeights[heightIdx(level, tileX, tileY)]; }

    u8& renderFlag(i32 level, i32 tileX, i32 tileY) noexcept { return tileRenderFlags[tileIdx(level, tileX, tileY)]; }
    const u8& renderFlag(i32 level, i32 tileX, i32 tileY) const noexcept { return tileRenderFlags[tileIdx(level, tileX, tileY)]; }

    u16& underlay(i32 level, i32 tileX, i32 tileY) noexcept { return tileUnderlays[tileIdx(level, tileX, tileY)]; }
    const u16& underlay(i32 level, i32 tileX, i32 tileY) const noexcept { return tileUnderlays[tileIdx(level, tileX, tileY)]; }

    i16& overlay(i32 level, i32 tileX, i32 tileY) noexcept { return tileOverlays[tileIdx(level, tileX, tileY)]; }
    const i16& overlay(i32 level, i32 tileX, i32 tileY) const noexcept { return tileOverlays[tileIdx(level, tileX, tileY)]; }

    u8& shape(i32 level, i32 tileX, i32 tileY) noexcept { return tileShapes[tileIdx(level, tileX, tileY)]; }
    const u8& shape(i32 level, i32 tileX, i32 tileY) const noexcept { return tileShapes[tileIdx(level, tileX, tileY)]; }

    u8& rotation(i32 level, i32 tileX, i32 tileY) noexcept { return tileRotations[tileIdx(level, tileX, tileY)]; }
    const u8& rotation(i32 level, i32 tileX, i32 tileY) const noexcept { return tileRotations[tileIdx(level, tileX, tileY)]; }

    u8& blocked(i32 level, i32 tileX, i32 tileY) noexcept { return blockedByFloor[tileIdx(level, tileX, tileY)]; }
    const u8& blocked(i32 level, i32 tileX, i32 tileY) const noexcept { return blockedByFloor[tileIdx(level, tileX, tileY)]; }

    u8& minLevel(i32 level, i32 tileX, i32 tileY) noexcept { return tileMinLevels[tileIdx(level, tileX, tileY)]; }
    const u8& minLevel(i32 level, i32 tileX, i32 tileY) const noexcept { return tileMinLevels[tileIdx(level, tileX, tileY)]; }

    [[nodiscard]] Allocator& allocator() noexcept { return *alloc_; }

private:
    Allocator* alloc_ = nullptr;
};

} // namespace rs
