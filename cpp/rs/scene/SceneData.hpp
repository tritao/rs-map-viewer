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

    // Cached placement metadata needed by renderer/debug probes.
    // Size is rotation-adjusted (i.e. already swapped for odd rotations when applicable).
    i32 sizeX = 1;
    i32 sizeY = 1;
    // Mirrors TS `LocType.clipped` after transform resolution.
    i32 clipped = 0;
    // Mirrors TS SceneBuilder `isEntity` decision for this placement (affects occlusion xzRadius usage).
    i32 isEntity = 0;
    // Only set for static model placements where computed (>=0); otherwise -1.
    i32 staticModelXzRadius = -1;
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
    Vec<u8> tileModelPresent{};
    Vec<i16> tileLightValues{};
    // Mirrors TS `Scene.tileLightOcclusions` layout: [level][x][y] with (sizeX+1)*(sizeY+1).
    Vec<u8> tileLightOcclusions{};
    Vec<i32> blendedUnderlayHsl{};

    // Mirrors TS `SceneTile.wallDecoration.offsetX/offsetY` (offsetY maps to our Z axis).
    // These are the final per-tile values after `Scene.updateWallDecorationDisplacement` mutations.
    Vec<i32> tileWallDecorOffsetX{};
    Vec<i32> tileWallDecorOffsetZ{};
    Vec<u8> tileWallDecorPresent{};

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
        tileModelPresent = Vec<u8>(alloc);
        tileLightValues = Vec<i16>(alloc);
        tileLightOcclusions = Vec<u8>(alloc);
        blendedUnderlayHsl = Vec<i32>(alloc);
        tileWallDecorOffsetX = Vec<i32>(alloc);
        tileWallDecorOffsetZ = Vec<i32>(alloc);
        tileWallDecorPresent = Vec<u8>(alloc);
        locPlacements = Vec<SceneLocPlacement>(alloc);

        const std::size_t levelCount = static_cast<std::size_t>(levels);
        const std::size_t tileCount = static_cast<std::size_t>(sizeX) * static_cast<std::size_t>(sizeY);
        const std::size_t heightCount = static_cast<std::size_t>(sizeX + 1) * static_cast<std::size_t>(sizeY + 1);
        const std::size_t occlusionCount = heightCount;

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
        rr = tileModelPresent.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileLightValues.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileLightOcclusions.resize(levelCount * occlusionCount);
        if (!rr.isOk()) return rr;
        rr = blendedUnderlayHsl.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileWallDecorOffsetX.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileWallDecorOffsetZ.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;
        rr = tileWallDecorPresent.resize(levelCount * tileCount);
        if (!rr.isOk()) return rr;

        // The scene build stages only write some fields conditionally (e.g. blended-underlay HSL is only
        // populated for tiles with underlays). Zero/initialize everything so missing data matches TS.
        for (std::size_t i = 0; i < tileHeights.size(); i++) tileHeights[i] = 0;
        for (std::size_t i = 0; i < tileRenderFlags.size(); i++) tileRenderFlags[i] = 0;
        for (std::size_t i = 0; i < tileUnderlays.size(); i++) tileUnderlays[i] = 0;
        for (std::size_t i = 0; i < tileOverlays.size(); i++) tileOverlays[i] = 0;
        for (std::size_t i = 0; i < tileShapes.size(); i++) tileShapes[i] = 0;
        for (std::size_t i = 0; i < tileRotations.size(); i++) tileRotations[i] = 0;
        for (std::size_t i = 0; i < blockedByFloor.size(); i++) blockedByFloor[i] = 0;
        for (std::size_t i = 0; i < tileMinLevels.size(); i++) tileMinLevels[i] = 0;
        for (std::size_t i = 0; i < tileModelPresent.size(); i++) tileModelPresent[i] = 0;
        for (std::size_t i = 0; i < tileLightValues.size(); i++) tileLightValues[i] = 0;
        for (std::size_t i = 0; i < tileLightOcclusions.size(); i++) tileLightOcclusions[i] = 0;
        for (std::size_t i = 0; i < blendedUnderlayHsl.size(); i++) blendedUnderlayHsl[i] = -1;

        for (std::size_t i = 0; i < tileWallDecorPresent.size(); i++) {
            tileWallDecorOffsetX[i] = 0;
            tileWallDecorOffsetZ[i] = 0;
            tileWallDecorPresent[i] = 0;
        }
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

    [[nodiscard]] std::size_t occlusionIdx(i32 level, i32 tileX, i32 tileY) const noexcept {
        // Same indexing as heights: (sizeX+1)*(sizeY+1) per level.
        return heightIdx(level, tileX, tileY);
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

    u8& modelPresent(i32 level, i32 tileX, i32 tileY) noexcept { return tileModelPresent[tileIdx(level, tileX, tileY)]; }
    const u8& modelPresent(i32 level, i32 tileX, i32 tileY) const noexcept { return tileModelPresent[tileIdx(level, tileX, tileY)]; }

    i16& lightValue(i32 level, i32 tileX, i32 tileY) noexcept { return tileLightValues[tileIdx(level, tileX, tileY)]; }
    const i16& lightValue(i32 level, i32 tileX, i32 tileY) const noexcept { return tileLightValues[tileIdx(level, tileX, tileY)]; }

    u8& lightOcclusion(i32 level, i32 tileX, i32 tileY) noexcept { return tileLightOcclusions[occlusionIdx(level, tileX, tileY)]; }
    const u8& lightOcclusion(i32 level, i32 tileX, i32 tileY) const noexcept { return tileLightOcclusions[occlusionIdx(level, tileX, tileY)]; }

    i32& blendedUnderlay(i32 level, i32 tileX, i32 tileY) noexcept { return blendedUnderlayHsl[tileIdx(level, tileX, tileY)]; }
    const i32& blendedUnderlay(i32 level, i32 tileX, i32 tileY) const noexcept { return blendedUnderlayHsl[tileIdx(level, tileX, tileY)]; }

    u8& wallDecorPresent(i32 level, i32 tileX, i32 tileY) noexcept { return tileWallDecorPresent[tileIdx(level, tileX, tileY)]; }
    const u8& wallDecorPresent(i32 level, i32 tileX, i32 tileY) const noexcept { return tileWallDecorPresent[tileIdx(level, tileX, tileY)]; }

    i32& wallDecorOffsetX(i32 level, i32 tileX, i32 tileY) noexcept { return tileWallDecorOffsetX[tileIdx(level, tileX, tileY)]; }
    const i32& wallDecorOffsetX(i32 level, i32 tileX, i32 tileY) const noexcept { return tileWallDecorOffsetX[tileIdx(level, tileX, tileY)]; }

    i32& wallDecorOffsetZ(i32 level, i32 tileX, i32 tileY) noexcept { return tileWallDecorOffsetZ[tileIdx(level, tileX, tileY)]; }
    const i32& wallDecorOffsetZ(i32 level, i32 tileX, i32 tileY) const noexcept { return tileWallDecorOffsetZ[tileIdx(level, tileX, tileY)]; }

    [[nodiscard]] Allocator& allocator() noexcept { return *alloc_; }
    [[nodiscard]] const Allocator& allocator() const noexcept { return *alloc_; }

private:
    Allocator* alloc_ = nullptr;
};

} // namespace rs
