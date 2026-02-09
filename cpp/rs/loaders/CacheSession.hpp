#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/IndexId.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Expected.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../crypto/Xtea.hpp"
#include "../texture/DatTextureLoader.hpp"
#include "../io/BytesProvider.hpp"
#include "../model/ModelData.hpp"
#include "../model/LegacyModelLoader.hpp"
#include "../model/ModelLoader.hpp"
#include "../model/seq/SeqBaseLoader.hpp"
#include "../model/seq/SeqFrameLoader.hpp"
#include "../model/skeletal/SkeletalEval.hpp"
#include "../model/skeletal/SkeletalSeqLoader.hpp"
#include "../texture/OldProceduralTextureLoader.hpp"
#include "../texture/ProceduralTextureLoader.hpp"
#include "../texture/SpriteTextureLoader.hpp"
#include "../types.hpp"
#include "CacheRules.hpp"
#include "ConfigLoaders.hpp"
#include "DatLegacyConfigLoaders.hpp"

namespace rs {

struct GraphicsDefaults;

struct TextureLoaders final {
    TextureMode mode = TextureMode::Sprite;
    Status status = Status::Ok;
    SpriteTextureLoader sprite{};
    DatTextureLoader dat{};
    ProceduralTextureLoader procedural{};
    OldProceduralTextureLoader oldProcedural{};
};

struct ModelLoaders final {
    enum class ModelKind : u8 {
        None = 0,
        Index = 1,
        Legacy = 2,
    };
    enum class SeqFrameKind : u8 {
        None = 0,
        Dat = 1,
        Dat2 = 2,
        Legacy = 3,
    };

    ModelKind modelKind = ModelKind::None;
    SeqFrameKind seqFrameKind = SeqFrameKind::None;
    Status modelStatus = Status::Unsupported;
    Status seqFrameStatus = Status::Unsupported;
    Status skeletalSeqStatus = Status::Unsupported;
    Status seqBaseStatus = Status::Unsupported;

    IndexFileBytesProvider modelBytes{};
    IndexFileBytesProvider seqFrameBytes{};
    PackedIdGroupBytesProvider skeletalSeqBytes{};

    IndexModelLoader models{};
    LegacyModelLoader legacyModels{};
    Dat2SeqBaseLoader seqBases{};
    DatSeqFrameLoader datSeqFrames{};
    Dat2SeqFrameLoader seqFrames{};
    LegacySeqFrameLoader legacySeqFrames{};
    ProviderSkeletalSeqLoader skeletalSeqs{};
};

struct CacheSession final {
    enum class ConfigLayerKind : u8 {
        Dat2 = 0,
        DatLegacy = 1,
    };

    struct ConfigLayer final {
        ConfigLayerKind kind = ConfigLayerKind::Dat2;
        Status status = Status::Unsupported;

        // Dat2 config loaders (modern/indexed configs).
        ConfigLoaders dat2{};

        // Dat/Legacy config loaders (named .dat/.idx streams).
        DatLegacyConfigLoaders datLegacy{};
    };

    const CacheSystem* cacheSystem = nullptr;
    CacheInfo cacheInfo{};
    CacheRules rules{};

    // Tagged config loader storage, mirroring TS cache-type dispatch.
    ConfigLayer config{};

    TextureLoaders textures{};
    ModelLoaders modelLoaders{};

    [[nodiscard]] TextureMode textureMode() const noexcept { return textures.mode; }
    [[nodiscard]] Status textureStatus() const noexcept { return textures.status; }
    [[nodiscard]] bool hasTextureService() const noexcept { return textures.status == Status::Ok; }
    [[nodiscard]] bool hasModelService() const noexcept { return modelLoaders.modelStatus == Status::Ok; }
    [[nodiscard]] bool hasSeqFrameService() const noexcept { return modelLoaders.seqFrameStatus == Status::Ok; }
    [[nodiscard]] Status modelStatus() const noexcept { return modelLoaders.modelStatus; }
    [[nodiscard]] Status seqFrameStatus() const noexcept { return modelLoaders.seqFrameStatus; }

    Status tryGetCacheRules(const CacheRules** out) const noexcept {
        if (!out) return Status::InvalidArgument;
        *out = &rules;
        return Status::Ok;
    }

