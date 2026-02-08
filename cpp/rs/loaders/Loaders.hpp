#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Expected.hpp"
#include "../types.hpp"
#include "Dat2Loaders.hpp"
#include "DatLoaders.hpp"
#include "InitError.hpp"
#include "LegacyLoaders.hpp"

namespace rs {

enum class LoadersKind : u8 {
    Legacy = 0,
    Dat = 1,
    Dat2 = 2,
};

// Tagged container mirroring TS `createLoaders` dispatch:
// - `Dat2Loaders` is the fully-featured (current) loader assembly.
// - `DatLoaders` / `LegacyLoaders` currently focus on textures + map sprites.
struct Loaders final {
    LoadersKind kind = LoadersKind::Dat2;

    Dat2Loaders dat2{};
    DatLoaders dat{};
    LegacyLoaders legacy{};

    static Expected<Loaders, InitError> tryCreate(
        const CacheSystem& cacheSystem,
        const CacheInfo& cacheInfo,
        Allocator& alloc) noexcept;
};

} // namespace rs

