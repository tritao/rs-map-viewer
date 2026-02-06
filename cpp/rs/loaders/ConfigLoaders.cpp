#include "ConfigLoaders.hpp"

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../cache/CacheType.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"

namespace rs {

static constexpr i32 DAT2_INDEX_CONFIGS = 2;
static constexpr i32 DAT2_CONFIG_ARCHIVE_UNDERLAYS = 1;
static constexpr i32 DAT2_CONFIG_ARCHIVE_OVERLAYS = 4;
static constexpr i32 DAT2_CONFIG_ARCHIVE_VARBITS = 14;

Result<ConfigLoaders> tryCreateConfigLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept {
    const CacheType cacheType = detectCacheType(cacheInfo);
    if (cacheType != CacheType::Dat2) {
        return Result<ConfigLoaders>::err(Status::Unsupported);
    }

    ConfigLoaders out{};

    {
        // Dat2: underlays are stored in configs index (2), archive id 1.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_UNDERLAYS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = UnderlayFloorTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.underlays = rs::move(r.value());
    }

    {
        // Dat2: overlays are stored in configs index (2), archive id 4.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_OVERLAYS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = OverlayFloorTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.overlays = rs::move(r.value());
    }

    {
        // Dat2: varbits are stored in configs index (2), archive id 14.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_VARBITS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = VarBitTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.varBits = rs::move(r.value());
    }

    return Result<ConfigLoaders>::ok(rs::move(out));
}

} // namespace rs
