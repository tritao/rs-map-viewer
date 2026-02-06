#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"
#include "../config/idktype/IdkTypeLoader.hpp"
#include "../config/enumtype/EnumTypeLoader.hpp"
#include "../config/paramtype/ParamTypeLoader.hpp"
#include "../config/seqtype/SeqTypeLoader.hpp"
#include "../config/spotanimtype/SpotAnimTypeLoader.hpp"

namespace rs {

struct ConfigLoaders {
    VarBitTypeLoader varBits;
    UnderlayFloorTypeLoader underlays;
    OverlayFloorTypeLoader overlays;
    IdkTypeLoader identKits;
    EnumTypeLoader enums;
    ParamTypeLoader params;
    SeqTypeLoader seqs;
    SpotAnimTypeLoader spotAnims;
};

// Minimal starting point for the config/loaders port. Extend this struct as we port more config types.
Result<ConfigLoaders> tryCreateConfigLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept;

} // namespace rs
