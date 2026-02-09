#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheType.hpp"
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
    struct Capabilities final {
        CacheType cacheType = CacheType::Dat2;
        bool hasQuestTypeLoader = false;
        bool hasSkeletalSeqLoader = false;
        bool hasDistinctUnderlayTypeLoader = false;
    };

    LoadersKind kind = LoadersKind::Dat2;
    Capabilities capabilities{};

    Dat2Loaders dat2{};
    DatLoaders dat{};
    LegacyLoaders legacy{};

    [[nodiscard]] const CacheSession* tryGetSession() const noexcept {
        switch (kind) {
            case LoadersKind::Dat2: return &dat2.session;
            case LoadersKind::Dat: return &dat.session;
            case LoadersKind::Legacy: return &legacy.session;
        }
        return nullptr;
    }

    static Capabilities capabilitiesFor(const CacheSession& session) noexcept;

    static Expected<Loaders, InitError> tryCreate(
        const CacheSystem& cacheSystem,
        const CacheInfo& cacheInfo,
        Allocator& alloc) noexcept;
};

} // namespace rs
