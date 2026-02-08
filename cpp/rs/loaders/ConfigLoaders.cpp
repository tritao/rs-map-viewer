#include "ConfigLoaders.hpp"

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../cache/CacheType.hpp"
#include "../cache/ConfigArchiveId.hpp"
#include "../cache/IndexId.hpp"
#include "../core/Allocator.hpp"
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
#include "CacheRules.hpp"

namespace rs {

static constexpr i32 DAT2_INDEX_CONFIGS = static_cast<i32>(Dat2IndexId::configs);

template <typename Loader>
static Expected<void, InitError> loadOptionalArchiveLoader(
    const CacheSystem& cacheSystem,
    const CacheInfo& cacheInfo,
    Allocator& alloc,
    i32 indexId,
    i32 archiveId,
    const char* ctx,
    Loader* out) noexcept {
    if (!out) {
        return Expected<void, InitError>::err(InitError::invalidArgument(ctx));
    }
    auto archRes = cacheSystem.getArchive(indexId, archiveId, alloc);
    if (!archRes.isOk()) {
        if (archRes.status() == Status::NotFound) {
            *out = Loader{};
            return Expected<void, InitError>::ok();
        }
        return Expected<void, InitError>::err(InitError::missingArchive(indexId, archiveId, archRes.status(), ctx));
    }
    const Archive archive = rs::move(archRes.value());
    auto r = Loader::fromArchive(cacheInfo, archive, alloc);
    if (!r.isOk()) {
        return Expected<void, InitError>::err(InitError::decodeFailed(r.status(), ctx));
    }
    *out = rs::move(r.value());
    return Expected<void, InitError>::ok();
}

Expected<ConfigLoaders, InitError> tryCreateConfigLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept {
    const CacheType cacheType = detectCacheType(cacheInfo);
    if (cacheType != CacheType::Dat2) {
        return Expected<ConfigLoaders, InitError>::err(InitError::unsupported("config loaders only support dat2 layout"));
    }

    const CacheRules rules = computeCacheRules(cacheInfo, cacheSystem);

    ConfigLoaders out{};

    {
        // Dat2: underlays are stored in configs index (2), archive id 1.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::underlays), alloc);
        if (!archRes.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(
                InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::underlays), archRes.status(), "underlays"));
        }
        const Archive archive = rs::move(archRes.value());

