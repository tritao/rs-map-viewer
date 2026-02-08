#include "CacheSession.hpp"

#include "../cache/format/ArchiveFile.hpp"
#include "../cache/IndexId.hpp"
#include "../core/Move.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

static Expected<TextureLoaders, InitError> tryCreateTextureLoaders(
    const CacheSystem& cacheSystem,
    const CacheInfo& cacheInfo,
    const CacheRules& rules,
    Allocator& alloc) noexcept {
    (void)cacheInfo;

    TextureLoaders out{};
    const CacheType cacheType = detectCacheType(cacheInfo);
    out.mode = rules.texture.mode;

    if (cacheType == CacheType::Dat) {
        // Dat textures: stored in configs index (0), archive id 6 (DatConfigArchiveId::textures).
        auto archRes = cacheSystem.getArchive(static_cast<i32>(DatIndexId::configs), static_cast<i32>(DatConfigArchiveId::textures), alloc);
        if (!archRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingArchive(static_cast<i32>(DatIndexId::configs), static_cast<i32>(DatConfigArchiveId::textures), archRes.status(), "dat textures archive"));
        }
        Archive archive = rs::move(archRes.value());

        i32 animatedIds[4] = {DatTextureLoader::WATER_DROPLETS_TEXTURE_ID, 24, -1, -1};
        std::size_t animatedCount = 2;
        if (cacheInfo.revision > 289) {
            animatedIds[animatedCount++] = 34;
            animatedIds[animatedCount++] = 40;
        }

        auto loaderRes = DatTextureLoader::create(rs::move(archive), Span<const i32>(animatedIds, animatedCount), alloc);
        if (!loaderRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::decodeFailed(loaderRes.status(), "DatTextureLoader::create(dat)"));
        }
        out.mode = TextureMode::Dat;
        out.dat = rs::move(loaderRes.value());
        out.status = Status::Ok;
        return Expected<TextureLoaders, InitError>::ok(rs::move(out));
    }

    if (cacheType == CacheType::Legacy) {
        // Legacy textures: stored in textures index (2), archive id 0.
        auto archRes = cacheSystem.getArchive(static_cast<i32>(LegacyIndexId::textures), 0, alloc);
        if (!archRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingArchive(static_cast<i32>(LegacyIndexId::textures), 0, archRes.status(), "legacy textures archive"));
        }
        Archive archive = rs::move(archRes.value());

        i32 animatedIds[2] = {DatTextureLoader::WATER_DROPLETS_TEXTURE_ID, 24};
        auto loaderRes = DatTextureLoader::create(rs::move(archive), Span<const i32>(animatedIds, 2), alloc);
        if (!loaderRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::decodeFailed(loaderRes.status(), "DatTextureLoader::create(legacy)"));
        }
        out.mode = TextureMode::Dat;
        out.dat = rs::move(loaderRes.value());
        out.status = Status::Ok;
        return Expected<TextureLoaders, InitError>::ok(rs::move(out));
    }

    // Sprites: index id 8 (archiveId=spriteId, fileId=0).
    const CacheIndex* spriteIndex = nullptr;
    Status s = cacheSystem.getIndex(static_cast<i32>(Dat2IndexId::sprites), &spriteIndex);
    if (!ok(s) || !spriteIndex) {
        return Expected<TextureLoaders, InitError>::err(
            InitError::missingIndex(static_cast<i32>(Dat2IndexId::sprites), ok(s) ? Status::NotFound : s, "sprites index"));
    }

    if (rules.texture.mode == TextureMode::Sprite) {
        // Textures: index id 9, archive 0 contains one file per texture definition id.
        auto defRes = cacheSystem.getArchive(static_cast<i32>(Dat2IndexId::textures), 0, alloc);
        if (!defRes.isOk()) {
            if (defRes.status() == Status::NotFound) {
                // Keep sprite index wired even if definitions are missing.
                auto emptyRes = SpriteTextureLoader::createEmpty(*spriteIndex, alloc);
                if (!emptyRes.isOk()) {
                    return Expected<TextureLoaders, InitError>::err(
                        InitError::decodeFailed(emptyRes.status(), "SpriteTextureLoader::createEmpty"));
                }
                out.sprite = rs::move(emptyRes.value());
                out.status = Status::Ok;
                return Expected<TextureLoaders, InitError>::ok(rs::move(out));
            }
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingArchive(static_cast<i32>(Dat2IndexId::textures), 0, defRes.status(), "texture defs archive"));
        }

        const Archive defs = rs::move(defRes.value());
        auto loaderRes = SpriteTextureLoader::create(defs, *spriteIndex, alloc);
        if (!loaderRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::decodeFailed(loaderRes.status(), "SpriteTextureLoader::create"));
        }
        out.sprite = rs::move(loaderRes.value());
        out.status = Status::Ok;
        return Expected<TextureLoaders, InitError>::ok(rs::move(out));
    }

    if (rules.texture.mode == TextureMode::Materials) {
        // Fetch texture definitions index (smart addressing differs by cache layout).
        const CacheIndex* textureIndex = nullptr;
        s = cacheSystem.getIndex(static_cast<i32>(Dat2IndexId::textures), &textureIndex);
        if (!ok(s) || !textureIndex) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingIndex(static_cast<i32>(Dat2IndexId::textures), ok(s) ? Status::NotFound : s, "textures index"));
        }

        // Materials: rs2 index 26, archive 0 file 0.
        const CacheIndex* materialsIndex = nullptr;
        s = cacheSystem.getIndex(static_cast<i32>(Rs2IndexId::materials), &materialsIndex);
        if (!ok(s) || !materialsIndex) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingIndex(static_cast<i32>(Rs2IndexId::materials), ok(s) ? Status::NotFound : s, "materials index"));
        }
        auto matArchRes = materialsIndex->getArchive(0, alloc);
        if (!matArchRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingArchive(static_cast<i32>(Rs2IndexId::materials), 0, matArchRes.status(), "materials archive"));
        }
        Archive matArchive = rs::move(matArchRes.value());
        const ArchiveFile* file = matArchive.getFile(0);
        if (!file) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingFile(static_cast<i32>(Rs2IndexId::materials), 0, 0, Status::NotFound, "materials file"));
        }

        auto procRes = ProceduralTextureLoader::createFromMaterialsBytes(
            rules.texture.hasAlphaMaterialField,
            rules.texture.hasAlphaOperation,
            file->data.span(),
            *textureIndex,
            *spriteIndex,
            alloc);
        if (!procRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::decodeFailed(procRes.status(), "ProceduralTextureLoader::createFromMaterialsBytes"));
        }
        out.procedural = rs::move(procRes.value());
        out.status = Status::Ok;
        return Expected<TextureLoaders, InitError>::ok(rs::move(out));
    }

    if (rules.texture.mode == TextureMode::OldProcedural) {
        // Old procedural: textures index archive 0 enumerates definition ids (fileId = textureId).
        auto defRes = cacheSystem.getArchive(static_cast<i32>(Dat2IndexId::textures), 0, alloc);
        if (!defRes.isOk()) {
            if (defRes.status() == Status::NotFound) {
                auto emptyRes = OldProceduralTextureLoader::create(nullptr, *spriteIndex, alloc);
                if (!emptyRes.isOk()) {
                    return Expected<TextureLoaders, InitError>::err(
                        InitError::decodeFailed(emptyRes.status(), "OldProceduralTextureLoader::create(empty)"));
                }
                out.oldProcedural = rs::move(emptyRes.value());
                out.status = Status::Ok;
                return Expected<TextureLoaders, InitError>::ok(rs::move(out));
            }
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingArchive(static_cast<i32>(Dat2IndexId::textures), 0, defRes.status(), "texture defs archive"));
        }

        Archive defs = rs::move(defRes.value());
        auto loaderRes = OldProceduralTextureLoader::create(&defs, *spriteIndex, alloc);
        if (!loaderRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::decodeFailed(loaderRes.status(), "OldProceduralTextureLoader::create"));
        }
        out.oldProcedural = rs::move(loaderRes.value());
        out.status = Status::Ok;
        return Expected<TextureLoaders, InitError>::ok(rs::move(out));
    }

    out.status = Status::Unsupported;
    return Expected<TextureLoaders, InitError>::ok(rs::move(out));
}

Expected<CacheSession, InitError> CacheSession::tryCreate(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept {
    CacheSession out{};
    out.cacheSystem = &cacheSystem;
    out.cacheInfo = cacheInfo;
    out.rules = computeCacheRules(cacheInfo, cacheSystem);

    const CacheType cacheType = detectCacheType(cacheInfo);
    if (cacheType == CacheType::Dat2) {
        auto cfgRes = tryCreateConfigLoaders(cacheSystem, cacheInfo, alloc);
        if (!cfgRes.isOk()) {
            return Expected<CacheSession, InitError>::err(rs::move(cfgRes.error()));
        }
        out.configs = rs::move(cfgRes.value());
        out.configsStatus = Status::Ok;
    } else {
        // Config loaders for Dat/Legacy are not ported yet.
        out.configs = ConfigLoaders{};
        out.configsStatus = Status::Unsupported;
    }

    auto texRes = tryCreateTextureLoaders(cacheSystem, cacheInfo, out.rules, alloc);
    if (!texRes.isOk()) {
        return Expected<CacheSession, InitError>::err(rs::move(texRes.error()));
    }
    out.textures = rs::move(texRes.value());

    return Expected<CacheSession, InitError>::ok(rs::move(out));
}

} // namespace rs
