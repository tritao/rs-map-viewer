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
#include "OldConfigLoaders.hpp"

namespace rs {

// High-level loader assembly for Dat caches (pre-dat2), mirroring `src/rs/loaders/DatLoaders.ts`.
//
// NOTE: This is a minimal Dat loader stack: old config types + textures + map sprites.
struct DatLoaders final {
    CacheSession session{};
    OldConfigLoaders configs{};

    // Media sprites from configs index media archive (mapscene.dat + mapfunction.dat).
    Vec<IndexedSprite> mapScenes{};
    Vec<IndexedSprite> mapFunctions{};

    static Expected<DatLoaders, InitError> tryCreate(
        const CacheSystem& cacheSystem,
        const CacheInfo& cacheInfo,
        Allocator& alloc) noexcept;
};

} // namespace rs
