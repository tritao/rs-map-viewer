#include "ConfigLoaders.hpp"

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../cache/CacheType.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"

namespace rs {

static constexpr i32 DAT2_INDEX_CONFIGS = 2;
static constexpr i32 DAT2_CONFIG_ARCHIVE_VARBITS = 14;

Result<ConfigLoaders> tryCreateConfigLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept {
    const CacheType cacheType = detectCacheType(cacheInfo);
    if (cacheType != CacheType::Dat2) {
        return Result<ConfigLoaders>::err(Status::Unsupported);
    }

    // Dat2: varbits are stored in configs index (2), archive id 14.
    auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_VARBITS, alloc);
    if (!archRes.isOk()) {
        return Result<ConfigLoaders>::err(archRes.status());
    }
    const Archive archive = rs::move(archRes.value());

    auto vbRes = VarBitTypeLoader::fromArchive(cacheInfo, archive, alloc);
    if (!vbRes.isOk()) {
        return Result<ConfigLoaders>::err(vbRes.status());
    }

    ConfigLoaders out{};
    out.varBits = rs::move(vbRes.value());
    return Result<ConfigLoaders>::ok(rs::move(out));
}

} // namespace rs

