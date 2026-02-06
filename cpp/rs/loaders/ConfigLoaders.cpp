#include "ConfigLoaders.hpp"

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../cache/CacheType.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/enumtype/EnumTypeLoader.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"
#include "../config/idktype/IdkTypeLoader.hpp"
#include "../config/paramtype/ParamTypeLoader.hpp"
#include "../config/seqtype/SeqTypeLoader.hpp"
#include "../config/spotanimtype/SpotAnimTypeLoader.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"

namespace rs {

static constexpr i32 DAT2_INDEX_CONFIGS = 2;
static constexpr i32 DAT2_CONFIG_ARCHIVE_UNDERLAYS = 1;
static constexpr i32 DAT2_CONFIG_ARCHIVE_IDENTKITS = 3;
static constexpr i32 DAT2_CONFIG_ARCHIVE_OVERLAYS = 4;
static constexpr i32 DAT2_CONFIG_ARCHIVE_ENUMS = 8;
static constexpr i32 DAT2_CONFIG_ARCHIVE_PARAMS = 11;
static constexpr i32 DAT2_CONFIG_ARCHIVE_SEQS = 12;
static constexpr i32 DAT2_CONFIG_ARCHIVE_SPOTANIMS = 13;
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
        // Dat2: identity kits are stored in configs index (2), archive id 3.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_IDENTKITS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = IdkTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.identKits = rs::move(r.value());
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
        // Dat2: enums are stored in configs index (2), archive id 8.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_ENUMS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = EnumTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.enums = rs::move(r.value());
    }

    {
        // Dat2: params are stored in configs index (2), archive id 11.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_PARAMS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = ParamTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.params = rs::move(r.value());
    }

    {
        // Dat2: sequences are stored in configs index (2), archive id 12.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_SEQS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = SeqTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.seqs = rs::move(r.value());
    }

    {
        // Dat2: spot animations are stored in configs index (2), archive id 13.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_SPOTANIMS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = SpotAnimTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.spotAnims = rs::move(r.value());
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
