#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"

namespace rs {

struct ConfigLoaders {
    VarBitTypeLoader varBits;
    UnderlayFloorTypeLoader underlays;
    OverlayFloorTypeLoader overlays;
};

// Minimal starting point for the config/loaders port. Extend this struct as we port more config types.
Result<ConfigLoaders> tryCreateConfigLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept;

} // namespace rs