        auto r = UnderlayFloorTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "underlays decode"));
        }
        out.underlays = rs::move(r.value());
    }

    {
        // Dat2: identity kits are stored in configs index (2), archive id 3.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::identkits), alloc);
        if (!archRes.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(
                InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::identkits), archRes.status(), "identkits"));
        }
        const Archive archive = rs::move(archRes.value());

        auto r = IdkTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "identkits decode"));
        }
        out.identKits = rs::move(r.value());
    }

    {
        // Dat2: overlays are stored in configs index (2), archive id 4.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::overlays), alloc);
        if (!archRes.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(
                InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::overlays), archRes.status(), "overlays"));
        }
        const Archive archive = rs::move(archRes.value());

        auto r = OverlayFloorTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "overlays decode"));
        }
        out.overlays = rs::move(r.value());
    }

    {
        // Dat2: inv types are stored in configs index (2), archive id 5.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::inv), alloc);
        if (!archRes.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(
                InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::inv), archRes.status(), "inv"));
        }
        const Archive archive = rs::move(archRes.value());

        auto r = InvTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "inv decode"));
        }
        out.invs = rs::move(r.value());
    }

    {
        // Dat2: enums are typically stored in configs index (2), archive id 8, but some RS2 revisions use index 17.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::enums), alloc);
        if (!archRes.isOk()) {
            if (archRes.status() != Status::NotFound) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::enums), archRes.status(), "enums"));
            }
            out.enums = EnumTypeLoader{};
        } else {
            const Archive archive = rs::move(archRes.value());
            auto r = EnumTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "enums decode"));
            }
            out.enums = rs::move(r.value());
        }
    }

    {
        if (rules.isIndexConfigs) {
            // RS2 (488+): loc types are stored in index id 16, typeId = (archiveId<<8)|fileId.
            const CacheIndex* index = nullptr;
            const Status s = cacheSystem.getIndex(static_cast<i32>(Rs2IndexId::locs), &index);
            if (!ok(s) || !index) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingIndex(static_cast<i32>(Rs2IndexId::locs), ok(s) ? Status::NotFound : s, "locs index"));
            }
            auto r = LocTypeLoader::fromIndex(cacheInfo, *index, 8, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "locs decode"));
            }
            out.locs = rs::move(r.value());
        } else {
            // Dat2: loc types are stored in configs index (2), archive id 6.
            auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::locs), alloc);
            if (!archRes.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::locs), archRes.status(), "locs"));
            }
            const Archive archive = rs::move(archRes.value());

            auto r = LocTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "locs decode"));
            }
            out.locs = rs::move(r.value());
        }
    }

    {
        if (rules.isIndexConfigs) {
            // RS2 (488+): npc types are stored in index id 18, typeId = (archiveId<<7)|fileId.
            const CacheIndex* index = nullptr;
            const Status s = cacheSystem.getIndex(static_cast<i32>(Rs2IndexId::npcs), &index);
            if (!ok(s) || !index) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingIndex(static_cast<i32>(Rs2IndexId::npcs), ok(s) ? Status::NotFound : s, "npcs index"));
            }
            auto r = NpcTypeLoader::fromIndex(cacheInfo, *index, 7, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "npcs decode"));
            }
            out.npcs = rs::move(r.value());
        } else {
            // Dat2: npc types are stored in configs index (2), archive id 9.
            auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::npcs), alloc);
            if (!archRes.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::npcs), archRes.status(), "npcs"));
            }
            const Archive archive = rs::move(archRes.value());

            auto r = NpcTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "npcs decode"));
            }
            out.npcs = rs::move(r.value());
        }
    }

    {
        if (rules.isIndexConfigs) {
            // RS2 (488+): obj types are stored in index id 19, typeId = (archiveId<<8)|fileId.
            const CacheIndex* index = nullptr;
            const Status s = cacheSystem.getIndex(static_cast<i32>(Rs2IndexId::objs), &index);
            if (!ok(s) || !index) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingIndex(static_cast<i32>(Rs2IndexId::objs), ok(s) ? Status::NotFound : s, "objs index"));
            }
            auto r = ObjTypeLoader::fromIndex(cacheInfo, *index, 8, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "objs decode"));
            }
            out.objs = rs::move(r.value());
        } else {
            // Dat2: obj types are stored in configs index (2), archive id 10.
            auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::objs), alloc);
            if (!archRes.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::objs), archRes.status(), "objs"));
            }
            const Archive archive = rs::move(archRes.value());

            auto r = ObjTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "objs decode"));
            }
            out.objs = rs::move(r.value());
        }
    }

    {
        // Dat2: params are stored in configs index (2), archive id 11.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::params), alloc);
        if (!archRes.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(
                InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::params), archRes.status(), "params"));
        }
        const Archive archive = rs::move(archRes.value());

        auto r = ParamTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "params decode"));
        }
        out.params = rs::move(r.value());
    }

    {
        if (rules.isIndexConfigs) {
            // RS2 (488+): sequences are stored in index id 20, typeId = (archiveId<<7)|fileId.
            const CacheIndex* index = nullptr;
            const Status s = cacheSystem.getIndex(static_cast<i32>(Rs2IndexId::seqs), &index);
            if (!ok(s) || !index) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingIndex(static_cast<i32>(Rs2IndexId::seqs), ok(s) ? Status::NotFound : s, "seqs index"));
            }
            auto r = SeqTypeLoader::fromIndex(cacheInfo, *index, 7, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "seqs decode"));
            }
            out.seqs = rs::move(r.value());
        } else {
            // Dat2: sequences are stored in configs index (2), archive id 12.
            auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::seqs), alloc);
            if (!archRes.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::seqs), archRes.status(), "seqs"));
            }
            const Archive archive = rs::move(archRes.value());

            auto r = SeqTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "seqs decode"));
            }
            out.seqs = rs::move(r.value());
        }
    }

    {
        // Dat2: spot animations are stored in configs index (2), archive id 13.
        auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::spotAnims), alloc);
        if (!archRes.isOk()) {
            if (archRes.status() != Status::NotFound) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::spotAnims), archRes.status(), "spotanims"));
            }
            out.spotAnims = SpotAnimTypeLoader{};
        } else {
            const Archive archive = rs::move(archRes.value());
            auto r = SpotAnimTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "spotanims decode"));
            }
            out.spotAnims = rs::move(r.value());
        }
    }

    {
        if (rules.isIndexConfigs) {
            // RS2 (488+): varbits are stored in index id 22, typeId = (archiveId<<10)|fileId.
            const CacheIndex* index = nullptr;
            const Status s = cacheSystem.getIndex(static_cast<i32>(Rs2IndexId::varbits), &index);
            if (!ok(s) || !index) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingIndex(static_cast<i32>(Rs2IndexId::varbits), ok(s) ? Status::NotFound : s, "varbits index"));
            }
            auto r = VarBitTypeLoader::fromIndex(cacheInfo, *index, 10, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "varbits decode"));
            }
            out.varBits = rs::move(r.value());
        } else {
            // Dat2: varbits are stored in configs index (2), archive id 14.
            auto archRes = cacheSystem.getArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::varbits), alloc);
            if (!archRes.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(
                    InitError::missingArchive(DAT2_INDEX_CONFIGS, static_cast<i32>(Dat2ConfigArchiveId::varbits), archRes.status(), "varbits"));
            }
            const Archive archive = rs::move(archRes.value());

            auto r = VarBitTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!r.isOk()) {
                return Expected<ConfigLoaders, InitError>::err(InitError::decodeFailed(r.status(), "varbits decode"));
            }
            out.varBits = rs::move(r.value());
        }
    }

    // Optional var configs (not required by current TS loader stack, but useful for parity + C++ port completeness).
    {
        auto r = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Dat2ConfigArchiveId::varps),
            "varps",
            &out.varPlayers);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(r.error()));
        }
    }
    {
        auto r = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Dat2ConfigArchiveId::varClient),
            "varClient",
            &out.varClientInts);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(r.error()));
        }
    }
    {
        auto r = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Dat2ConfigArchiveId::varClientString),
            "varClientString",
            &out.varClientStrs);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(r.error()));
        }
    }

    // Optional extras: follow TS CacheRules to avoid probing missing archives on older revisions.
    if (rules.bas == BasMode::Archive) {
        auto r = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Rs2ConfigArchiveId::bas),
            "bas",
            &out.bas);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(r.error()));
        }
    }

    if (rules.quests == QuestMode::Archive) {
        auto r = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Rs2ConfigArchiveId::quests),
            "quests",
            &out.quests);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(r.error()));
        }
    }

    if (rules.mapScenes == MapScenesMode::Archive) {
        auto r = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Rs2ConfigArchiveId::mapScenes),
            "mapScenes",
            &out.mapScenes);
        if (!r.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(r.error()));
        }
    }

    switch (rules.mapFunctions) {
    case MapFunctionsMode::OsrsArchive: {
        auto rStruct = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(OsrsConfigArchiveId::struct_),
            "struct",
            &out.structs);
        if (!rStruct.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(rStruct.error()));
        }
        auto rMf = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(OsrsConfigArchiveId::mapFunctions),
            "mapFunctions",
            &out.mapFunctions);
        if (!rMf.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(rMf.error()));
        }
        break;
    }
    case MapFunctionsMode::Rs2Archive: {
        auto rMf = loadOptionalArchiveLoader(
            cacheSystem,
            cacheInfo,
            alloc,
            DAT2_INDEX_CONFIGS,
            static_cast<i32>(Rs2ConfigArchiveId::mapFunctions),
            "mapFunctions",
            &out.mapFunctions);
        if (!rMf.isOk()) {
            return Expected<ConfigLoaders, InitError>::err(rs::move(rMf.error()));
        }
        break;
    }
    case MapFunctionsMode::GraphicsDefaults:
    default:
        break;
    }

    return Expected<ConfigLoaders, InitError>::ok(rs::move(out));
}

} // namespace rs
