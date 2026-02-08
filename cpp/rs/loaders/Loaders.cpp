#include "Loaders.hpp"

#include "../cache/CacheInfo.hpp"
#include "../core/Move.hpp"

namespace rs {

Expected<Loaders, InitError> Loaders::tryCreate(
    const CacheSystem& cacheSystem,
    const CacheInfo& cacheInfo,
    Allocator& alloc) noexcept {
    const CacheType cacheType = detectCacheType(cacheInfo);

    Loaders out{};

    if (cacheType == CacheType::Dat2) {
        auto r = Dat2Loaders::tryCreate(cacheSystem, cacheInfo, alloc);
        if (!r.isOk()) {
            return Expected<Loaders, InitError>::err(rs::move(r.error()));
        }
        out.kind = LoadersKind::Dat2;
        out.dat2 = rs::move(r.value());
        return Expected<Loaders, InitError>::ok(rs::move(out));
    }

    if (cacheType == CacheType::Dat) {
        auto r = DatLoaders::tryCreate(cacheSystem, cacheInfo, alloc);
        if (!r.isOk()) {
            return Expected<Loaders, InitError>::err(rs::move(r.error()));
        }
        out.kind = LoadersKind::Dat;
        out.dat = rs::move(r.value());
        return Expected<Loaders, InitError>::ok(rs::move(out));
    }

    if (cacheType == CacheType::Legacy) {
        auto r = LegacyLoaders::tryCreate(cacheSystem, cacheInfo, alloc);
        if (!r.isOk()) {
            return Expected<Loaders, InitError>::err(rs::move(r.error()));
        }
        out.kind = LoadersKind::Legacy;
        out.legacy = rs::move(r.value());
        return Expected<Loaders, InitError>::ok(rs::move(out));
    }

    return Expected<Loaders, InitError>::err(InitError::unsupported("Loaders::tryCreate: unsupported cache type"));
}

} // namespace rs

