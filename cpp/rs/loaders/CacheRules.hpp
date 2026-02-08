#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../cache/ConfigArchiveId.hpp"
#include "../cache/IndexId.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

// Mirrors `src/rs/loaders/CacheRules.ts`.

enum class TextureMode : u8 {
    Sprite = 0,
    Materials = 1,
    OldProcedural = 2,
    Dat = 3,
};

struct TextureRules final {
    TextureMode mode = TextureMode::Sprite;
    bool hasAlphaMaterialField = false;
    bool hasAlphaOperation = false;
};

enum class BasMode : u8 { Archive = 0, Dummy = 1 };
enum class QuestMode : u8 { Archive = 0, None = 1 };
enum class MapScenesMode : u8 { Archive = 0, GraphicsDefaults = 1 };
enum class MapFunctionsMode : u8 { OsrsArchive = 0, Rs2Archive = 1, GraphicsDefaults = 2 };

struct CacheRules final {
    bool isIndexConfigs = false;
    TextureRules texture{};
    BasMode bas = BasMode::Dummy;
    QuestMode quests = QuestMode::None;
    MapScenesMode mapScenes = MapScenesMode::GraphicsDefaults;
    MapFunctionsMode mapFunctions = MapFunctionsMode::GraphicsDefaults;
};

inline CacheRules computeCacheRules(const CacheInfo& cacheInfo, const CacheSystem& cacheSystem) noexcept {
    CacheRules out{};

    out.isIndexConfigs = (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 488);

    const bool useSpriteTextures =
        cacheInfo.game == GameType::Oldschool ||
        (cacheInfo.game == GameType::Runescape && cacheInfo.revision < 474);

    if (useSpriteTextures) {
        out.texture.mode = TextureMode::Sprite;
    } else if (cacheSystem.indexExists(static_cast<i32>(Rs2IndexId::materials))) {
        out.texture.mode = TextureMode::Materials;
        // materials removed in 629
        out.texture.hasAlphaMaterialField = cacheInfo.revision < 629;
        // alpha operation appears after 534 (seen from 537+)
        out.texture.hasAlphaOperation = cacheInfo.revision >= 537;
    } else {
        out.texture.mode = TextureMode::OldProcedural;
    }

    // Optional / revision-dependent rules are based on configs index presence + archive existence.
    const CacheIndex* configIndex = nullptr;
    if (cacheSystem.indexExists(static_cast<i32>(Dat2IndexId::configs))) {
        const Status s = cacheSystem.getIndex(static_cast<i32>(Dat2IndexId::configs), &configIndex);
        if (!ok(s) || !configIndex) {
            configIndex = nullptr;
        }
    }

    if (configIndex) {
        if (
            cacheInfo.game == GameType::Runescape &&
            cacheInfo.revision >= 530 &&
            configIndex->archiveExists(static_cast<i32>(Rs2ConfigArchiveId::bas))) {
            out.bas = BasMode::Archive;
        }

        if (
            cacheInfo.game == GameType::Runescape &&
            configIndex->archiveExists(static_cast<i32>(Rs2ConfigArchiveId::quests))) {
            out.quests = QuestMode::Archive;
        }

        if (
            cacheInfo.game == GameType::Runescape &&
            configIndex->archiveExists(static_cast<i32>(Rs2ConfigArchiveId::mapScenes))) {
            out.mapScenes = MapScenesMode::Archive;
        }

        if (
            cacheInfo.game == GameType::Oldschool &&
            configIndex->archiveExists(static_cast<i32>(OsrsConfigArchiveId::mapFunctions))) {
            out.mapFunctions = MapFunctionsMode::OsrsArchive;
        } else if (
            cacheInfo.game == GameType::Runescape &&
            configIndex->archiveExists(static_cast<i32>(Rs2ConfigArchiveId::mapFunctions))) {
            out.mapFunctions = MapFunctionsMode::Rs2Archive;
        }
    }

    return out;
}

} // namespace rs
