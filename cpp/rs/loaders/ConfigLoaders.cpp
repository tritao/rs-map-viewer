#include "ConfigLoaders.hpp"

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../cache/CacheType.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/bastype/BasTypeLoader.hpp"
#include "../config/enumtype/EnumTypeLoader.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"
#include "../config/invtype/InvTypeLoader.hpp"
#include "../config/idktype/IdkTypeLoader.hpp"
#include "../config/loctype/LocTypeLoader.hpp"
#include "../config/mapscenetype/MapSceneTypeLoader.hpp"
#include "../config/meltype/MapElementTypeLoader.hpp"
#include "../config/npctype/NpcTypeLoader.hpp"
#include "../config/objtype/ObjTypeLoader.hpp"
#include "../config/paramtype/ParamTypeLoader.hpp"
#include "../config/questtype/QuestTypeLoader.hpp"
#include "../config/seqtype/SeqTypeLoader.hpp"
#include "../config/spotanimtype/SpotAnimTypeLoader.hpp"
#include "../config/structtype/StructTypeLoader.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"

namespace rs {

static constexpr i32 DAT2_INDEX_CONFIGS = 2;
static constexpr i32 DAT2_CONFIG_ARCHIVE_UNDERLAYS = 1;
static constexpr i32 DAT2_CONFIG_ARCHIVE_IDENTKITS = 3;
static constexpr i32 DAT2_CONFIG_ARCHIVE_OVERLAYS = 4;
static constexpr i32 DAT2_CONFIG_ARCHIVE_INV = 5;
static constexpr i32 DAT2_CONFIG_ARCHIVE_LOCS = 6;
static constexpr i32 DAT2_CONFIG_ARCHIVE_ENUMS = 8;
static constexpr i32 DAT2_CONFIG_ARCHIVE_NPCS = 9;
static constexpr i32 DAT2_CONFIG_ARCHIVE_OBJS = 10;
static constexpr i32 DAT2_CONFIG_ARCHIVE_PARAMS = 11;
static constexpr i32 DAT2_CONFIG_ARCHIVE_SEQS = 12;
static constexpr i32 DAT2_CONFIG_ARCHIVE_SPOTANIMS = 13;
static constexpr i32 DAT2_CONFIG_ARCHIVE_VARBITS = 14;

static constexpr i32 RS2_CONFIG_ARCHIVE_BAS = 32;
static constexpr i32 OSRS_CONFIG_ARCHIVE_STRUCT = 34;
static constexpr i32 RS2_CONFIG_ARCHIVE_MAPSCENES = 34;
static constexpr i32 OSRS_CONFIG_ARCHIVE_MAPFUNCTIONS = 35;
static constexpr i32 RS2_CONFIG_ARCHIVE_QUESTS = 35;
static constexpr i32 RS2_CONFIG_ARCHIVE_MAPFUNCTIONS = 36;

template <typename Loader>
static Status loadOptionalArchiveLoader(
    const CacheSystem& cacheSystem,
    const CacheInfo& cacheInfo,
    Allocator& alloc,
    i32 indexId,
    i32 archiveId,
    Loader* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    auto archRes = cacheSystem.getArchive(indexId, archiveId, alloc);
    if (!archRes.isOk()) {
        if (archRes.status() == Status::NotFound) {
            *out = Loader{};
            return Status::Ok;
        }
        return archRes.status();
    }
    const Archive archive = rs::move(archRes.value());
    auto r = Loader::fromArchive(cacheInfo, archive, alloc);
    if (!r.isOk()) {
        return r.status();
    }
    *out = rs::move(r.value());
    return Status::Ok;
}

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
        // Dat2: inv types are stored in configs index (2), archive id 5.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_INV, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = InvTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.invs = rs::move(r.value());
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
        // Dat2: loc types are stored in configs index (2), archive id 6.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_LOCS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = LocTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.locs = rs::move(r.value());
    }

    {
        // Dat2: npc types are stored in configs index (2), archive id 9.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_NPCS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = NpcTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.npcs = rs::move(r.value());
    }

    {
        // Dat2: obj types are stored in configs index (2), archive id 10.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, DAT2_CONFIG_ARCHIVE_OBJS, alloc);
        if (!archRes.isOk()) {
            return Result<ConfigLoaders>::err(archRes.status());
        }
        const Archive archive = rs::move(archRes.value());

        auto r = ObjTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Result<ConfigLoaders>::err(r.status());
        }
        out.objs = rs::move(r.value());
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

    // Optional extras: archive ids vary by game type, but we can pick safely for the primary cases.
    {
        const Status s = loadOptionalArchiveLoader(cacheSystem, cacheInfo, alloc, DAT2_INDEX_CONFIGS, RS2_CONFIG_ARCHIVE_BAS, &out.bas);
        if (!ok(s)) {
            return Result<ConfigLoaders>::err(s);
        }
    }

    if (cacheInfo.game == GameType::Oldschool) {
        const Status sStruct = loadOptionalArchiveLoader(cacheSystem, cacheInfo, alloc, DAT2_INDEX_CONFIGS, OSRS_CONFIG_ARCHIVE_STRUCT, &out.structs);
        if (!ok(sStruct)) {
            return Result<ConfigLoaders>::err(sStruct);
        }
        const Status sMf = loadOptionalArchiveLoader(cacheSystem, cacheInfo, alloc, DAT2_INDEX_CONFIGS, OSRS_CONFIG_ARCHIVE_MAPFUNCTIONS, &out.mapFunctions);
        if (!ok(sMf)) {
            return Result<ConfigLoaders>::err(sMf);
        }
    } else {
        const Status sScenes = loadOptionalArchiveLoader(cacheSystem, cacheInfo, alloc, DAT2_INDEX_CONFIGS, RS2_CONFIG_ARCHIVE_MAPSCENES, &out.mapScenes);
        if (!ok(sScenes)) {
            return Result<ConfigLoaders>::err(sScenes);
        }
        const Status sQuests = loadOptionalArchiveLoader(cacheSystem, cacheInfo, alloc, DAT2_INDEX_CONFIGS, RS2_CONFIG_ARCHIVE_QUESTS, &out.quests);
        if (!ok(sQuests)) {
            return Result<ConfigLoaders>::err(sQuests);
        }
        const Status sMf = loadOptionalArchiveLoader(cacheSystem, cacheInfo, alloc, DAT2_INDEX_CONFIGS, RS2_CONFIG_ARCHIVE_MAPFUNCTIONS, &out.mapFunctions);
        if (!ok(sMf)) {
            return Result<ConfigLoaders>::err(sMf);
        }
    }

    return Result<ConfigLoaders>::ok(rs::move(out));
}

} // namespace rs
