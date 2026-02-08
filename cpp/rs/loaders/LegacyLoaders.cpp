#include "LegacyLoaders.hpp"

#include "../cache/IndexId.hpp"
#include "../core/Move.hpp"
#include "../sprite/SpriteLoader.hpp"
#include "../util/StringHash.hpp"

namespace rs {

static Vec<IndexedSprite> loadOptionalMapSprites(
    const Archive& mediaArchive,
    const char* datName,
    Allocator& alloc) noexcept {
    Vec<IndexedSprite> empty(alloc);

    const i32 indexHash = hashOld("index.dat");
    const i32 datHash = hashOld(datName);

    const ArchiveFile* indexFile = mediaArchive.getFileByNameHash(indexHash);
    const ArchiveFile* datFile = mediaArchive.getFileByNameHash(datHash);
    if (!indexFile || !datFile) {
        return empty;
    }

    auto res = SpriteLoader::decodeIndexedSpritesDat(datFile->data.span(), indexFile->data.span(), alloc);
    if (!res.isOk()) {
        return empty;
    }
    return rs::move(res.value());
}

Expected<LegacyLoaders, InitError> LegacyLoaders::tryCreate(
    const CacheSystem& cacheSystem,
    const CacheInfo& cacheInfo,
    Allocator& alloc) noexcept {
    if (detectCacheType(cacheInfo) != CacheType::Legacy) {
        return Expected<LegacyLoaders, InitError>::err(InitError::unsupported("LegacyLoaders: cache type is not Legacy"));
    }

    LegacyLoaders out{};

    auto sessionRes = CacheSession::tryCreate(cacheSystem, cacheInfo, alloc);
    if (!sessionRes.isOk()) {
        return Expected<LegacyLoaders, InitError>::err(rs::move(sessionRes.error()));
    }
    out.session = rs::move(sessionRes.value());

    // Config archive: configs index (0), archive id 0.
    {
        auto cfgRes = cacheSystem.getArchive(static_cast<i32>(LegacyIndexId::configs), 0, alloc);
        if (!cfgRes.isOk()) {
            return Expected<LegacyLoaders, InitError>::err(
                InitError::missingArchive(static_cast<i32>(LegacyIndexId::configs), 0, cfgRes.status(), "legacy config archive"));
        }
        auto loadersRes = OldConfigLoaders::tryCreate(cacheInfo, CacheType::Legacy, rs::move(cfgRes.value()), alloc);
        if (!loadersRes.isOk()) {
            return Expected<LegacyLoaders, InitError>::err(rs::move(loadersRes.error()));
        }
        out.configs = rs::move(loadersRes.value());
    }

    // Media archive: index id 1, archive id 0.
    auto mediaRes = cacheSystem.getArchive(static_cast<i32>(LegacyIndexId::media), 0, alloc);
    if (!mediaRes.isOk()) {
        return Expected<LegacyLoaders, InitError>::err(
            InitError::missingArchive(static_cast<i32>(LegacyIndexId::media), 0, mediaRes.status(), "legacy media archive"));
    }
    const Archive mediaArchive = rs::move(mediaRes.value());

    out.mapScenes = loadOptionalMapSprites(mediaArchive, "mapscene.dat", alloc);
    out.mapFunctions = loadOptionalMapSprites(mediaArchive, "mapfunction.dat", alloc);

    return Expected<LegacyLoaders, InitError>::ok(rs::move(out));
}

} // namespace rs
