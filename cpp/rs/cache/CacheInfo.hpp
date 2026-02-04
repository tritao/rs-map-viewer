#pragma once

#include "../types.hpp"
#include "CacheType.hpp"

namespace rs {

enum class GameType : int {
    Classic = 0,
    Runescape = 1,
    Oldschool = 2,
};

// Mirror of `src/rs/cache/CacheInfo.ts` (strings are optional and non-owning here).
struct CacheInfo {
    const char* name = nullptr;
    GameType game = GameType::Runescape;
    const char* environment = nullptr;
    i32 revision = 0;
    const char* timestamp = nullptr;
    u64 size = 0;
};

// Mirror of `detectCacheType(cacheInfo)` in TypeScript.
inline CacheType detectCacheType(const CacheInfo& cacheInfo) noexcept {
    switch (cacheInfo.game) {
    case GameType::Classic:
        return CacheType::Classic;
    case GameType::Runescape:
        if (cacheInfo.revision < 234) {
            return CacheType::Legacy;
        }
        if (cacheInfo.revision < 410) {
            return CacheType::Dat;
        }
        return CacheType::Dat2;
    case GameType::Oldschool:
        return CacheType::Dat2;
    default:
        return CacheType::Dat2;
    }
}

} // namespace rs

