#include "CacheSession.hpp"

#include "DatLegacyConfigLoaders.hpp"
#include "../cache/ConfigArchiveId.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../cache/IndexId.hpp"
#include "../config/defaults/GraphicsDefaults.hpp"
#include "../core/Move.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

Expected<GraphicsDefaults, InitError> CacheSession::tryGetGraphicsDefaults(Allocator& alloc) const noexcept {
    if (!cacheSystem) {
        return Expected<GraphicsDefaults, InitError>::err(
            InitError::invalidArgument("CacheSession: cacheSystem is null"));
    }
    auto r = GraphicsDefaults::tryCreate(cacheInfo, *cacheSystem, alloc);
    if (!r.isOk()) {
        return Expected<GraphicsDefaults, InitError>::err(
            InitError::decodeFailed(r.status(), "GraphicsDefaults::tryCreate"));
    }
    return Expected<GraphicsDefaults, InitError>::ok(rs::move(r.value()));
}

static Status tryGetIndexChecked(const CacheSystem& cacheSystem, i32 indexId, const CacheIndex** out) noexcept {
    if (!out) return Status::InvalidArgument;
    *out = nullptr;
    return cacheSystem.getIndex(indexId, out);
}

static Expected<Archive, InitError> tryGetArchiveChecked(
    const CacheSystem& cacheSystem,
    i32 indexId,
    i32 archiveId,
    const char* context,
    Allocator& alloc) noexcept {
    auto archRes = cacheSystem.getArchive(indexId, archiveId, alloc);
    if (!archRes.isOk()) {
        return Expected<Archive, InitError>::err(
            InitError::missingArchive(indexId, archiveId, archRes.status(), context));
    }
    return Expected<Archive, InitError>::ok(rs::move(archRes.value()));
}

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
        auto archRes = tryGetArchiveChecked(
            cacheSystem,
            static_cast<i32>(DatIndexId::configs),
            static_cast<i32>(DatConfigArchiveId::textures),
            "dat textures archive",
            alloc);
        if (!archRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(rs::move(archRes.error()));
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
        auto archRes = tryGetArchiveChecked(
            cacheSystem,
            static_cast<i32>(LegacyIndexId::textures),
            0,
            "legacy textures archive",
            alloc);
        if (!archRes.isOk()) {
            return Expected<TextureLoaders, InitError>::err(rs::move(archRes.error()));
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
    Status s = tryGetIndexChecked(cacheSystem, static_cast<i32>(Dat2IndexId::sprites), &spriteIndex);
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
        s = tryGetIndexChecked(cacheSystem, static_cast<i32>(Dat2IndexId::textures), &textureIndex);
        if (!ok(s) || !textureIndex) {
            return Expected<TextureLoaders, InitError>::err(
                InitError::missingIndex(static_cast<i32>(Dat2IndexId::textures), ok(s) ? Status::NotFound : s, "textures index"));
        }

        // Materials: rs2 index 26, archive 0 file 0.
        const CacheIndex* materialsIndex = nullptr;
        s = tryGetIndexChecked(cacheSystem, static_cast<i32>(Rs2IndexId::materials), &materialsIndex);
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

static ModelLoaders createModelLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept {
    ModelLoaders out{};
    const CacheType cacheType = detectCacheType(cacheInfo);

    i32 modelIndexId = -1;
    i32 seqFrameIndexId = -1;
    if (cacheType == CacheType::Dat2) {
        modelIndexId = static_cast<i32>(Dat2IndexId::models);
        seqFrameIndexId = static_cast<i32>(Dat2IndexId::animations);
    } else if (cacheType == CacheType::Dat) {
        modelIndexId = static_cast<i32>(DatIndexId::models);
        seqFrameIndexId = static_cast<i32>(DatIndexId::animations);
    }

    if (modelIndexId >= 0) {
        const CacheIndex* modelIndex = nullptr;
        const Status s = tryGetIndexChecked(cacheSystem, modelIndexId, &modelIndex);
        if (ok(s) && modelIndex) {
            out.modelBytes = IndexFileBytesProvider(modelIndex, /*fileId=*/0);
            out.models = IndexModelLoader(out.modelBytes, alloc);
            out.modelKind = ModelLoaders::ModelKind::Index;
            out.modelStatus = Status::Ok;
        } else {
            out.modelKind = ModelLoaders::ModelKind::None;
            out.modelStatus = ok(s) ? Status::NotFound : s;
        }
    } else if (cacheType == CacheType::Legacy) {
        auto archRes = cacheSystem.getArchive(static_cast<i32>(LegacyIndexId::models), 0, alloc);
        if (!archRes.isOk()) {
            out.modelKind = ModelLoaders::ModelKind::None;
            out.modelStatus = archRes.status();
        } else {
            auto legacyRes = LegacyModelLoader::create(archRes.value(), alloc);
            if (!legacyRes.isOk()) {
                out.modelKind = ModelLoaders::ModelKind::None;
                out.modelStatus = legacyRes.status();
            } else {
                out.legacyModels = rs::move(legacyRes.value());
                out.modelKind = ModelLoaders::ModelKind::Legacy;
                out.modelStatus = Status::Ok;
            }
        }
    }

    if (seqFrameIndexId >= 0) {
        const CacheIndex* seqFrameIndex = nullptr;
        const Status s = tryGetIndexChecked(cacheSystem, seqFrameIndexId, &seqFrameIndex);
        if (ok(s) && seqFrameIndex) {
            out.seqFrameBytes = IndexFileBytesProvider(seqFrameIndex, /*fileId=*/0);
            out.seqFrameStatus = Status::Ok;
            if (cacheType == CacheType::Dat) {
                auto datFramesRes = DatSeqFrameLoader::create(out.seqFrameBytes, alloc);
                if (!datFramesRes.isOk()) {
                    out.seqFrameStatus = datFramesRes.status();
                    out.seqFrameKind = ModelLoaders::SeqFrameKind::None;
                } else {
                    out.datSeqFrames = rs::move(datFramesRes.value());
                    out.seqFrameKind = ModelLoaders::SeqFrameKind::Dat;
                }
            }
        } else {
            out.seqFrameStatus = ok(s) ? Status::NotFound : s;
        }
    }

    if (cacheType == CacheType::Dat2) {
        const CacheIndex* animationsIndex = nullptr;
        const CacheIndex* skeletonsIndex = nullptr;
        const Status animS = tryGetIndexChecked(cacheSystem, static_cast<i32>(Dat2IndexId::animations), &animationsIndex);
        const Status skelS = tryGetIndexChecked(cacheSystem, static_cast<i32>(Dat2IndexId::skeletons), &skeletonsIndex);
        if (ok(animS) && animationsIndex && ok(skelS) && skeletonsIndex) {
            out.skeletalSeqBytes = PackedIdGroupBytesProvider(animationsIndex);
            out.skeletalSeqStatus = Status::Ok;

            out.seqBaseStatus = Status::Ok;
            out.seqFrameKind = ModelLoaders::SeqFrameKind::Dat2;
            const IndexFileBytesProvider baseSource(skeletonsIndex, /*fileId=*/0);
            out.seqBases = Dat2SeqBaseLoader(cacheInfo, baseSource, alloc);
            out.seqFrames = Dat2SeqFrameLoader(
                cacheInfo,
                PackedIdGroupBytesProvider(animationsIndex),
                Dat2SeqBaseLoader(cacheInfo, baseSource, alloc),
                alloc);
            out.skeletalSeqs = ProviderSkeletalSeqLoader(
                PackedIdGroupBytesProvider(animationsIndex),
                Dat2SeqBaseLoader(cacheInfo, baseSource, alloc),
                alloc);
        } else if (!ok(animS)) {
            out.skeletalSeqStatus = animS;
            out.seqBaseStatus = ok(skelS) ? Status::NotFound : skelS;
        } else if (!ok(skelS)) {
            out.skeletalSeqStatus = skelS;
            out.seqBaseStatus = skelS;
        } else {
            out.skeletalSeqStatus = Status::NotFound;
            out.seqBaseStatus = Status::NotFound;
        }
    }

    if (cacheType == CacheType::Legacy) {
        auto modelArchiveRes = cacheSystem.getArchive(static_cast<i32>(LegacyIndexId::models), 0, alloc);
        if (modelArchiveRes.isOk()) {
            auto seqRes = LegacySeqFrameLoader::create(modelArchiveRes.value(), alloc);
            if (seqRes.isOk()) {
                out.legacySeqFrames = rs::move(seqRes.value());
                out.seqFrameKind = ModelLoaders::SeqFrameKind::Legacy;
                out.seqFrameStatus = Status::Ok;
            } else {
                out.seqFrameStatus = seqRes.status();
            }
        } else {
            out.seqFrameStatus = modelArchiveRes.status();
        }
    }

    return out;
}

Expected<CacheSession, InitError> CacheSession::tryCreate(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept {
    CacheSession out{};
    out.cacheSystem = &cacheSystem;
    out.cacheInfo = cacheInfo;
    out.rules = computeCacheRules(cacheInfo, cacheSystem);
    out.varManager = VarManager(alloc);
    Status varInit = out.varManager.init();
    if (!ok(varInit)) {
        return Expected<CacheSession, InitError>::err(
            InitError::decodeFailed(varInit, "VarManager::init"));
    }

    const CacheType cacheType = detectCacheType(cacheInfo);
    if (cacheType == CacheType::Dat2) {
        auto cfgRes = tryCreateConfigLoaders(cacheSystem, cacheInfo, alloc);
        if (!cfgRes.isOk()) {
            return Expected<CacheSession, InitError>::err(rs::move(cfgRes.error()));
        }
        out.config.kind = CacheSession::ConfigLayerKind::Dat2;
        out.config.status = Status::Ok;
        out.config.dat2 = rs::move(cfgRes.value());
        out.config.datLegacy = DatLegacyConfigLoaders{};
    } else {
        // Dat/Legacy: load named .dat/.idx config streams.
        i32 indexId = -1;
        i32 archiveId = -1;
        if (cacheType == CacheType::Dat) {
            indexId = static_cast<i32>(DatIndexId::configs);
            archiveId = static_cast<i32>(DatConfigArchiveId::configs);
        } else {
            indexId = static_cast<i32>(LegacyIndexId::configs);
            archiveId = 0;
        }

        auto archRes = tryGetArchiveChecked(cacheSystem, indexId, archiveId, "old configs archive", alloc);
        if (!archRes.isOk()) {
            return Expected<CacheSession, InitError>::err(rs::move(archRes.error()));
        }

        auto oldRes = DatLegacyConfigLoaders::tryCreate(cacheInfo, cacheType, rs::move(archRes.value()), alloc);
        if (!oldRes.isOk()) {
            return Expected<CacheSession, InitError>::err(rs::move(oldRes.error()));
        }

        out.config.kind = CacheSession::ConfigLayerKind::DatLegacy;
        out.config.status = Status::Ok;
        out.config.dat2 = ConfigLoaders{};
        out.config.datLegacy = rs::move(oldRes.value());
    }

    auto texRes = tryCreateTextureLoaders(cacheSystem, cacheInfo, out.rules, alloc);
    if (!texRes.isOk()) {
        return Expected<CacheSession, InitError>::err(rs::move(texRes.error()));
    }
    out.textures = rs::move(texRes.value());
    out.modelLoaders = createModelLoaders(cacheSystem, cacheInfo, alloc);

    if (out.hasQuestTypeLoader()) {
        out.varManager.setQuestsCompleted(
            out.config.dat2.quests,
            [&out](i32 varbitId, const VarBitType** varbit) noexcept -> Status {
                return out.tryGetVarBitType(varbitId, varbit);
            });
    }

    return Expected<CacheSession, InitError>::ok(rs::move(out));
}

} // namespace rs
