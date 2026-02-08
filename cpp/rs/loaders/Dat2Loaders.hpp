#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Expected.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../sprite/SpriteArchive.hpp"
#include "../types.hpp"
#include "CacheRules.hpp"
#include "CacheSession.hpp"
#include "InitError.hpp"

namespace rs {

// High-level loader assembly, mirroring the "createDat2Loaders" TS layer.
//
// Intentionally keeps "optional extras" (map scenes/functions sprites) non-fatal and lazy-friendly:
// - Archive modes expose a dense table of sprite ids (id->spriteId, -1 if none).
// - GraphicsDefaults modes preload the sprite group as a SpriteArchive (owns palette lifetime).
struct Dat2Loaders final {
    CacheSession session{};

    // Map scenes:
    // - Archive mode: sprite id per MapSceneType id, -1 if none / missing.
    // - GraphicsDefaults mode: decoded group in mapScenesDefaults (may be empty if missing).
    Vec<i32> mapSceneSpriteIds{};
    SpriteArchive mapScenesDefaults{};
    bool hasMapScenesDefaults = false;

    // Map functions:
    // - Archive mode: sprite id per MapElementType id, -1 if none / missing.
    // - GraphicsDefaults mode: decoded group in mapFunctionsDefaults (may be empty if missing).
    Vec<i32> mapElementSpriteIds{};
    SpriteArchive mapFunctionsDefaults{};
    bool hasMapFunctionsDefaults = false;

    static Expected<Dat2Loaders, InitError> tryCreate(
        const CacheSystem& cacheSystem,
        const CacheInfo& cacheInfo,
        Allocator& alloc) noexcept;

    // Convenience: loads and decodes one sprite archive (sprites index archiveId=spriteId, fileId=0).
    Expected<SpriteArchive, InitError> tryLoadSpriteArchive(i32 spriteId, Allocator& alloc) const noexcept;
};

} // namespace rs

