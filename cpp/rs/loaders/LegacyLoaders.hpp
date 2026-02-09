#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Expected.hpp"
#include "../core/Vec.hpp"
#include "../sprite/IndexedSprite.hpp"
#include "../types.hpp"
#include "CacheSession.hpp"
#include "InitError.hpp"

namespace rs {

// High-level loader assembly for Legacy caches (very old, pre-dat), mirroring `src/rs/loaders/LegacyLoaders.ts`.
//
// NOTE: This is a minimal Legacy loader stack: textures + map sprites.
// Configs are provided through `session.config` (tagged by cache layout).
struct LegacyLoaders final {
    CacheSession session{};

    // Media sprites from media index archive 0 (mapscene.dat + mapfunction.dat).
    Vec<IndexedSprite> mapScenes{};
    Vec<IndexedSprite> mapFunctions{};

    static Expected<LegacyLoaders, InitError> tryCreate(
        const CacheSystem& cacheSystem,
        const CacheInfo& cacheInfo,
        Allocator& alloc) noexcept;
};

} // namespace rs
