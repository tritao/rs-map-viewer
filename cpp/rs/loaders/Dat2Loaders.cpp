#include "Dat2Loaders.hpp"

#include "../cache/ConfigArchiveId.hpp"
#include "../cache/IndexId.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../config/defaults/GraphicsDefaults.hpp"
#include "../config/mapscenetype/MapSceneType.hpp"
#include "../config/mapscenetype/MapSceneTypeLoader.hpp"
#include "../config/meltype/MapElementType.hpp"
#include "../config/meltype/MapElementTypeLoader.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../sprite/SpriteLoader.hpp"

namespace rs {

Expected<SpriteArchive, InitError> Dat2Loaders::tryLoadSpriteArchive(i32 spriteId, Allocator& alloc) const noexcept {
    if (!session.cacheSystem) {
        return Expected<SpriteArchive, InitError>::err(InitError::invalidArgument("Dat2Loaders: session.cacheSystem is null"));
    }

    auto archRes = session.cacheSystem->getArchive(static_cast<i32>(Dat2IndexId::sprites), spriteId, alloc);
    if (!archRes.isOk()) {
        return Expected<SpriteArchive, InitError>::err(
            InitError::missingArchive(static_cast<i32>(Dat2IndexId::sprites), spriteId, archRes.status(), "sprite archive"));
    }
    const Archive archive = rs::move(archRes.value());
    const ArchiveFile* file0 = archive.getFile(0);
    if (!file0) {
        return Expected<SpriteArchive, InitError>::err(
            InitError::missingFile(static_cast<i32>(Dat2IndexId::sprites), spriteId, 0, Status::NotFound, "sprite archive file0"));
    }
    auto spriteRes = SpriteLoader::decodeSpriteArchive(file0->data.span(), alloc);
    if (!spriteRes.isOk()) {
        return Expected<SpriteArchive, InitError>::err(InitError::decodeFailed(spriteRes.status(), "decode sprite archive"));
    }
    return Expected<SpriteArchive, InitError>::ok(rs::move(spriteRes.value()));
}

static Expected<void, InitError> fillSpriteIdTableFromMapScenesArchive(
    Vec<i32>& outSpriteIds,
    const CacheInfo& cacheInfo,
    const CacheSystem& cacheSystem,
    Allocator& alloc) noexcept {
    auto archRes = cacheSystem.getArchive(static_cast<i32>(Dat2IndexId::configs), static_cast<i32>(Rs2ConfigArchiveId::mapScenes), alloc);
    if (!archRes.isOk()) {
        return Expected<void, InitError>::err(
            InitError::missingArchive(static_cast<i32>(Dat2IndexId::configs), static_cast<i32>(Rs2ConfigArchiveId::mapScenes), archRes.status(), "mapScenes archive"));
    }
    const Archive archive = rs::move(archRes.value());
    auto loaderRes = MapSceneTypeLoader::fromArchive(cacheInfo, archive, alloc);
    if (!loaderRes.isOk()) {
        return Expected<void, InitError>::err(InitError::decodeFailed(loaderRes.status(), "mapScenes decode"));
    }

    MapSceneTypeLoader loader = rs::move(loaderRes.value());
    const i32 n = loader.count();
    auto rr = outSpriteIds.resize(static_cast<std::size_t>(n));
    if (!rr.isOk()) {
        return Expected<void, InitError>::err(InitError::decodeFailed(rr.status(), "mapScenes sprite table alloc"));
    }
    for (std::size_t i = 0; i < outSpriteIds.size(); i++) {
        outSpriteIds[i] = -1;
    }

    for (i32 id = 0; id < n; id++) {
        const MapSceneType* v = nullptr;
        const Status s = loader.get(id, &v);
        if (!ok(s) || !v) {
            continue;
        }
        if (v->spriteId != -1) {
            outSpriteIds[static_cast<std::size_t>(id)] = v->spriteId;
        }
    }

    return Expected<void, InitError>::ok();
}

static Expected<void, InitError> fillSpriteIdTableFromMapFunctionsArchive(
    Vec<i32>& outSpriteIds,
    const CacheInfo& cacheInfo,
    const CacheSystem& cacheSystem,
    const CacheRules& rules,
    Allocator& alloc) noexcept {
    i32 archiveId = -1;
    if (rules.mapFunctions == MapFunctionsMode::OsrsArchive) {
        archiveId = static_cast<i32>(OsrsConfigArchiveId::mapFunctions);
    } else if (rules.mapFunctions == MapFunctionsMode::Rs2Archive) {
        archiveId = static_cast<i32>(Rs2ConfigArchiveId::mapFunctions);
    } else {
        return Expected<void, InitError>::ok();
    }

    auto archRes = cacheSystem.getArchive(static_cast<i32>(Dat2IndexId::configs), archiveId, alloc);
    if (!archRes.isOk()) {
        return Expected<void, InitError>::err(
            InitError::missingArchive(static_cast<i32>(Dat2IndexId::configs), archiveId, archRes.status(), "mapFunctions archive"));
    }
    const Archive archive = rs::move(archRes.value());
    auto loaderRes = MapElementTypeLoader::fromArchive(cacheInfo, archive, alloc);
    if (!loaderRes.isOk()) {
        return Expected<void, InitError>::err(InitError::decodeFailed(loaderRes.status(), "mapFunctions decode"));
    }

    MapElementTypeLoader loader = rs::move(loaderRes.value());
    const i32 n = loader.count();
    auto rr = outSpriteIds.resize(static_cast<std::size_t>(n));
    if (!rr.isOk()) {
        return Expected<void, InitError>::err(InitError::decodeFailed(rr.status(), "mapFunctions sprite table alloc"));
    }
    for (std::size_t i = 0; i < outSpriteIds.size(); i++) {
        outSpriteIds[i] = -1;
    }

    for (i32 id = 0; id < n; id++) {
        const MapElementType* v = nullptr;
        const Status s = loader.get(id, &v);
        if (!ok(s) || !v) {
            continue;
        }
        if (v->spriteId != -1) {
            outSpriteIds[static_cast<std::size_t>(id)] = v->spriteId;
        }
    }

    return Expected<void, InitError>::ok();
}

static void tryLoadDefaultsSpriteGroup(
    Dat2Loaders& out,
    bool isMapScenes,
    const CacheInfo& cacheInfo,
    const CacheSystem& cacheSystem,
    Allocator& alloc) noexcept {
    auto defRes = GraphicsDefaults::tryCreate(cacheInfo, cacheSystem, alloc);
    if (!defRes.isOk()) {
        return;
    }
    const GraphicsDefaults defaults = rs::move(defRes.value());
    const i32 groupId = isMapScenes ? defaults.mapScenes : defaults.mapFunctions;
    if (groupId < 0) {
        return;
    }

    // Decode sprite group from sprites index.
    auto archRes = cacheSystem.getArchive(static_cast<i32>(Dat2IndexId::sprites), groupId, alloc);
    if (!archRes.isOk()) {
        return;
    }
    const Archive archive = rs::move(archRes.value());
    const ArchiveFile* file0 = archive.getFile(0);
    if (!file0) {
        return;
    }
    auto spriteRes = SpriteLoader::decodeSpriteArchive(file0->data.span(), alloc);
    if (!spriteRes.isOk()) {
        return;
    }
    if (isMapScenes) {
        out.mapScenesDefaults = rs::move(spriteRes.value());
        out.hasMapScenesDefaults = true;
    } else {
        out.mapFunctionsDefaults = rs::move(spriteRes.value());
        out.hasMapFunctionsDefaults = true;
    }
}

Expected<Dat2Loaders, InitError> Dat2Loaders::tryCreate(
    const CacheSystem& cacheSystem,
    const CacheInfo& cacheInfo,
    Allocator& alloc) noexcept {
    Dat2Loaders out{};

    auto sessionRes = CacheSession::tryCreate(cacheSystem, cacheInfo, alloc);
    if (!sessionRes.isOk()) {
        return Expected<Dat2Loaders, InitError>::err(rs::move(sessionRes.error()));
    }
    out.session = rs::move(sessionRes.value());

    // Assemble optional map sprite metadata, mirroring TS rules.
    if (out.session.rules.mapScenes == MapScenesMode::Archive) {
        auto r = fillSpriteIdTableFromMapScenesArchive(out.mapSceneSpriteIds, cacheInfo, cacheSystem, alloc);
        if (!r.isOk()) {
            return Expected<Dat2Loaders, InitError>::err(rs::move(r.error()));
        }
    } else {
        tryLoadDefaultsSpriteGroup(out, true, cacheInfo, cacheSystem, alloc);
    }

    if (out.session.rules.mapFunctions == MapFunctionsMode::OsrsArchive || out.session.rules.mapFunctions == MapFunctionsMode::Rs2Archive) {
        auto r = fillSpriteIdTableFromMapFunctionsArchive(out.mapElementSpriteIds, cacheInfo, cacheSystem, out.session.rules, alloc);
        if (!r.isOk()) {
            return Expected<Dat2Loaders, InitError>::err(rs::move(r.error()));
        }
    } else {
        tryLoadDefaultsSpriteGroup(out, false, cacheInfo, cacheSystem, alloc);
    }

    return Expected<Dat2Loaders, InitError>::ok(rs::move(out));
}

} // namespace rs