    Status tryGetMapRules(MapScenesMode* mapScenesMode, MapFunctionsMode* mapFunctionsMode) const noexcept {
        if (!mapScenesMode || !mapFunctionsMode) return Status::InvalidArgument;
        *mapScenesMode = rules.mapScenes;
        *mapFunctionsMode = rules.mapFunctions;
        return Status::Ok;
    }

    Status tryGetTextureRules(TextureRules* out) const noexcept {
        if (!out) return Status::InvalidArgument;
        *out = rules.texture;
        return Status::Ok;
    }

    Expected<GraphicsDefaults, InitError> tryGetGraphicsDefaults(Allocator& alloc) const noexcept;

    [[nodiscard]] bool indexExists(i32 indexId) const noexcept {
        return cacheSystem && cacheSystem->indexExists(indexId);
    }

    Status tryGetIndex(i32 indexId, const CacheIndex** out) const noexcept {
        if (!out) return Status::InvalidArgument;
        *out = nullptr;
        if (!cacheSystem) return Status::InvalidArgument;
        return cacheSystem->getIndex(indexId, out);
    }

    Result<Archive> tryGetArchive(i32 indexId, i32 archiveId, Allocator& alloc) const noexcept {
        if (!cacheSystem) return Result<Archive>::err(Status::InvalidArgument);
        return cacheSystem->getArchive(indexId, archiveId, alloc);
    }

