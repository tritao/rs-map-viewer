#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Expected.hpp"
#include "../core/Status.hpp"
#include "../texture/DatTextureLoader.hpp"
#include "../texture/OldProceduralTextureLoader.hpp"
#include "../texture/ProceduralTextureLoader.hpp"
#include "../texture/SpriteTextureLoader.hpp"
#include "../types.hpp"
#include "CacheRules.hpp"
#include "ConfigLoaders.hpp"

namespace rs {

struct TextureLoaders final {
    TextureMode mode = TextureMode::Sprite;
    Status status = Status::Ok;
    SpriteTextureLoader sprite{};
    DatTextureLoader dat{};
    ProceduralTextureLoader procedural{};
    OldProceduralTextureLoader oldProcedural{};
};

struct CacheSession final {
    const CacheSystem* cacheSystem = nullptr;
    CacheInfo cacheInfo{};
    CacheRules rules{};

    ConfigLoaders configs{};
    Status configsStatus = Status::Ok;
    TextureLoaders textures{};

    // Creates a per-thread session. This intentionally owns decoded loader state by value
    // (matching the "session holds services" shape used by the TS runtime).
    static Expected<CacheSession, InitError> tryCreate(
        const CacheSystem& cacheSystem,
        const CacheInfo& cacheInfo,
        Allocator& alloc) noexcept;

    // Convenience for "thread-local fork": create a new session with the same cache source.
    Expected<CacheSession, InitError> tryFork(Allocator& alloc) const noexcept {
        if (!cacheSystem) {
            return Expected<CacheSession, InitError>::err(InitError::invalidArgument("CacheSession: cacheSystem is null"));
        }
        return CacheSession::tryCreate(*cacheSystem, cacheInfo, alloc);
    }
};

} // namespace rs
