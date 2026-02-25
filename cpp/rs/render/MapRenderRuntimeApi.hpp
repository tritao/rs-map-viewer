#pragma once

#include "../types.hpp"

namespace rs::maprender {

struct RuntimeBuildConfigApplied final {
    i32 cacheGame = 0;
    i32 cacheRevision = 0;
    i32 sceneLevels = 0;
    i32 unitsTileHeightBasis = 0;
    bool cacheIdentityChanged = false;
};

inline i32 normalizeSceneLevels(const i32 sceneLevels, const i32 fallbackSceneLevels) noexcept {
    return sceneLevels > 0 ? sceneLevels : fallbackSceneLevels;
}

inline i32 normalizeUnitsTileHeightBasis(
    const i32 unitsTileHeightBasis,
    const i32 fallbackUnitsTileHeightBasis) noexcept {
    return unitsTileHeightBasis > 0 ? unitsTileHeightBasis : fallbackUnitsTileHeightBasis;
}

inline RuntimeBuildConfigApplied applyRuntimeBuildConfig(
    const i32 currentCacheGame,
    const i32 currentCacheRevision,
    const i32 cacheGame,
    const i32 cacheRevision,
    const i32 sceneLevels,
    const i32 unitsTileHeightBasis,
    const i32 fallbackSceneLevels,
    const i32 fallbackUnitsTileHeightBasis) noexcept {
    RuntimeBuildConfigApplied out{};
    out.cacheGame = cacheGame;
    out.cacheRevision = cacheRevision;
    out.sceneLevels = normalizeSceneLevels(sceneLevels, fallbackSceneLevels);
    out.unitsTileHeightBasis = normalizeUnitsTileHeightBasis(
        unitsTileHeightBasis,
        fallbackUnitsTileHeightBasis);
    out.cacheIdentityChanged =
        currentCacheGame != cacheGame || currentCacheRevision != cacheRevision;
    return out;
}

} // namespace rs::maprender