    Result<Archive> tryGetArchiveKey(i32 indexId, i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept {
        if (!cacheSystem) return Result<Archive>::err(Status::InvalidArgument);
        return cacheSystem->getArchiveKey(indexId, archiveId, key, alloc);
    }

    Status tryGetMapIndex(const CacheIndex** out) const noexcept {
        if (!out) return Status::InvalidArgument;
        const CacheType cacheType = detectCacheType(cacheInfo);
        switch (cacheType) {
            case CacheType::Dat2:
                return tryGetIndex(static_cast<i32>(Dat2IndexId::maps), out);
            case CacheType::Dat:
                return tryGetIndex(static_cast<i32>(DatIndexId::maps), out);
            case CacheType::Legacy:
                return tryGetIndex(static_cast<i32>(LegacyIndexId::maps), out);
            default:
                *out = nullptr;
                return Status::Unsupported;
        }
    }

    [[nodiscard]] bool hasMapFileService() const noexcept {
        const CacheIndex* mapIndex = nullptr;
        return ok(tryGetMapIndex(&mapIndex)) && mapIndex != nullptr;
    }

    Status tryGetMapArchiveId(const char* name, i32* outArchiveId) const noexcept {
        if (!name || !outArchiveId) return Status::InvalidArgument;
        *outArchiveId = -1;
        const CacheIndex* mapIndex = nullptr;
        const Status s = tryGetMapIndex(&mapIndex);
        if (!ok(s) || !mapIndex) return s;
        *outArchiveId = mapIndex->getArchiveId(name);
        return (*outArchiveId >= 0) ? Status::Ok : Status::NotFound;
    }

    Result<Archive> tryGetMapArchive(i32 archiveId, Allocator& alloc) const noexcept {
        const CacheType cacheType = detectCacheType(cacheInfo);
        switch (cacheType) {
            case CacheType::Dat2:
                return tryGetArchive(static_cast<i32>(Dat2IndexId::maps), archiveId, alloc);
            case CacheType::Dat:
                return tryGetArchive(static_cast<i32>(DatIndexId::maps), archiveId, alloc);
            case CacheType::Legacy:
                return tryGetArchive(static_cast<i32>(LegacyIndexId::maps), archiveId, alloc);
            default:
                return Result<Archive>::err(Status::Unsupported);
        }
    }

    Result<Archive> tryGetMapArchiveKey(i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept {
        const CacheType cacheType = detectCacheType(cacheInfo);
        switch (cacheType) {
            case CacheType::Dat2:
                return tryGetArchiveKey(static_cast<i32>(Dat2IndexId::maps), archiveId, key, alloc);
            case CacheType::Dat:
                return tryGetArchiveKey(static_cast<i32>(DatIndexId::maps), archiveId, key, alloc);
            case CacheType::Legacy:
                return tryGetArchiveKey(static_cast<i32>(LegacyIndexId::maps), archiveId, key, alloc);
            default:
                return Result<Archive>::err(Status::Unsupported);
        }
    }

    Status tryGetModelsIndex(const CacheIndex** out) const noexcept {
        if (!out) return Status::InvalidArgument;
        const CacheType cacheType = detectCacheType(cacheInfo);
        switch (cacheType) {
            case CacheType::Dat2:
                return tryGetIndex(static_cast<i32>(Dat2IndexId::models), out);
            case CacheType::Dat:
                return tryGetIndex(static_cast<i32>(DatIndexId::models), out);
            case CacheType::Legacy:
                return tryGetIndex(static_cast<i32>(LegacyIndexId::models), out);
            default:
                *out = nullptr;
                return Status::Unsupported;
        }
    }

    Status tryGetSeqFramesIndex(const CacheIndex** out) const noexcept {
        if (!out) return Status::InvalidArgument;
        const CacheType cacheType = detectCacheType(cacheInfo);
        switch (cacheType) {
            case CacheType::Dat2:
                return tryGetIndex(static_cast<i32>(Dat2IndexId::animations), out);
            case CacheType::Dat:
                return tryGetIndex(static_cast<i32>(DatIndexId::animations), out);
            case CacheType::Legacy:
                return tryGetIndex(static_cast<i32>(LegacyIndexId::models), out);
            default:
                *out = nullptr;
                return Status::Unsupported;
        }
    }

    Status tryGetSpritesIndex(const CacheIndex** out) const noexcept {
        if (!out) return Status::InvalidArgument;
        if (detectCacheType(cacheInfo) != CacheType::Dat2) {
            *out = nullptr;
            return Status::Unsupported;
        }
        return tryGetIndex(static_cast<i32>(Dat2IndexId::sprites), out);
    }

    [[nodiscard]] ConfigLayerKind configKind() const noexcept { return config.kind; }
    [[nodiscard]] Status configStatus() const noexcept { return config.status; }
    [[nodiscard]] bool hasQuestTypeLoader() const noexcept {
        return config.kind == ConfigLayerKind::Dat2 &&
            config.status == Status::Ok &&
            rules.quests == QuestMode::Archive;
    }
    [[nodiscard]] bool hasSkeletalSeqLoader() const noexcept { return modelLoaders.skeletalSeqStatus == Status::Ok; }
    [[nodiscard]] Status skeletalSeqStatus() const noexcept { return modelLoaders.skeletalSeqStatus; }
    [[nodiscard]] bool hasSeqBaseService() const noexcept { return modelLoaders.seqBaseStatus == Status::Ok; }
    [[nodiscard]] Status seqBaseStatus() const noexcept { return modelLoaders.seqBaseStatus; }
    [[nodiscard]] bool hasDistinctUnderlayTypeLoader() const noexcept {
        return config.kind == ConfigLayerKind::Dat2;
    }

    // TS-style texture facade: call sites should use session methods instead of touching
    // mode-tagged texture storage directly.
    Result<Vec<i32>> tryGetTexturePixelsArgb(
        i32 id,
        i32 size,
        bool flipH,
        float brightness,
        Allocator& alloc) const noexcept {
        if (textures.status != Status::Ok) return Result<Vec<i32>>::err(textures.status);

        switch (textures.mode) {
            case TextureMode::Sprite:
                return textures.sprite.tryGetPixelsArgb(id, size, flipH, brightness, alloc);
            case TextureMode::Dat:
                return textures.dat.tryGetPixelsArgb(id, size, flipH, brightness, alloc);
            case TextureMode::Materials:
                return textures.procedural.tryGetPixelsArgb(id, size, flipH, brightness, alloc);
            case TextureMode::OldProcedural:
                return textures.oldProcedural.tryGetPixelsArgb(id, size, flipH, brightness, alloc);
        }

        return Result<Vec<i32>>::err(Status::Unsupported);
    }

    Status tryGetProceduralTextureLoader(const ProceduralTextureLoader** out) const noexcept {
        if (out) *out = nullptr;
        if (textures.status != Status::Ok) return textures.status;
        if (textures.mode != TextureMode::Materials) return Status::Unsupported;
        if (!out) return Status::InvalidArgument;
        *out = &textures.procedural;
        return Status::Ok;
    }

    Status tryLoadModel(i32 id, ModelData* out) const noexcept {
        if (modelLoaders.modelStatus != Status::Ok) return modelLoaders.modelStatus;
        if (modelLoaders.modelKind == ModelLoaders::ModelKind::Index) {
            return modelLoaders.models.tryLoad(id, out);
        }
        if (modelLoaders.modelKind == ModelLoaders::ModelKind::Legacy) {
            return modelLoaders.legacyModels.tryLoad(id, out);
        }
        return Status::Unsupported;
    }

    Status tryGetSeqFrameBytes(i32 id, Vec<u8>* out, Allocator& alloc) const noexcept {
        if (modelLoaders.seqFrameStatus != Status::Ok) return modelLoaders.seqFrameStatus;
        return modelLoaders.seqFrameBytes.tryGetBytes(id, out, alloc);
    }

    Status tryGetSkeletalSeqBytes(i32 id, Vec<u8>* out, Allocator& alloc) const noexcept {
        if (modelLoaders.skeletalSeqStatus != Status::Ok) return modelLoaders.skeletalSeqStatus;
        return modelLoaders.skeletalSeqBytes.tryGetBytes(id, out, alloc);
    }

    Status tryLoadSeqBase(i32 id, const SeqBase** out) const noexcept {
        if (modelLoaders.seqBaseStatus != Status::Ok) return modelLoaders.seqBaseStatus;
        return modelLoaders.seqBases.tryLoad(id, out);
    }

    Status tryLoadSeqFrame(i32 id, SeqFrame* out) const noexcept {
        if (modelLoaders.seqFrameStatus != Status::Ok) return modelLoaders.seqFrameStatus;
        if (modelLoaders.seqFrameKind == ModelLoaders::SeqFrameKind::Dat) {
            return modelLoaders.datSeqFrames.tryLoad(id, out);
        }
        if (modelLoaders.seqFrameKind == ModelLoaders::SeqFrameKind::Legacy) {
            return modelLoaders.legacySeqFrames.tryLoad(id, out);
        }
        return modelLoaders.seqFrames.tryLoad(id, out);
    }

    Status tryLoadSkeletalSeq(i32 id, SkeletalSeq* out) const noexcept {
        if (modelLoaders.skeletalSeqStatus != Status::Ok) return modelLoaders.skeletalSeqStatus;
        return modelLoaders.skeletalSeqs.tryLoad(id, out);
    }

    Status tryComputeSkeletalFinalMatrices(
        i32 skeletalSeqId,
        i32 frame,
        Vec<Mat4f>* outFinalMatrices,
        Allocator& alloc) const noexcept {
        if (!outFinalMatrices) return Status::InvalidArgument;
        outFinalMatrices->clear();

        SkeletalSeq seq(alloc);
        Status s = tryLoadSkeletalSeq(skeletalSeqId, &seq);
        if (!ok(s)) return s;

        const SeqBase* base = nullptr;
        s = tryLoadSeqBase(seq.baseId, &base);
        if (!ok(s)) return s;
        if (!base) return Status::NotFound;

        return computeSkeletalFinalMatrices(*base, seq, frame, outFinalMatrices, alloc);
    }

    Status tryApplySkeletalSeqToModel(
        i32 skeletalSeqId,
        i32 frame,
        ModelData* model,
        Allocator& alloc) const noexcept {
        if (!model) return Status::InvalidArgument;

        SkeletalSeq seq(alloc);
        Status s = tryLoadSkeletalSeq(skeletalSeqId, &seq);
        if (!ok(s)) return s;

        const SeqBase* base = nullptr;
        s = tryLoadSeqBase(seq.baseId, &base);
        if (!ok(s)) return s;
        if (!base) return Status::NotFound;

        return applySkeletalToModel(model, *base, seq, frame, alloc);
    }

    void clearCaches() noexcept {
        if (textures.status == Status::Ok) {
            switch (textures.mode) {
                case TextureMode::Sprite:
                    // Sprite texture loader is immutable after creation.
                    break;
                case TextureMode::Dat:
                    textures.dat.clearCache();
                    break;
                case TextureMode::Materials:
                    textures.procedural.clearCache();
                    break;
                case TextureMode::OldProcedural:
                    textures.oldProcedural.clearCache();
                    break;
            }
        }
        modelLoaders.models.clearCache();
        modelLoaders.legacyModels.clearCache();
        modelLoaders.modelBytes.clearCache();
        modelLoaders.seqFrameBytes.clearCache();
        modelLoaders.seqBases.clearCache();
        modelLoaders.datSeqFrames.clearCache();
        modelLoaders.seqFrames.clearCache();
        modelLoaders.legacySeqFrames.clearCache();
        modelLoaders.skeletalSeqs.clearCache();
    }

    // Unified config accessors across Dat2 and Dat/Legacy layouts.
    Status tryGetLocType(i32 id, const LocType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        return (config.kind == ConfigLayerKind::Dat2)
            ? config.dat2.locs.get(id, out)
            : config.datLegacy.locs.get(id, out);
    }

    Status tryGetNpcType(i32 id, const NpcType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        return (config.kind == ConfigLayerKind::Dat2)
            ? config.dat2.npcs.get(id, out)
            : config.datLegacy.npcs.get(id, out);
    }

    Status tryGetObjType(i32 id, const ObjType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        return (config.kind == ConfigLayerKind::Dat2)
            ? config.dat2.objs.get(id, out)
            : config.datLegacy.objs.get(id, out);
    }

    Status tryGetSeqType(i32 id, const SeqType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        return (config.kind == ConfigLayerKind::Dat2)
            ? config.dat2.seqs.get(id, out)
            : config.datLegacy.seqs.get(id, out);
    }

    Status tryGetSeqTypeFrameLength(const SeqType& seq, i32 frame, i32* outFrameLength) const noexcept {
        return seq.tryGetFrameLength(
            detectCacheType(cacheInfo),
            frame,
            [this](i32 frameId, i32* outLen) noexcept -> bool {
                if (!outLen) return false;
                SeqFrame seqFrame(defaultAllocator());
                const Status s = tryLoadSeqFrame(frameId, &seqFrame);
                if (!ok(s)) return false;
                *outLen = seqFrame.frameLength;
                return true;
            },
            outFrameLength);
    }

    Status tryGetSeqTypeFrameLength(i32 seqId, i32 frame, i32* outFrameLength) const noexcept {
        const SeqType* seq = nullptr;
        Status s = tryGetSeqType(seqId, &seq);
        if (!ok(s)) return s;
        if (!seq) return Status::NotFound;
        return tryGetSeqTypeFrameLength(*seq, frame, outFrameLength);
    }

    Status tryGetBasType(i32 id, const BasType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        if (config.kind != ConfigLayerKind::Dat2) {
            if (out) *out = nullptr;
            return Status::Unsupported;
        }
        return config.dat2.bas.get(id, out);
    }

    Status tryGetVarBitType(i32 id, const VarBitType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        return (config.kind == ConfigLayerKind::Dat2)
            ? config.dat2.varBits.get(id, out)
            : config.datLegacy.varbits.get(id, out);
    }

    Status tryGetOverlayFloorType(i32 id, const OverlayFloorType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        return (config.kind == ConfigLayerKind::Dat2)
            ? config.dat2.overlays.get(id, out)
            : config.datLegacy.floors.get(id, out);
    }

    Status tryGetUnderlayFloorType(i32 id, const UnderlayFloorType** out) const noexcept {
        if (config.status != Status::Ok) return config.status;
        if (config.kind != ConfigLayerKind::Dat2) {
            if (out) *out = nullptr;
            return Status::Unsupported;
        }
        return config.dat2.underlays.get(id, out);
    }

    Status tryGetQuestType(i32 id, const QuestType** out) const noexcept {
        if (!hasQuestTypeLoader()) {
            if (out) *out = nullptr;
            return Status::Unsupported;
        }
        return config.dat2.quests.get(id, out);
    }

    Status tryGetQuestTypeLoader(const QuestTypeLoader** out) const noexcept {
        if (out) *out = nullptr;
        if (!hasQuestTypeLoader()) return Status::Unsupported;
        if (!out) return Status::InvalidArgument;
        *out = &config.dat2.quests;
        return Status::Ok;
    }

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
