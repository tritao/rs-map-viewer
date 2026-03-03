#include "SceneCommandBuilderInternal.hpp"

#include "../config/loctype/LocType.hpp"
#include "../config/seqtype/SeqType.hpp"
#include "../config/vartype/VarBitType.hpp"
#include "../core/HashIndex.hpp"
#include "../map/LocPlacementsDecode.hpp"
#include "../map/TerrainConstants.hpp"
#include "../model/ModelData.hpp"
#include "../model/skeletal/SkeletalEval.hpp"
#include "../model/skeletal/SkeletalSeq.hpp"
#include "../model/seq/SeqBase.hpp"
#include "../model/seq/SeqFrame.hpp"
#include "../scene/SceneData.hpp"
#include "../util/HeightCalc.hpp"

#include <chrono>
#include <limits>
#include <new>

namespace rs {
namespace scb {

using LocBuildClock = std::chrono::steady_clock;

static i32 locElapsedUs(const LocBuildClock::time_point start) noexcept {
    const auto us = std::chrono::duration_cast<std::chrono::microseconds>(LocBuildClock::now() - start);
    if (us.count() > static_cast<long long>(std::numeric_limits<i32>::max())) {
        return std::numeric_limits<i32>::max();
    }
    if (us.count() < 0) {
        return 0;
    }
    return static_cast<i32>(us.count());
}

static Status tryDecodeSeqBaseFromBlob(
    const SceneCommandBuildInput& input,
    i32 baseId,
    SeqBase* outBase,
    Allocator& alloc) noexcept;

// SeqFrame bytes decode used by the runtime map-render path.
// Accepted formats:
// - Dat2 raw SeqFrame bytes (decoded using SeqBase bytes from input.seqBase*)
static Status decodeRuntimeSeqFrameBytes(
    const SceneCommandBuildInput& input,
    Span<const u8> data,
    SeqBase* outBase,
    SeqFrame* outFrame,
    Allocator& alloc) noexcept {
    if (!outBase || !outFrame) {
        return Status::InvalidArgument;
    }
    *outBase = SeqBase(-1, alloc);
    *outFrame = SeqFrame(alloc);
    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;

    Uint8ArrayReader reader(data, 0);
    if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 610) {
        u8 ignored = 0;
        Status s = reader.readUnsignedByte(&ignored);
        if (!ok(s)) return s;
    }
    u16 baseIdU16 = 0;
    Status s = reader.readUnsignedShort(&baseIdU16);
    if (!ok(s)) return s;
    const i32 baseId = static_cast<i32>(baseIdU16);
    if (baseId < 0) return Status::BadFormat;

    s = tryDecodeSeqBaseFromBlob(input, baseId, outBase, alloc);
    if (!ok(s)) return s;

    static SeqFrameDecodeScratch scratch(defaultAllocator());
    return decodeDat2SeqFrameWithBase(
        cacheInfo,
        *outBase,
        data,
        &scratch,
        alloc,
        outFrame);
}

static inline i32 animCosQ16(i32 angle) noexcept {
    const Span<const i32> cosine = HeightCalc::cosine65536();
    const i32 idx = angle & 2047;
    return cosine[static_cast<std::size_t>(idx)];
}

static inline i32 animSinQ16(i32 angle) noexcept {
    // sin(a) = cos(a - 512) for 2048-step circle.
    return animCosQ16(angle - 512);
}

struct AnimLabelTables final {
    Vec<Vec<i32>> vertexLabels;
    Vec<Vec<i32>> faceLabels;
    explicit AnimLabelTables(Allocator& alloc) noexcept : vertexLabels(alloc), faceLabels(alloc) {}
};

static Status buildAnimLabelTables(const ModelData& model, AnimLabelTables* out, Allocator& alloc) noexcept {
    if (!out) return Status::InvalidArgument;
    out->vertexLabels.clear();
    out->faceLabels.clear();

    if (model.hasVertexSkins && !model.vertexSkins.empty()) {
        i32 maxSkin = -1;
        const i32 vertexCount = model.usedVertexCount > 0 ? model.usedVertexCount : model.verticesCount;
        const std::size_t n = static_cast<std::size_t>(
            vertexCount < static_cast<i32>(model.vertexSkins.size()) ? vertexCount : static_cast<i32>(model.vertexSkins.size()));
        for (std::size_t i = 0; i < n; i++) {
            const i32 skin = model.vertexSkins[i];
            if (skin >= 0 && skin > maxSkin) maxSkin = skin;
        }
        if (maxSkin >= 0) {
            auto rr = out->vertexLabels.resize(static_cast<std::size_t>(maxSkin + 1));
            if (!rr.isOk()) return rr.status();
            Vec<i32> counts(alloc);
            rr = counts.resize(static_cast<std::size_t>(maxSkin + 1));
            if (!rr.isOk()) return rr.status();
            for (std::size_t i = 0; i < counts.size(); i++) counts[i] = 0;
            for (std::size_t i = 0; i < n; i++) {
                const i32 skin = model.vertexSkins[i];
                if (skin >= 0) counts[static_cast<std::size_t>(skin)]++;
            }
            for (std::size_t s = 0; s < out->vertexLabels.size(); s++) {
                rr = out->vertexLabels[s].resize(static_cast<std::size_t>(counts[s]));
                if (!rr.isOk()) return rr.status();
                counts[s] = 0;
            }
            for (std::size_t vi = 0; vi < n; vi++) {
                const i32 skin = model.vertexSkins[vi];
                if (skin < 0) continue;
                const std::size_t si = static_cast<std::size_t>(skin);
                const i32 off = counts[si]++;
                out->vertexLabels[si][static_cast<std::size_t>(off)] = static_cast<i32>(vi);
            }
        }
    }

    if (model.hasFaceSkins && !model.faceSkins.empty()) {
        i32 maxSkin = -1;
        const std::size_t n = model.faceSkins.size() < static_cast<std::size_t>(model.faceCount)
                                  ? model.faceSkins.size()
                                  : static_cast<std::size_t>(model.faceCount);
        for (std::size_t i = 0; i < n; i++) {
            const i32 skin = model.faceSkins[i];
            if (skin >= 0 && skin > maxSkin) maxSkin = skin;
        }
        if (maxSkin >= 0) {
            auto rr = out->faceLabels.resize(static_cast<std::size_t>(maxSkin + 1));
            if (!rr.isOk()) return rr.status();
            Vec<i32> counts(alloc);
            rr = counts.resize(static_cast<std::size_t>(maxSkin + 1));
            if (!rr.isOk()) return rr.status();
            for (std::size_t i = 0; i < counts.size(); i++) counts[i] = 0;
            for (std::size_t i = 0; i < n; i++) {
                const i32 skin = model.faceSkins[i];
                if (skin >= 0) counts[static_cast<std::size_t>(skin)]++;
            }
            for (std::size_t s = 0; s < out->faceLabels.size(); s++) {
                rr = out->faceLabels[s].resize(static_cast<std::size_t>(counts[s]));
                if (!rr.isOk()) return rr.status();
                counts[s] = 0;
            }
            for (std::size_t fi = 0; fi < n; fi++) {
                const i32 skin = model.faceSkins[fi];
                if (skin < 0) continue;
                const std::size_t si = static_cast<std::size_t>(skin);
                const i32 off = counts[si]++;
                out->faceLabels[si][static_cast<std::size_t>(off)] = static_cast<i32>(fi);
            }
        }
    }
    return Status::Ok;
}

static void applySeqTransformToModel(
    ModelData* model,
    const AnimLabelTables& labels,
    SeqTransformType type,
    const Vec<i32>& groupLabels,
    i32 tx,
    i32 ty,
    i32 tz,
    i32* inOutOriginX,
    i32* inOutOriginY,
    i32* inOutOriginZ) noexcept {
    if (!model || !inOutOriginX || !inOutOriginY || !inOutOriginZ) {
        return;
    }
    i32 originX = *inOutOriginX;
    i32 originY = *inOutOriginY;
    i32 originZ = *inOutOriginZ;

    const auto forEachVertex = [&](auto&& fn) noexcept {
        for (std::size_t li = 0; li < groupLabels.size(); li++) {
            const i32 label = groupLabels[li];
            if (label < 0) continue;
            const std::size_t lidx = static_cast<std::size_t>(label);
            if (lidx >= labels.vertexLabels.size()) continue;
            const Vec<i32>& vs = labels.vertexLabels[lidx];
            for (std::size_t vi = 0; vi < vs.size(); vi++) {
                const i32 v = vs[vi];
                if (v < 0 || static_cast<std::size_t>(v) >= model->verticesX.size()) continue;
                fn(static_cast<std::size_t>(v));
            }
        }
    };

    const auto forEachFace = [&](auto&& fn) noexcept {
        for (std::size_t li = 0; li < groupLabels.size(); li++) {
            const i32 label = groupLabels[li];
            if (label < 0) continue;
            const std::size_t lidx = static_cast<std::size_t>(label);
            if (lidx >= labels.faceLabels.size()) continue;
            const Vec<i32>& fs = labels.faceLabels[lidx];
            for (std::size_t fi = 0; fi < fs.size(); fi++) {
                const i32 f = fs[fi];
                if (f < 0) continue;
                fn(static_cast<std::size_t>(f));
            }
        }
    };

    switch (type) {
        case SeqTransformType::ORIGIN: {
            i64 sumX = 0;
            i64 sumY = 0;
            i64 sumZ = 0;
            i32 count = 0;
            forEachVertex([&](std::size_t v) noexcept {
                sumX += static_cast<i64>((*model).verticesX[v]);
                sumY += static_cast<i64>((*model).verticesY[v]);
                sumZ += static_cast<i64>((*model).verticesZ[v]);
                count++;
            });
            if (count > 0) {
                originX = tx + static_cast<i32>(sumX / count);
                originY = ty + static_cast<i32>(sumY / count);
                originZ = tz + static_cast<i32>(sumZ / count);
            } else {
                originX = tx;
                originY = ty;
                originZ = tz;
            }
            break;
        }
        case SeqTransformType::TRANSLATE: {
            forEachVertex([&](std::size_t v) noexcept {
                (*model).verticesX[v] += tx;
                (*model).verticesY[v] += ty;
                (*model).verticesZ[v] += tz;
            });
            break;
        }
        case SeqTransformType::ROTATE: {
            const i32 angleX = (tx & 0xff) * 8;
            const i32 angleY = (ty & 0xff) * 8;
            const i32 angleZ = (tz & 0xff) * 8;
            forEachVertex([&](std::size_t v) noexcept {
                i32 x = (*model).verticesX[v] - originX;
                i32 y = (*model).verticesY[v] - originY;
                i32 z = (*model).verticesZ[v] - originZ;
                // roll (Z)
                if (angleZ != 0) {
                    const i32 sinQ16 = animSinQ16(angleZ);
                    const i32 cosQ16 = animCosQ16(angleZ);
                    const i32 temp = static_cast<i32>((static_cast<i64>(sinQ16) * y + static_cast<i64>(cosQ16) * x) >> 16);
                    y = static_cast<i32>((static_cast<i64>(cosQ16) * y - static_cast<i64>(sinQ16) * x) >> 16);
                    x = temp;
                }
                // pitch (X)
                if (angleX != 0) {
                    const i32 sinQ16 = animSinQ16(angleX);
                    const i32 cosQ16 = animCosQ16(angleX);
                    const i32 temp = static_cast<i32>((static_cast<i64>(cosQ16) * y - static_cast<i64>(sinQ16) * z) >> 16);
                    z = static_cast<i32>((static_cast<i64>(sinQ16) * y + static_cast<i64>(cosQ16) * z) >> 16);
                    y = temp;
                }
                // yaw (Y)
                if (angleY != 0) {
                    const i32 sinQ16 = animSinQ16(angleY);
                    const i32 cosQ16 = animCosQ16(angleY);
                    const i32 temp = static_cast<i32>((static_cast<i64>(sinQ16) * z + static_cast<i64>(cosQ16) * x) >> 16);
                    z = static_cast<i32>((static_cast<i64>(cosQ16) * z - static_cast<i64>(sinQ16) * x) >> 16);
                    x = temp;
                }
                (*model).verticesX[v] = x + originX;
                (*model).verticesY[v] = y + originY;
                (*model).verticesZ[v] = z + originZ;
            });
            break;
        }
        case SeqTransformType::SCALE: {
            forEachVertex([&](std::size_t v) noexcept {
                i32 x = (*model).verticesX[v] - originX;
                i32 y = (*model).verticesY[v] - originY;
                i32 z = (*model).verticesZ[v] - originZ;
                x = static_cast<i32>((static_cast<i64>(tx) * x) / 128);
                y = static_cast<i32>((static_cast<i64>(ty) * y) / 128);
                z = static_cast<i32>((static_cast<i64>(tz) * z) / 128);
                (*model).verticesX[v] = x + originX;
                (*model).verticesY[v] = y + originY;
                (*model).verticesZ[v] = z + originZ;
            });
            break;
        }
        case SeqTransformType::ALPHA: {
            if (!model->hasFaceAlphas || model->faceAlphas.empty()) {
                break;
            }
            forEachFace([&](std::size_t f) noexcept {
                if (f >= model->faceAlphas.size()) return;
                i32 alpha = static_cast<i32>(model->faceAlphas[f]) & 0xff;
                alpha += tx * 8;
                if (alpha < 0) alpha = 0;
                if (alpha > 255) alpha = 255;
                model->faceAlphas[f] = static_cast<i8>(alpha & 0xff);
            });
            break;
        }
        case SeqTransformType::LIGHT: {
            if (model->faceColors.empty()) {
                break;
            }
            forEachFace([&](std::size_t f) noexcept {
                if (f >= model->faceColors.size()) return;
                const i32 color = static_cast<i32>(model->faceColors[f] & 0xffffu);
                i32 hue = (color >> 10) & 0x3f;
                i32 sat = (color >> 7) & 0x7;
                i32 light = color & 0x7f;
                hue = (hue + tx) & 0x3f;
                sat += ty;
                if (sat < 0) sat = 0;
                if (sat > 7) sat = 7;
                light += tz;
                if (light < 0) light = 0;
                if (light > 127) light = 127;
                model->faceColors[f] = static_cast<u16>((hue << 10) | (sat << 7) | light);
            });
            break;
        }
        default:
            break;
    }

    *inOutOriginX = originX;
    *inOutOriginY = originY;
    *inOutOriginZ = originZ;
}

static void applyBridgeSeqFrameToModelClassic(
    ModelData* model,
    const AnimLabelTables& labels,
    const SeqBase& base,
    const SeqFrame& frame) noexcept {
    if (!model) return;
    i32 originX = 0;
    i32 originY = 0;
    i32 originZ = 0;

    const i32 tc = frame.transformCount;
    for (i32 i = 0; i < tc; i++) {
        const std::size_t ii = static_cast<std::size_t>(i);
        if (ii >= frame.transformGroups.size() ||
            ii >= frame.transformX.size() ||
            ii >= frame.transformY.size() ||
            ii >= frame.transformZ.size() ||
            ii >= frame.resetOriginGroups.size()) {
            break;
        }
        const i32 group = frame.transformGroups[ii];
        if (group < 0 || group >= base.count) continue;
        const SeqTransformType type = base.types[static_cast<std::size_t>(group)];

        const i32 resetGroup = frame.resetOriginGroups[ii];
        if (resetGroup != -1 && resetGroup >= 0 && resetGroup < base.count) {
            applySeqTransformToModel(
                model,
                labels,
                SeqTransformType::ORIGIN,
                base.labels[static_cast<std::size_t>(resetGroup)],
                0,
                0,
                0,
                &originX,
                &originY,
                &originZ);
        }

        applySeqTransformToModel(
            model,
            labels,
            type,
            base.labels[static_cast<std::size_t>(group)],
            frame.transformX[ii],
            frame.transformY[ii],
            frame.transformZ[ii],
            &originX,
            &originY,
            &originZ);
    }
}

Status tryDecodeBridgeSeqFrameFromBlob(
    const SceneCommandBuildInput& input,
    i32 frameId,
    SeqBase* outBase,
    SeqFrame* outFrame,
    Allocator& alloc) noexcept {
    if (!outBase || !outFrame) {
        return Status::InvalidArgument;
    }
    *outBase = SeqBase(-1, alloc);
    *outFrame = SeqFrame(alloc);
    if (frameId < 0) {
        return Status::NotFound;
    }
    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 6, frameId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.tryLoadDatSeqFrame) {
            return input.tryLoadDatSeqFrame(
                input.datSeqFrameCtx,
                frameId,
                outBase,
                outFrame,
                alloc);
        }
        if (input.tryLoadLegacySeqFrame) {
            return input.tryLoadLegacySeqFrame(
                input.legacySeqFrameCtx,
                frameId,
                outBase,
                outFrame,
                alloc);
        }
        return Status::NotFound;
    }
    Status decodeStatus = decodeRuntimeSeqFrameBytes(
        input,
        bytes,
        outBase,
        outFrame,
        alloc);
    if (ok(decodeStatus)) {
        return decodeStatus;
    }
    // Keep runtime behavior aligned with TS loader semantics: when a frame id is
    // present in uploaded per-frame blobs but bytes are not decodable in this
    // path (legacy/dat differences), try runtime callbacks before hard-failing.
    if (input.tryLoadDatSeqFrame) {
        const Status fallback = input.tryLoadDatSeqFrame(
            input.datSeqFrameCtx,
            frameId,
            outBase,
            outFrame,
            alloc);
        if (ok(fallback)) {
            return fallback;
        }
    }
    if (input.tryLoadLegacySeqFrame) {
        const Status fallback = input.tryLoadLegacySeqFrame(
            input.legacySeqFrameCtx,
            frameId,
            outBase,
            outFrame,
            alloc);
        if (ok(fallback)) {
            return fallback;
        }
    }
    return decodeStatus;
}

Status applyClassicSeqFrameToModelDataTS(
    ModelData* model,
    const SeqBase& base,
    const SeqFrame& frame,
    Allocator& alloc) noexcept {
    if (!model) {
        return Status::InvalidArgument;
    }
    AnimLabelTables labelTables(alloc);
    const Status ls = buildAnimLabelTables(*model, &labelTables, alloc);
    if (!ok(ls)) {
        return ls;
    }
    applyBridgeSeqFrameToModelClassic(model, labelTables, base, frame);
    return Status::Ok;
}

static Status tryDecodeSeqBaseFromBlob(
    const SceneCommandBuildInput& input,
    i32 baseId,
    SeqBase* outBase,
    Allocator& alloc) noexcept {
    if (!outBase) return Status::InvalidArgument;
    *outBase = SeqBase(-1, alloc);
    Span<const u8> data{};
    Status s = tryGetTypeEntryBytesSpan(input, 15, baseId, &data);
    if (!ok(s) || data.size() <= 0) return ok(s) ? Status::NotFound : s;
    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;
    return decodeDat2SeqBase(cacheInfo, baseId, data, outBase, alloc);
}

static Status tryDecodeSkeletalSeqFromBlob(
    const SceneCommandBuildInput& input,
    i32 skeletalSeqId,
    SkeletalSeq* outSeq,
    SeqBase* outBase,
    Allocator& alloc) noexcept {
    if (!outSeq || !outBase) return Status::InvalidArgument;
    *outSeq = SkeletalSeq(alloc);
    *outBase = SeqBase(-1, alloc);

    Span<const u8> data{};
    Status s = tryGetTypeEntryBytesSpan(input, 16, skeletalSeqId, &data);
    if (!ok(s) || data.size() <= 0) return ok(s) ? Status::NotFound : s;
    if (data.size() < 3) return Status::BadFormat;

    // Dat2 skeletal seq header: u8 version, u16 baseId (big-endian).
    const i32 baseId =
        static_cast<i32>((static_cast<u16>(data[1]) << 8) | static_cast<u16>(data[2]));
    if (baseId < 0) return Status::BadFormat;

    s = tryDecodeSeqBaseFromBlob(input, baseId, outBase, alloc);
    if (!ok(s)) return s;
    if (!outBase->hasSkeletalBase) return Status::BadFormat;

    return decodeDat2SkeletalSeqWithBase(*outBase, skeletalSeqId, data, outSeq);
}

// TS parity for `SceneBuffer.addModelAnimFrame` alpha decision:
// model face is transparent iff `alpha < 0xff || (textureId != -1 && textureLoader.isTransparent(textureId))`.
// We intentionally avoid loc-geometry render-type filters here because TS animated placeholder alpha buckets
// are driven by `framesAlpha` (from face split), not by emitted loc-geometry element counts.
static bool modelHasTransparentFacesForAnimatedFrameTs(
    const SceneCommandBuildInput& input,
    const ModelData& model) noexcept {
    for (i32 fi = 0; fi < model.faceCount; fi++) {
        if (fi < 0 || fi >= static_cast<i32>(model.faceColors.size())) {
            continue;
        }

        i32 textureId = -1;
        if (model.hasFaceTextures && fi >= 0 && fi < static_cast<i32>(model.faceTextures.size())) {
            textureId = static_cast<i32>(model.faceTextures[static_cast<std::size_t>(fi)]);
        }

        // TS parity: `getModelFaces` filters out non-drawable faces based on renderType and texture.
        // This matters for `framesAlpha` because "transparent" is computed over drawable faces only.
        i32 renderType = 0;
        const bool hasRenderTypes =
            model.hasFaceRenderTypes && fi >= 0 && fi < static_cast<i32>(model.faceRenderTypes.size());
        if (hasRenderTypes) {
            renderType = static_cast<i32>(model.faceRenderTypes[static_cast<std::size_t>(fi)]) & 0xff;
        }
        bool drawable = false;
        if (hasRenderTypes) {
            drawable = (renderType == 0) || (renderType == 1 && textureId != -1);
        } else {
            // When the renderTypes array is absent, TS treats types 0/1 as drawable.
            drawable = (renderType == 0) || (renderType == 1);
        }
        if (!drawable) {
            continue;
        }

        i32 alpha = 0xff;
        if (model.hasFaceAlphas &&
            textureId == -1 &&
            fi >= 0 &&
            fi < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        if (alpha < 0xff) {
            return true;
        }
        if (textureId != -1 && findTypeBlobIndex(input.textureTransparentIds, textureId) >= 0) {
            return true;
        }
    }
    return false;
}

// TS Model.copyAnimated(..., shallowTransparencies=false) behavior:
// allocate faceAlphas to faceCount even when source model has no alpha array.
static Status ensureAnimatedModelHasFaceAlphas(ModelData* model) noexcept {
    if (!model) {
        return Status::InvalidArgument;
    }
    const i32 rawFaceCount = model->faceCount;
    if (rawFaceCount <= 0) {
        model->hasFaceAlphas = true;
        return Status::Ok;
    }
    const std::size_t faceCount = static_cast<std::size_t>(rawFaceCount);
    const std::size_t oldSize = model->faceAlphas.size();
    if (oldSize < faceCount) {
        auto rr = model->faceAlphas.resize(faceCount);
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = oldSize; i < faceCount; i++) {
            model->faceAlphas[i] = 0;
        }
    }
    model->hasFaceAlphas = true;
    return Status::Ok;
}

template <typename T, typename Less>
static void sortInPlace(T* data, std::size_t n, Less less) noexcept {
    if (!data || n < 2) {
        return;
    }

    struct Range final {
        std::size_t lo = 0;
        std::size_t hi = 0; // exclusive
    };

    Range stack[64]{};
    std::size_t sp = 0;
    std::size_t lo = 0;
    std::size_t hi = n;

    const auto insertionSort = [&](std::size_t a, std::size_t b) noexcept {
        for (std::size_t i = a + 1; i < b; i++) {
            T key = rs::move(data[i]);
            std::size_t j = i;
            while (j > a && less(key, data[j - 1])) {
                data[j] = rs::move(data[j - 1]);
                j--;
            }
            data[j] = rs::move(key);
        }
    };

    while (true) {
        while (hi - lo > 16) {
            const std::size_t mid = lo + ((hi - lo) >> 1);
            const std::size_t last = hi - 1;

            // Median-of-three: order (lo, mid, last) and use mid as pivot source.
            if (less(data[mid], data[lo])) rs::swap(data[mid], data[lo]);
            if (less(data[last], data[mid])) rs::swap(data[last], data[mid]);
            if (less(data[mid], data[lo])) rs::swap(data[mid], data[lo]);

            rs::swap(data[mid], data[last]);
            const T& pivot = data[last];

            std::size_t store = lo;
            for (std::size_t i = lo; i < last; i++) {
                if (less(data[i], pivot)) {
                    rs::swap(data[store], data[i]);
                    store++;
                }
            }
            rs::swap(data[store], data[last]);

            const std::size_t leftLo = lo;
            const std::size_t leftHi = store;
            const std::size_t rightLo = store + 1;
            const std::size_t rightHi = hi;

            // Tail-sort the smaller side; push the larger side.
            const std::size_t leftSize = leftHi - leftLo;
            const std::size_t rightSize = rightHi - rightLo;
            if (leftSize < rightSize) {
                if (rightSize > 1) {
                    if (sp < (sizeof(stack) / sizeof(stack[0]))) {
                        stack[sp++] = Range{rightLo, rightHi};
                    }
                }
                lo = leftLo;
                hi = leftHi;
            } else {
                if (leftSize > 1) {
                    if (sp < (sizeof(stack) / sizeof(stack[0]))) {
                        stack[sp++] = Range{leftLo, leftHi};
                    }
                }
                lo = rightLo;
                hi = rightHi;
            }
        }

        insertionSort(lo, hi);

        if (sp == 0) {
            break;
        }
        const Range r = stack[--sp];
        lo = r.lo;
        hi = r.hi;
    }
}

struct LocCommandGroup final {
    i32 locTypeId = -1;
    i32 debugGroupKeySignature = 0;
    i32 modelSignature = 0;
    i32 modelIdsHash = 0;
    i32 placementType = 0;
    i32 rotation = 0;
    i32 modelId = -1;
    i32 level = 0;
    i32 priority = 0;
    i32 firstSeenOrder = 2147483647;
    i32 placementCategory = 3;
    bool forceMerge = false;
    bool contourSensitive = false;
    bool hasBounds = false;
    i32 boundsMinX = 0;
    i32 boundsMaxX = 0;
    i32 boundsMinZ = 0;
    i32 boundsMaxZ = 0;
    i32 opaqueElementsPerInstance = 0;
    i32 alphaElementsPerInstance = 0;
    // Keep instanced groups geometry-equivalent; TS groups by final model hash.
    i32 contourKeySceneHeight = 0;
    i32 contourKeySceneX = 0;
    i32 contourKeySceneZ = 0;
    i32 contourKeyGround = 0;
    i32 contourKeyProfileHash = 0;
    // Representative mergeNormals entry index (LocType.mergeNormals). -1 for regular groups.
    i32 mergeNormalsEntryIndex = -1;
    Vec<ModelInfo> mergedInstances;
    Vec<ModelInfo> interactInstances;
    Vec<i32> sceneHeights;
    Vec<i32> contourSceneXs;
    Vec<i32> contourSceneZs;
    Vec<u8> includeLodFlags;
    Vec<i32> placementOrders;

    explicit LocCommandGroup(Allocator& alloc) noexcept
        : mergedInstances(alloc),
          interactInstances(alloc),
          sceneHeights(alloc),
          contourSceneXs(alloc),
          contourSceneZs(alloc),
          includeLodFlags(alloc),
          placementOrders(alloc) {}
};

struct SceneLocCommandGroupKeyHasher final {
    std::size_t operator()(const SceneLocCommandGroupKey& key) const noexcept {
        const auto mix = [](u32 hash, i32 value) noexcept -> u32 {
            return (hash ^ static_cast<u32>(value)) * 16777619u;
        };

        // Hash must follow sceneLocCommandGroupKeysEqual semantics exactly:
        // contourSceneX/contourSceneZ only participate when forceMerge=true.
        u32 h = 2166136261u;
        h = mix(h, key.modelSignature);
        h = mix(h, key.modelIdsHash);
        h = mix(h, key.placementType);
        h = mix(h, key.rotation);
        h = mix(h, key.level);
        h = mix(h, key.priority);
        h = mix(h, key.forceMerge ? 1 : 0);
        h = mix(h, key.contourSensitive ? 1 : 0);
        if (key.contourSensitive) {
            h = mix(h, key.contourSceneHeight);
            if (key.forceMerge) {
                h = mix(h, key.contourSceneX);
                h = mix(h, key.contourSceneZ);
            }
            h = mix(h, key.contourGround);
            h = mix(h, key.contourProfileHash);
        }

        h ^= h >> 16;
        h *= 0x7feb352du;
        h ^= h >> 15;
        h *= 0x846ca68bu;
        h ^= h >> 16;
        return static_cast<std::size_t>(h);
    }
};

struct SceneLocCommandGroupKeyEquals final {
    bool operator()(
        const SceneLocCommandGroupKey& a,
        const SceneLocCommandGroupKey& b) const noexcept {
        return sceneLocCommandGroupKeysEqual(a, b);
    }
};

using LocCommandGroupLookupIndex =
    HashIndex<SceneLocCommandGroupKey, i32, SceneLocCommandGroupKeyHasher, SceneLocCommandGroupKeyEquals>;

struct LocMergeBucketKey final {
    bool transparent = false;
    bool includeLod = false;
    i32 level = 0;
    i32 priority = 0;
};

struct LocMergeBucketKeyHasher final {
    std::size_t operator()(const LocMergeBucketKey& key) const noexcept {
        u32 h = 2166136261u;
        h = (h ^ static_cast<u32>(key.transparent ? 1 : 0)) * 16777619u;
        h = (h ^ static_cast<u32>(key.includeLod ? 1 : 0)) * 16777619u;
        h = (h ^ static_cast<u32>(key.level)) * 16777619u;
        h = (h ^ static_cast<u32>(key.priority)) * 16777619u;
        h ^= h >> 16;
        return static_cast<std::size_t>(h);
    }
};

struct LocMergeBucketKeyEquals final {
    bool operator()(const LocMergeBucketKey& a, const LocMergeBucketKey& b) const noexcept {
        return a.transparent == b.transparent &&
               a.includeLod == b.includeLod &&
               a.level == b.level &&
               a.priority == b.priority;
    }
};

using LocMergeBucketLookupIndex =
    HashIndex<LocMergeBucketKey, i32, LocMergeBucketKeyHasher, LocMergeBucketKeyEquals>;

struct I32KeyHasher final {
    std::size_t operator()(i32 value) const noexcept {
        u32 h = static_cast<u32>(value);
        h ^= h >> 16;
        h *= 0x7feb352du;
        h ^= h >> 15;
        h *= 0x846ca68bu;
        h ^= h >> 16;
        return static_cast<std::size_t>(h);
    }
};

struct I32KeyEquals final {
    bool operator()(i32 a, i32 b) const noexcept {
        return a == b;
    }
};

using I32LookupIndex = HashIndex<i32, unsigned char, I32KeyHasher, I32KeyEquals>;
using I32ToI32LookupIndex = HashIndex<i32, i32, I32KeyHasher, I32KeyEquals>;

struct LocMergeBucketEntry final {
    i32 groupIndex = -1;
    i32 instanceIndex = -1;
    i32 elementsPerInstance = 0;
};

struct LocMergeBucket final {
    bool transparent = false;
    bool includeLod = false;
    i32 level = 0;
    i32 priority = 0;
    i32 firstSeenOrder = 2147483647;
    i32 placementCategory = 3;
    i32 debugPlanOpIndex = -1;
    Vec<LocMergeBucketEntry> entries;

    explicit LocMergeBucket(Allocator& alloc) noexcept : entries(alloc) {}
};

// TS-style loc command planning: first decide instanced vs merged-bucket emission (and record
// plan-digest ops), then execute instanced ops, then execute merged buckets. This mirrors the
// TS `SceneCommandPlan` split (plan vs execute) without changing the underlying algorithms.
struct LocInstancedOp final {
    i32 representativeGroupIndex = -1;
    bool transparent = false;
    i32 elementsPerInstance = 0;
    i32 instancesOffset = 0;
    i32 instancesCount = 0;
    i32 lodInstancesOffset = 0;
    i32 lodInstancesCount = 0;
};

struct MergeNormalsScratch final {
    i32 stamp = 1;
    Vec<i32> model0VertexStamp;
    Vec<i32> model1VertexStamp;

    explicit MergeNormalsScratch(Allocator& alloc) noexcept
        : model0VertexStamp(alloc),
          model1VertexStamp(alloc) {}

    Status nextStamp(i32 size0, i32 size1) noexcept {
        if (size0 < 0 || size1 < 0) {
            return Status::InvalidArgument;
        }
        const std::size_t n0 = static_cast<std::size_t>(size0);
        const std::size_t n1 = static_cast<std::size_t>(size1);
        if (model0VertexStamp.size() != n0) {
            auto rr = model0VertexStamp.resize(n0);
            if (!rr.isOk()) return rr.status();
            for (std::size_t i = 0; i < n0; i++) model0VertexStamp[i] = 0;
        }
        if (model1VertexStamp.size() != n1) {
            auto rr = model1VertexStamp.resize(n1);
            if (!rr.isOk()) return rr.status();
            for (std::size_t i = 0; i < n1; i++) model1VertexStamp[i] = 0;
        }
        // Avoid stamp overflow and stale matches.
        if (stamp > 0x3fffffff) {
            stamp = 1;
            for (std::size_t i = 0; i < model0VertexStamp.size(); i++) model0VertexStamp[i] = 0;
            for (std::size_t i = 0; i < model1VertexStamp.size(); i++) model1VertexStamp[i] = 0;
        } else {
            stamp++;
        }
        return Status::Ok;
    }
};

	struct MergeNormalsEntry final {
	    i32 placementIndex = -1;
	    i32 level = 0;
	    i32 tileX = 0;
	    i32 tileY = 0;
	    i32 sizeX = 1;
	    i32 sizeY = 1;
	    i32 centerHeight = 0;

	    // Do not store pointers into decoded-type caches (Vec-backed and can reallocate/move).
	    i32 locTypeId = -1;
	    i32 placementType = 0;
	    i32 rotation = 0;
	    i32 modelId = -1;

    // Bounds from ModelData.calculateBounds() used by mergeNormals.
    i32 boundsMinX = 0;
    i32 boundsMaxX = 0;
    i32 boundsMinZ = 0;
    i32 boundsMaxZ = 0;
    i32 boundsMaxY = 0; // TS `minHeight` (max vertex Y)

    ModelData model;
    ModelFaceLightingState lighting;
    ModelFaceStats stats{};

    explicit MergeNormalsEntry(Allocator& alloc) noexcept
        : model(alloc),
          lighting(alloc) {}
};

struct LocCommandPlan final {
    Vec<LocCommandGroup> groups;
    Vec<LocMergeBucket> mergeBuckets;
    Vec<LocInstancedOp> instancedOps;
    Vec<ModelInfo> instancedInstancesPool;
    Vec<ModelInfo> instancedLodInstancesPool;
    Vec<LocAnimatedPlaceholder> animatedEntries;
    Vec<LocAnimatedGroupPlan> animatedGroups;
    Vec<MergeNormalsEntry> mergeNormalsEntries;
    // Each loc placement can expand into up to 2 model variants (TS expandLocPlacementModelVariants).
    // For mergeNormals parity we may need up to 2 pre-decoded entries per placement.
    Vec<i32> mergeNormalsEntry0ByPlacement;
    Vec<i32> mergeNormalsEntry1ByPlacement;

    explicit LocCommandPlan(Allocator& alloc) noexcept
        : groups(alloc),
          mergeBuckets(alloc),
          instancedOps(alloc),
          instancedInstancesPool(alloc),
          instancedLodInstancesPool(alloc),
          animatedEntries(alloc),
          animatedGroups(alloc),
          mergeNormalsEntries(alloc),
          mergeNormalsEntry0ByPlacement(alloc),
          mergeNormalsEntry1ByPlacement(alloc) {}
};

static Status planLocCommandsFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    LocCommandPlan* outPlan,
    Allocator& alloc) noexcept;

static Status executeLocCommandsFromPlan(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedSeqTypeCache* seqTypeCache,
    LocCommandPlan* plan,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

static Status appendAnimatedLocFrameGeometryFromPlan(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<const LocAnimatedGroupPlan> groups,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedSeqTypeCache* seqTypeCache,
    SceneLocAnimatedTickInit* outTickInit,
    Vec<i32>* outGroupFrameOffsetsBase,
    Vec<i32>* outGroupFrameCountsBase,
    Vec<i32>* outGroupFrameOffsetsAlpha,
    Vec<i32>* outGroupFrameCountsAlpha,
    Vec<u8>* outGroupHasAlpha,
    Allocator& alloc) noexcept;

static Status buildLocRenderCommandPlan(
    const SceneCommandBuildInput& input,
    Span<const LocCommandGroup> groups,
    Vec<SceneCommandPlanDebugOp>* planOps,
    Vec<LocMergeBucket>* outMergeBuckets,
    Vec<LocInstancedOp>* outInstancedOps,
    Vec<ModelInfo>* outInstancedInstancesPool,
    Vec<ModelInfo>* outInstancedLodInstancesPool,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

static Status executeLocInstancedOps(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<LocCommandGroup> groups,
    Span<const LocInstancedOp> ops,
    Span<const ModelInfo> instancesPool,
    Span<const ModelInfo> lodInstancesPool,
    Span<const MergeNormalsEntry> mergeNormalsEntries,
    SceneBuffer* buffer,
    Vec<i32>* scratchModelIds,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

static Status executeLocMergeBuckets(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<LocCommandGroup> groups,
    Span<LocMergeBucket> mergeBuckets,
    Span<const MergeNormalsEntry> mergeNormalsEntries,
    SceneBuffer* buffer,
    Vec<i32>* scratchModelIds,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

static Status emitLocAnimatedPlaceholders(
    Span<const LocAnimatedPlaceholder> entries,
    SceneBuffer* buffer,
    SceneLocAnimatedTickInit* outTickInit) noexcept;

static void computeLocScenePosition(
    const LocType& locType,
    const LocPlacement& placement,
    i32 variantRotation,
    i32 border,
    i32 tileX,
    i32 tileY,
    i32 wallDecorDisplacement,
    i32* outSceneX,
    i32* outSceneZ) noexcept {
    if (!outSceneX || !outSceneZ) {
        return;
    }

    i32 sceneX = (tileX - border) * 128 + 64;
    i32 sceneZ = (tileY - border) * 128 + 64;

    if (placement.type == 10 || placement.type == 11) {
        i32 sizeX = locType.sizeX;
        i32 sizeY = locType.sizeY;
        if ((placement.rotation & 1) != 0) {
            const i32 swap = sizeX;
            sizeX = sizeY;
            sizeY = swap;
        }
        sceneX = (tileX - border) * 128 + sizeX * 64;
        sceneZ = (tileY - border) * 128 + sizeY * 64;
    }

    static constexpr i32 kDispX[4] = {1, 0, -1, 0};
    static constexpr i32 kDispY[4] = {0, -1, 0, 1};
    static constexpr i32 kDiagDispX[4] = {1, -1, -1, 1};
    static constexpr i32 kDiagDispY[4] = {-1, -1, 1, 1};

    const i32 rot = placement.rotation & 3;
    const i32 decorDisplacement =
        wallDecorDisplacement > 0
            ? wallDecorDisplacement
            : LocType::DEFAULT_DECOR_DISPLACEMENT;
    if (placement.type == 5) {
        sceneX += decorDisplacement * kDispX[rot];
        sceneZ += decorDisplacement * kDispY[rot];
    } else if (placement.type == 6) {
        const i32 diagonalDisplacement = decorDisplacement / 2;
        sceneX += diagonalDisplacement * kDiagDispX[rot];
        sceneZ += diagonalDisplacement * kDiagDispY[rot];
    } else if (placement.type == 8) {
        // TS `SceneBuilder` diagonal-double wall decorations apply the same displacement to both
        // entities (entity0/entity1) via a single `WallDecoration.offsetX/offsetY`. Do not
        // special-case primary/secondary variant rotations here.
        (void)variantRotation;
        const i32 diagonalDisplacement = decorDisplacement / 2;
        sceneX += diagonalDisplacement * kDiagDispX[rot];
        sceneZ += diagonalDisplacement * kDiagDispY[rot];
    }

    *outSceneX = sceneX;
    *outSceneZ = sceneZ;
}

static void computeLocContourSampleOrigin(
    const LocType& locType,
    i32 rotation,
    i32 tileX,
    i32 tileY,
    i32* outSceneX,
    i32* outSceneZ) noexcept {
    if (!outSceneX || !outSceneZ) {
        return;
    }
    i32 sizeX = locType.sizeX;
    i32 sizeY = locType.sizeY;
    if ((rotation & 1) != 0) {
        const i32 swap = sizeX;
        sizeX = sizeY;
        sizeY = swap;
    }
    *outSceneX = (tileX << 7) + (sizeX << 6);
    *outSceneZ = (tileY << 7) + (sizeY << 6);
}

static i32 computeLocSceneHeight(
    const SceneData& scene,
    const LocType& locType,
    i32 level,
    i32 tileX,
    i32 tileY,
    i32 rotation) noexcept {
    i32 sizeX = locType.sizeX;
    i32 sizeY = locType.sizeY;
    if ((rotation & 1) != 0) {
        const i32 swap = sizeX;
        sizeX = sizeY;
        sizeY = swap;
    }

    // Match TS SceneBuilder: clamp center-height sample window when the placement touches the
    // scene edge. This avoids slightly different averages for out-of-window placements.
    i32 startX = 0;
    i32 endX = 0;
    if (tileX + sizeX <= scene.sizeX) {
        startX = (sizeX >> 1) + tileX;
        endX = ((sizeX + 1) >> 1) + tileX;
    } else {
        startX = tileX;
        endX = tileX + 1;
    }
    i32 startY = 0;
    i32 endY = 0;
    if (tileY + sizeY <= scene.sizeY) {
        startY = (sizeY >> 1) + tileY;
        endY = ((sizeY + 1) >> 1) + tileY;
    } else {
        startY = tileY;
        endY = tileY + 1;
    }

    if (!isWithinHeightBounds(scene, level, startX, startY) ||
        !isWithinHeightBounds(scene, level, endX, startY) ||
        !isWithinHeightBounds(scene, level, startX, endY) ||
        !isWithinHeightBounds(scene, level, endX, endY)) {
        return 0;
    }

    return (
        scene.height(level, endX, endY) +
        scene.height(level, startX, endY) +
        scene.height(level, startX, startY) +
        scene.height(level, endX, startY)) >>
        2;
}

[[maybe_unused]] static i32 computeLocContourProfileHash(
    const SceneData& scene,
    const LocType& locType,
    i32 level,
    i32 tileX,
    i32 tileY,
    i32 rotation,
    bool hasBounds,
    i32 minX,
    i32 maxX,
    i32 minZ,
    i32 maxZ) noexcept {
    if (locType.contourGroundType <= 0) {
        return 0;
    }

    i32 sizeX = locType.sizeX;
    i32 sizeY = locType.sizeY;
    if ((rotation & 1) != 0) {
        const i32 swap = sizeX;
        sizeX = sizeY;
        sizeY = swap;
    }

    const i32 entityX = (tileX << 7) + (sizeX << 6);
    const i32 entityZ = (tileY << 7) + (sizeY << 6);
    i32 sx = tileX;
    i32 ex = tileX + 1;
    i32 sz = tileY;
    i32 ez = tileY + 1;
    if (hasBounds) {
        const i32 startX = entityX + minX;
        const i32 endX = entityX + maxX;
        const i32 startZ = entityZ + minZ;
        const i32 endZ = entityZ + maxZ;
        sx = startX >> 7;
        ex = (endX + 127) >> 7;
        sz = startZ >> 7;
        ez = (endZ + 127) >> 7;
    }

    if (!isWithinHeightBounds(scene, level, sx, sz) ||
        !isWithinHeightBounds(scene, level, ex, sz) ||
        !isWithinHeightBounds(scene, level, sx, ez) ||
        !isWithinHeightBounds(scene, level, ex, ez)) {
        return 0;
    }

    const i32 h00 = scene.height(level, sx, sz);
    const i32 h10 = scene.height(level, ex, sz);
    const i32 h01 = scene.height(level, sx, ez);
    const i32 h11 = scene.height(level, ex, ez);

    const i32 dx = (h10 + h11) - (h00 + h01);
    const i32 dz = (h01 + h11) - (h00 + h10);
    const auto quantizeSlope = [](i32 v) noexcept -> i32 {
        if (v > 32) {
            return 1;
        }
        if (v < -32) {
            return -1;
        }
        return 0;
    };

    const i32 qx = quantizeSlope(dx);
    const i32 qz = quantizeSlope(dz);
    const i32 slopeClass = (qx + 1) * 3 + (qz + 1);
    return ((locType.contourGroundType & 0x7) << 4) | (slopeClass & 0xf);
}

static Status buildLocRenderCommandPlan(
    const SceneCommandBuildInput& input,
    Span<const LocCommandGroup> groups,
    Vec<SceneCommandPlanDebugOp>* planOps,
    Vec<LocMergeBucket>* outMergeBuckets,
    Vec<LocInstancedOp>* outInstancedOps,
    Vec<ModelInfo>* outInstancedInstancesPool,
    Vec<ModelInfo>* outInstancedLodInstancesPool,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!outMergeBuckets || !outInstancedOps || !outInstancedInstancesPool ||
        !outInstancedLodInstancesPool) {
        return Status::InvalidArgument;
    }
    outMergeBuckets->clear();
    outInstancedOps->clear();
    outInstancedInstancesPool->clear();
    outInstancedLodInstancesPool->clear();

    // Validate group parallel arrays once.
    for (std::size_t gi = 0; gi < groups.size(); gi++) {
        const LocCommandGroup& group = groups[gi];
        if (group.mergedInstances.empty()) {
            continue;
        }
        if (group.mergedInstances.size() != group.interactInstances.size() ||
            group.mergedInstances.size() != group.sceneHeights.size() ||
            group.mergedInstances.size() != group.contourSceneXs.size() ||
            group.mergedInstances.size() != group.contourSceneZs.size() ||
            group.mergedInstances.size() != group.includeLodFlags.size() ||
            group.mergedInstances.size() != group.placementOrders.size()) {
            return Status::SizeMismatch;
        }
    }

    // TS behavior: merge decisions are computed per model hash group, not per (type,rot,level,prio).
    // Our group keys are stricter than TS, so cluster groups by modelSignature here.
    Vec<i32> groupOrder(alloc);
    auto rrOrder = groupOrder.resize(groups.size());
    if (!rrOrder.isOk()) {
        return rrOrder.status();
    }
    for (std::size_t i = 0; i < groups.size(); i++) {
        groupOrder[i] = static_cast<i32>(i);
    }
    sortInPlace(
        groupOrder.data(),
        groupOrder.size(),
        [&](i32 a, i32 b) noexcept -> bool {
            const LocCommandGroup& ga = groups[static_cast<std::size_t>(a)];
            const LocCommandGroup& gb = groups[static_cast<std::size_t>(b)];
            if (ga.modelSignature != gb.modelSignature) {
                return ga.modelSignature < gb.modelSignature;
            }
            if (ga.firstSeenOrder != gb.firstSeenOrder) {
                return ga.firstSeenOrder < gb.firstSeenOrder;
            }
            return a < b;
        });

    struct ModelSigCluster final {
        i32 modelSignature = 0;
        i32 firstSeenOrder = 2147483647;
        i32 firstGroupIndex = 2147483647;
        std::size_t begin = 0;
        std::size_t end = 0;
    };
    Vec<ModelSigCluster> clusters(alloc);
    std::size_t cursor = 0;
    while (cursor < groupOrder.size()) {
        const i32 gi0 = groupOrder[cursor];
        const i32 sig = groups[static_cast<std::size_t>(gi0)].modelSignature;
        ModelSigCluster cluster{};
        cluster.modelSignature = sig;
        cluster.begin = cursor;
        cluster.end = cursor + 1;
        cluster.firstSeenOrder = groups[static_cast<std::size_t>(gi0)].firstSeenOrder;
        cluster.firstGroupIndex = gi0;
        while (cluster.end < groupOrder.size()) {
            const i32 giN = groupOrder[cluster.end];
            const LocCommandGroup& gN = groups[static_cast<std::size_t>(giN)];
            if (gN.modelSignature != sig) {
                break;
            }
            if (gN.firstSeenOrder < cluster.firstSeenOrder) {
                cluster.firstSeenOrder = gN.firstSeenOrder;
            }
            if (giN < cluster.firstGroupIndex) {
                cluster.firstGroupIndex = giN;
            }
            cluster.end++;
        }
        auto rrCluster = clusters.pushBack(cluster);
        if (!rrCluster.isOk()) {
            return rrCluster.status();
        }
        cursor = cluster.end;
    }

    sortInPlace(
        clusters.data(),
        clusters.size(),
        [&](const ModelSigCluster& a, const ModelSigCluster& b) noexcept -> bool {
            if (a.firstSeenOrder != b.firstSeenOrder) {
                return a.firstSeenOrder < b.firstSeenOrder;
            }
            if (a.firstGroupIndex != b.firstGroupIndex) {
                return a.firstGroupIndex < b.firstGroupIndex;
            }
            return a.modelSignature < b.modelSignature;
        });

    struct OrderedInst final {
        i32 order = 0;
        i32 encounter = 0;
        ModelInfo inst{};
        bool includeLod = false;
        bool forceMerge = false;
    };
    struct OrderedMergeEntry final {
        i32 order = 0;
        i32 encounter = 0;
        i32 groupIndex = -1;
        i32 instanceIndex = -1;
        i32 elementsPerInstance = 0;
    };
    Vec<OrderedInst> orderedInstances(alloc);
    Vec<OrderedMergeEntry> orderedMergeEntries(alloc);
    LocMergeBucketLookupIndex mergeBucketLookup(alloc);
    {
        auto rrReserveBuckets = mergeBucketLookup.reserveForExpectedCount(groups.size() + 16);
        if (!rrReserveBuckets.isOk()) {
            return rrReserveBuckets.status();
        }
    }

    const auto addInstanceToMergeBuckets = [&](i32 groupIndex,
                                               i32 instanceIndex,
                                               bool transparent,
                                               i32 elementsPerInstance) noexcept -> Status {
        const LocCommandGroup& group = groups[static_cast<std::size_t>(groupIndex)];
        const bool includeLod = group.includeLodFlags[static_cast<std::size_t>(instanceIndex)] != 0;
        const i32 instanceLevel = group.mergedInstances[static_cast<std::size_t>(instanceIndex)].level;
        const i32 instancePriority = group.mergedInstances[static_cast<std::size_t>(instanceIndex)].priority;
        const LocMergeBucketKey bucketKey{
            .transparent = transparent,
            .includeLod = includeLod,
            .level = instanceLevel,
            .priority = instancePriority,
        };

        i32 bucketIndex = -1;
        (void)mergeBucketLookup.find(bucketKey, &bucketIndex);
        if (bucketIndex < 0) {
            LocMergeBucket bucket(alloc);
            bucket.transparent = transparent;
            bucket.includeLod = includeLod;
            bucket.level = instanceLevel;
            bucket.priority = instancePriority;
            bucket.firstSeenOrder = group.firstSeenOrder;
            bucket.placementCategory = group.placementCategory;
            auto rrBucket = outMergeBuckets->pushBack(rs::move(bucket));
            if (!rrBucket.isOk()) {
                return rrBucket.status();
            }
            bucketIndex = static_cast<i32>(outMergeBuckets->size() - 1);
            auto rrInsertBucket = mergeBucketLookup.insertIfMissing(bucketKey, bucketIndex);
            if (!rrInsertBucket.isOk()) {
                return rrInsertBucket.status();
            }
        }
        if (bucketIndex < 0 || bucketIndex >= static_cast<i32>(outMergeBuckets->size())) {
            return Status::OutOfRange;
        }

        LocMergeBucket& bucket = (*outMergeBuckets)[static_cast<std::size_t>(bucketIndex)];
        if (group.firstSeenOrder < bucket.firstSeenOrder) {
            bucket.firstSeenOrder = group.firstSeenOrder;
        }
        if (group.placementCategory < bucket.placementCategory) {
            bucket.placementCategory = group.placementCategory;
        }

        LocMergeBucketEntry entry{};
        entry.groupIndex = groupIndex;
        entry.instanceIndex = instanceIndex;
        entry.elementsPerInstance = elementsPerInstance;
        auto rrEntry = bucket.entries.pushBack(entry);
        if (!rrEntry.isOk()) {
            return rrEntry.status();
        }
        return Status::Ok;
    };

    for (std::size_t ci = 0; ci < clusters.size(); ci++) {
        const ModelSigCluster& cluster = clusters[ci];

        // Totals over all non-forceMerge instances in this modelSignature cluster.
        i32 instancedCountTotal = 0;
        i32 repGroupIndex = -1;
        for (std::size_t oi = cluster.begin; oi < cluster.end; oi++) {
            const i32 gi = groupOrder[oi];
            const LocCommandGroup& group = groups[static_cast<std::size_t>(gi)];
            if (repGroupIndex < 0) {
                repGroupIndex = gi;
            }
            if (!group.forceMerge) {
                instancedCountTotal += static_cast<i32>(group.interactInstances.size());
                if (groups[static_cast<std::size_t>(repGroupIndex)].forceMerge) {
                    repGroupIndex = gi;
                }
            }
        }
        if (repGroupIndex < 0) {
            continue;
        }
        const LocCommandGroup& repGroup = groups[static_cast<std::size_t>(repGroupIndex)];
        const SceneModelMergeDecision mergeDecision = decideSceneModelMergeStrategy(
            instancedCountTotal,
            repGroup.opaqueElementsPerInstance / 3,
            repGroup.alphaElementsPerInstance / 3,
            input.minimizeDrawCalls);

        const auto appendForceMergePass = [&](bool transparent) noexcept -> Status {
            orderedMergeEntries.clear();
            i32 encounter = 0;
            for (std::size_t oi = cluster.begin; oi < cluster.end; oi++) {
                const i32 gi = groupOrder[oi];
                const LocCommandGroup& group = groups[static_cast<std::size_t>(gi)];
                if (!group.forceMerge) {
                    continue;
                }
                const i32 elementsPerInstance =
                    transparent ? group.alphaElementsPerInstance : group.opaqueElementsPerInstance;
                if (elementsPerInstance <= 0 && transparent) {
                    continue;
                }
                for (std::size_t ii = 0; ii < group.mergedInstances.size(); ii++) {
                    OrderedMergeEntry rec{};
                    rec.order = group.placementOrders[ii];
                    rec.encounter = encounter++;
                    rec.groupIndex = gi;
                    rec.instanceIndex = static_cast<i32>(ii);
                    rec.elementsPerInstance = elementsPerInstance;
                    auto rrRec = orderedMergeEntries.pushBack(rec);
                    if (!rrRec.isOk()) {
                        return rrRec.status();
                    }
                }
            }
            sortInPlace(
                orderedMergeEntries.data(),
                orderedMergeEntries.size(),
                [&](const OrderedMergeEntry& a, const OrderedMergeEntry& b) noexcept -> bool {
                    if (a.order != b.order) {
                        return a.order < b.order;
                    }
                    return a.encounter < b.encounter;
                });
            for (std::size_t i = 0; i < orderedMergeEntries.size(); i++) {
                const OrderedMergeEntry& rec = orderedMergeEntries[i];
                const Status s = addInstanceToMergeBuckets(
                    rec.groupIndex,
                    rec.instanceIndex,
                    transparent,
                    rec.elementsPerInstance);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        };

        const auto appendMergeByPlacementPass = [&](bool transparent) noexcept -> Status {
            orderedMergeEntries.clear();
            i32 encounter = 0;
            for (std::size_t oi = cluster.begin; oi < cluster.end; oi++) {
                const i32 gi = groupOrder[oi];
                const LocCommandGroup& group = groups[static_cast<std::size_t>(gi)];
                if (group.forceMerge) {
                    continue;
                }
                const i32 elementsPerInstance =
                    transparent ? group.alphaElementsPerInstance : group.opaqueElementsPerInstance;
                if (elementsPerInstance <= 0 && transparent) {
                    continue;
                }
                for (std::size_t ii = 0; ii < group.mergedInstances.size(); ii++) {
                    OrderedMergeEntry rec{};
                    rec.order = group.placementOrders[ii];
                    rec.encounter = encounter++;
                    rec.groupIndex = gi;
                    rec.instanceIndex = static_cast<i32>(ii);
                    rec.elementsPerInstance = elementsPerInstance;
                    auto rrRec = orderedMergeEntries.pushBack(rec);
                    if (!rrRec.isOk()) {
                        return rrRec.status();
                    }
                }
            }
            sortInPlace(
                orderedMergeEntries.data(),
                orderedMergeEntries.size(),
                [&](const OrderedMergeEntry& a, const OrderedMergeEntry& b) noexcept -> bool {
                    if (a.order != b.order) {
                        return a.order < b.order;
                    }
                    return a.encounter < b.encounter;
                });
            for (std::size_t i = 0; i < orderedMergeEntries.size(); i++) {
                const OrderedMergeEntry& rec = orderedMergeEntries[i];
                    const Status s = addInstanceToMergeBuckets(
                        rec.groupIndex,
                        rec.instanceIndex,
                        transparent,
                        rec.elementsPerInstance);
                    if (!ok(s)) {
                        return s;
                    }
                }
            if (debugOut) {
                debugOut->debugLocMergeByPlacementCount++;
            }
            return Status::Ok;
        };

        const auto appendInstancedPass = [&](bool transparent) noexcept -> Status {
            const i32 elementsPerInstance =
                transparent ? repGroup.alphaElementsPerInstance : repGroup.opaqueElementsPerInstance;
            const bool zeroOnlyPass = elementsPerInstance <= 0;
            if (zeroOnlyPass && transparent) {
                return Status::Ok;
            }

            orderedInstances.clear();
            i32 encounter = 0;
            for (std::size_t oi = cluster.begin; oi < cluster.end; oi++) {
                const i32 gi = groupOrder[oi];
                const LocCommandGroup& group = groups[static_cast<std::size_t>(gi)];
                for (std::size_t ii = 0; ii < group.interactInstances.size(); ii++) {
                    OrderedInst rec{};
                    rec.order = group.placementOrders[ii];
                    rec.encounter = encounter++;
                    rec.inst = group.interactInstances[ii];
                    rec.includeLod = (group.includeLodFlags[ii] != 0);
                    rec.forceMerge = group.forceMerge;
                    auto rrRec = orderedInstances.pushBack(rec);
                    if (!rrRec.isOk()) {
                        return rrRec.status();
                    }
                }
            }
            sortInPlace(
                orderedInstances.data(),
                orderedInstances.size(),
                [&](const OrderedInst& a, const OrderedInst& b) noexcept -> bool {
                    if (a.order != b.order) {
                        return a.order < b.order;
                    }
                    return a.encounter < b.encounter;
                });

            const i32 instancesOffset = static_cast<i32>(outInstancedInstancesPool->size());
            if (instancesOffset < 0) {
                return Status::OutOfRange;
            }
            for (std::size_t i = 0; i < orderedInstances.size(); i++) {
                auto rr = outInstancedInstancesPool->pushBack(orderedInstances[i].inst);
                if (!rr.isOk()) {
                    return rr.status();
                }
            }
            const i32 instancesCount = static_cast<i32>(orderedInstances.size());

            const i32 lodOffset = static_cast<i32>(outInstancedLodInstancesPool->size());
            if (lodOffset < 0) {
                return Status::OutOfRange;
            }
            for (std::size_t i = 0; i < orderedInstances.size(); i++) {
                const OrderedInst& rec = orderedInstances[i];
                // TS lodInstances are derived from instancedModels only (forceMerge excluded).
                if (rec.forceMerge) {
                    continue;
                }
                if (!rec.includeLod) {
                    continue;
                }
                auto rr = outInstancedLodInstancesPool->pushBack(rec.inst);
                if (!rr.isOk()) {
                    return rr.status();
                }
            }
            const i32 lodCount =
                static_cast<i32>(outInstancedLodInstancesPool->size()) - lodOffset;

            if (planOps && !zeroOnlyPass) {
                const i32 faceCount = elementsPerInstance / 3;
                if (faceCount > 0) {
                    SceneCommandPlanDebugOp op{};
                    op.kind = SceneCommandPlanDebugOpKind::Instanced;
                    op.transparent = transparent;
                    op.sourceKind = 1; // loc
                    op.typeId = repGroup.locTypeId;
                    op.placementTypeHint = repGroup.placementType;
                    op.placementRotationHint = repGroup.rotation;
                    op.modelIdHint = repGroup.modelId;
                    op.modelIdsHashHint = repGroup.modelIdsHash;
                    // Debug hints only (instanced ops can span multiple levels/priorities).
                    op.level = repGroup.level;
                    op.priority = repGroup.priority;
                    op.modelHash = cluster.modelSignature;
                    op.faceCount = faceCount;
                    op.instanceCount = instancesCount;
                    op.lodInstanceCount = lodCount;
                    auto rrOp = planOps->pushBack(op);
                    if (!rrOp.isOk()) {
                        return rrOp.status();
                    }
                }
            }

            LocInstancedOp op{};
            op.representativeGroupIndex = repGroupIndex;
            op.transparent = transparent;
            op.elementsPerInstance = elementsPerInstance;
            op.instancesOffset = instancesOffset;
            op.instancesCount = instancesCount;
            op.lodInstancesOffset = lodOffset;
            op.lodInstancesCount = lodCount;
            auto rrOp = outInstancedOps->pushBack(op);
            if (!rrOp.isOk()) {
                return rrOp.status();
            }

            if (debugOut) {
                debugOut->debugLocInstancedGroupCount++;
            }
            return Status::Ok;
        };

        // Match TS `buildSceneCommandPlanFromSceneModels` order exactly:
        // 1) force-merge opaque, 2) force-merge transparent,
        // 3) instanced opaque (merged or instanced op), 4) instanced transparent.
        Status s = appendForceMergePass(false);
        if (!ok(s)) {
            return s;
        }
        s = appendForceMergePass(true);
        if (!ok(s)) {
            return s;
        }

        if (mergeDecision.mergeOpaque) {
            s = appendMergeByPlacementPass(false);
        } else {
            s = appendInstancedPass(false);
        }
        if (!ok(s)) {
            return s;
        }

        if (mergeDecision.mergeTransparent) {
            s = appendMergeByPlacementPass(true);
        } else {
            s = appendInstancedPass(true);
        }
        if (!ok(s)) {
            return s;
        }
    }

    if (planOps) {
        // Match TS ordering: all instanced ops first, then merged groups in first-insertion order.
        for (std::size_t bi = 0; bi < outMergeBuckets->size(); bi++) {
            const LocMergeBucket& bucket = (*outMergeBuckets)[bi];
            const std::size_t countSz = bucket.entries.size();
            if (countSz > static_cast<std::size_t>(2147483647)) {
                return Status::OutOfRange;
            }
            SceneCommandPlanDebugOp op{};
            op.kind = SceneCommandPlanDebugOpKind::MergedGroup;
            op.transparent = bucket.transparent;
            op.lowDetail = !bucket.includeLod;
            op.level = bucket.level;
            op.priority = bucket.priority;
            op.modelCount = static_cast<i32>(countSz);
            auto rrOp = planOps->pushBack(op);
            if (!rrOp.isOk()) {
                return rrOp.status();
            }
        }
    }

    return Status::Ok;
}

static Status executeLocInstancedOps(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<LocCommandGroup> groups,
    Span<const LocInstancedOp> ops,
    Span<const ModelInfo> instancesPool,
    Span<const ModelInfo> lodInstancesPool,
    Span<const MergeNormalsEntry> mergeNormalsEntries,
    SceneBuffer* buffer,
    Vec<i32>* scratchModelIds,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !scratchModelIds || !indexCount || !locTypeCache) {
        return Status::InvalidArgument;
    }

    for (std::size_t oi = 0; oi < ops.size(); oi++) {
        const LocInstancedOp& op = ops[oi];
        if (op.representativeGroupIndex < 0 ||
            op.representativeGroupIndex >= static_cast<i32>(groups.size())) {
            return Status::OutOfRange;
        }
        LocCommandGroup& group = groups[static_cast<std::size_t>(op.representativeGroupIndex)];
        const bool transparent = op.transparent;
        const i32 elementsPerInstance = op.elementsPerInstance;
        const bool zeroOnlyPass = elementsPerInstance <= 0;
        const i32 pass = transparent ? 1 : 0;

        if (op.instancesOffset < 0 || op.instancesCount < 0 ||
            op.lodInstancesOffset < 0 || op.lodInstancesCount < 0) {
            return Status::OutOfRange;
        }
        const std::size_t instOff = static_cast<std::size_t>(op.instancesOffset);
        const std::size_t instCount = static_cast<std::size_t>(op.instancesCount);
        const std::size_t lodOff = static_cast<std::size_t>(op.lodInstancesOffset);
        const std::size_t lodCount = static_cast<std::size_t>(op.lodInstancesCount);
        if (instOff + instCount > instancesPool.size()) {
            return Status::OutOfRange;
        }
        if (lodOff + lodCount > lodInstancesPool.size()) {
            return Status::OutOfRange;
        }
        const Span<const ModelInfo> opInstances(instancesPool.data() + instOff, instCount);
        const Span<const ModelInfo> opLodInstances(lodInstancesPool.data() + lodOff, lodCount);

        const DebugCommandProvenance groupPassProvenance = makeLocCommandProvenance(
            DebugCommandSourceKind::LocInstanced,
            group.locTypeId,
            group.placementType,
            group.rotation,
            group.placementType,
            group.rotation,
            pass,
            1,
            group.debugGroupKeySignature);

        if (zeroOnlyPass) {
            if (!transparent) {
                const i32 zeroOffsetBytes = (*indexCount) * 4;
                for (std::size_t ii = 0; ii < opInstances.size(); ii++) {
                    ModelInfo zeroInst = opInstances[ii];
                    zeroInst.sceneX = 0;
                    zeroInst.sceneZ = 0;
                    zeroInst.heightOffset = 0;
                    zeroInst.contourGround = static_cast<i32>(ContourGroundType::None);
                    const Status zis = buffer->emitInteractCommand(
                        zeroOffsetBytes,
                        0,
                        Span<const ModelInfo>(&zeroInst, 1),
                        false,
                        /*includeLod=*/false,
                        /*defer=*/false,
                        &groupPassProvenance);
                    if (!ok(zis)) {
                        return zis;
                    }
                }
            }
            continue;
        }

        const LocType* resolved = nullptr;
        const Status ts = tryDecodeLocTypeFromBlob(
            input,
            locTypeCache,
            group.locTypeId,
            &resolved,
            alloc);
        if (!ok(ts) || !resolved) {
            continue;
        }
        const MergeNormalsEntry* mergeEntry = nullptr;
        if (group.mergeNormalsEntryIndex >= 0 &&
            group.mergeNormalsEntryIndex < static_cast<i32>(mergeNormalsEntries.size())) {
            const MergeNormalsEntry& candidate =
                mergeNormalsEntries[static_cast<std::size_t>(group.mergeNormalsEntryIndex)];
            if (candidate.locTypeId == group.locTypeId &&
                candidate.placementType == group.placementType &&
                candidate.rotation == group.rotation) {
                mergeEntry = &candidate;
            }
        }
        if (!mergeEntry) {
            if (!collectLocTypeModelIdsForVariant(*resolved, group.placementType, scratchModelIds) ||
                scratchModelIds->empty()) {
                continue;
            }
        }

        const i32 modelOffsetBytes = (*indexCount) * 4;
        i32 generatedElements = 0;
        LocPlacement placement{};
        placement.id = group.locTypeId;
        placement.type = group.placementType;
        placement.rotation = group.rotation;
        placement.level = 0;
        const i32 sceneHeight = 0;
        const i32 contourSceneX = group.contourSensitive ? group.contourKeySceneX : 0;
        const i32 contourSceneZ = group.contourSensitive ? group.contourKeySceneZ : 0;
        const bool applyContour = false;
        Status gs = Status::Ok;
        if (mergeEntry) {
            gs = appendLocPlacementGeometryFromDecodedModelWithLightingState(
                input,
                scene,
                *resolved,
                placement,
                0,
                0,
                contourSceneX,
                contourSceneZ,
                sceneHeight,
                applyContour,
                mergeEntry->model,
                mergeEntry->lighting,
                transparent,
                debugOut,
                &buffer->vertices,
                &buffer->indices,
                &generatedElements,
                alloc);
        } else {
            gs = appendLocPlacementGeometry(
                input,
                scene,
                *resolved,
                placement,
                0,
                0,
                contourSceneX,
                contourSceneZ,
                sceneHeight,
                applyContour,
                Span<const i32>(scratchModelIds->data(), scratchModelIds->size()),
                transparent,
                debugOut,
                &buffer->vertices,
                &buffer->indices,
                &generatedElements,
                alloc);
        }
        if (!ok(gs)) {
            return gs;
        }
        if (generatedElements != elementsPerInstance) {
            if (debugOut) {
                const i32 delta = elementsPerInstance - generatedElements;
                debugOut->debugGeometryElementMismatchCount++;
                debugOut->debugGeometryElementMismatchTotalDelta += (delta >= 0) ? delta : -delta;
                if ((delta >= 0 ? delta : -delta) > debugOut->debugGeometryElementMismatchMaxDelta) {
                    debugOut->debugGeometryElementMismatchMaxDelta = (delta >= 0) ? delta : -delta;
                    debugOut->debugGeometryElementMismatchSampleTypeId = group.locTypeId;
                    debugOut->debugGeometryElementMismatchSamplePlacementType = 0;
                    debugOut->debugGeometryElementMismatchSampleRotation = 0;
                }
            }
        }

        const i32 effectiveElements = generatedElements;
        const Status ms = buffer->emitMergedCommand(
            modelOffsetBytes,
            effectiveElements,
            opInstances,
            transparent,
            /*includeLod=*/false,
            /*defer=*/false,
            &groupPassProvenance);
        if (!ok(ms)) {
            return ms;
        }
        const Status is = buffer->emitInteractCommand(
            modelOffsetBytes,
            effectiveElements,
            opInstances,
            transparent,
            /*includeLod=*/false,
            /*defer=*/false,
            &groupPassProvenance);
        if (!ok(is)) {
            return is;
        }

        if (!opLodInstances.empty()) {
            const DrawBucketKey lodBucket = transparent ? DrawBucketKey::LodAlpha : DrawBucketKey::Lod;
            const DrawBucketKey interactLodBucket =
                transparent ? DrawBucketKey::InteractLodAlpha : DrawBucketKey::InteractLod;

            Status ls = buffer->emitCommandToBucket(
                lodBucket,
                modelOffsetBytes,
                effectiveElements,
                opLodInstances,
                /*defer=*/false,
                &groupPassProvenance);
            if (!ok(ls)) {
                return ls;
            }
            ls = buffer->emitCommandToBucket(
                interactLodBucket,
                modelOffsetBytes,
                effectiveElements,
                opLodInstances,
                /*defer=*/false,
                &groupPassProvenance);
            if (!ok(ls)) {
                return ls;
            }
        }

        *indexCount += effectiveElements;
    }

    return Status::Ok;
}

static Status executeLocMergeBuckets(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<LocCommandGroup> groups,
    Span<LocMergeBucket> mergeBuckets,
    Span<const MergeNormalsEntry> mergeNormalsEntries,
    SceneBuffer* buffer,
    Vec<i32>* scratchModelIds,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !scratchModelIds || !indexCount || !locTypeCache) {
        return Status::InvalidArgument;
    }
    (void)scratchModelIds;

    struct PreparedLocGroupModel final {
        i32 groupIndex = -1;
        ModelData model;
        ModelFaceLightingState lighting;

        explicit PreparedLocGroupModel(Allocator& alloc_) noexcept
            : model(alloc_),
              lighting(alloc_) {}
    };

    Vec<PreparedLocGroupModel> preparedGroups(alloc);
    I32ToI32LookupIndex preparedGroupLookup(alloc);
    constexpr i32 kPreparedGroupSkip = -1;
    {
        auto rrPreparedReserve = preparedGroupLookup.reserveForExpectedCount(groups.size() + 1);
        if (!rrPreparedReserve.isOk()) {
            return rrPreparedReserve.status();
        }
        auto rrPreparedVec = preparedGroups.reserve(groups.size() / 2 + 8);
        if (!rrPreparedVec.isOk()) {
            return rrPreparedVec.status();
        }
    }

    i32 cachedGroupIndex = -1;
    const LocType* cachedResolved = nullptr;
    const MergeNormalsEntry* cachedMergeEntry = nullptr;
    bool cachedSkipGroup = false;
    Vec<i32> cachedModelIds(alloc);
    bool cachedPreparedModelReady = false;
    const ModelData* cachedPreparedModel = nullptr;
    const ModelFaceLightingState* cachedPreparedLighting = nullptr;
    const auto refreshGroupCache =
        [&](i32 groupIndex, const LocCommandGroup& group) noexcept -> Status {
            cachedGroupIndex = groupIndex;
            cachedResolved = nullptr;
            cachedMergeEntry = nullptr;
            cachedSkipGroup = false;
            cachedModelIds.clear();
            cachedPreparedModelReady = false;
            cachedPreparedModel = nullptr;
            cachedPreparedLighting = nullptr;

            const Status ts = tryDecodeLocTypeFromBlob(
                input,
                locTypeCache,
                group.locTypeId,
                &cachedResolved,
                alloc);
            if (!ok(ts) || !cachedResolved) {
                cachedSkipGroup = true;
                return Status::Ok;
            }
            if (group.mergeNormalsEntryIndex >= 0 &&
                group.mergeNormalsEntryIndex < static_cast<i32>(mergeNormalsEntries.size())) {
                const MergeNormalsEntry& candidate =
                    mergeNormalsEntries[static_cast<std::size_t>(group.mergeNormalsEntryIndex)];
                if (candidate.locTypeId == group.locTypeId &&
                    candidate.placementType == group.placementType &&
                    candidate.rotation == group.rotation) {
                    cachedMergeEntry = &candidate;
                }
            }
            if (cachedMergeEntry) {
                return Status::Ok;
            }

            i32 preparedEntryIndex = -2;
            if (preparedGroupLookup.find(groupIndex, &preparedEntryIndex)) {
                if (preparedEntryIndex == kPreparedGroupSkip) {
                    cachedSkipGroup = true;
                    return Status::Ok;
                }
                if (preparedEntryIndex >= 0 &&
                    static_cast<std::size_t>(preparedEntryIndex) < preparedGroups.size()) {
                    const PreparedLocGroupModel& prepared =
                        preparedGroups[static_cast<std::size_t>(preparedEntryIndex)];
                    cachedPreparedModel = &prepared.model;
                    cachedPreparedLighting = &prepared.lighting;
                    cachedPreparedModelReady = true;
                    return Status::Ok;
                }
            }

            if (!collectLocTypeModelIdsForVariant(
                    *cachedResolved,
                    group.placementType,
                    &cachedModelIds) ||
                cachedModelIds.empty()) {
                cachedSkipGroup = true;
                return Status::Ok;
            }

            // Hot path optimization: for single-model variants, decode+light once per group
            // for the merged pass and reuse whenever this group reappears.
            if (cachedModelIds.size() == 1) {
                ModelData preparedModel(alloc);
                const Status ms = decodeLocModelFromBlobForPlacement(
                    input,
                    *cachedResolved,
                    group.placementType,
                    group.rotation,
                    cachedModelIds[0],
                    &preparedModel,
                    /*applyDiagonalNormalVariantRotation=*/true,
                    alloc);
                if (!ok(ms)) {
                    cachedSkipGroup = true;
                    auto rrSkip = preparedGroupLookup.insertIfMissing(groupIndex, kPreparedGroupSkip);
                    if (!rrSkip.isOk()) {
                        return rrSkip.status();
                    }
                    return Status::Ok;
                }
                ModelFaceLightingState preparedLighting(alloc);
                const Status ls = initModelFaceLightingState(preparedModel, &preparedLighting, alloc);
                if (!ok(ls)) {
                    cachedSkipGroup = true;
                    auto rrSkip = preparedGroupLookup.insertIfMissing(groupIndex, kPreparedGroupSkip);
                    if (!rrSkip.isOk()) {
                        return rrSkip.status();
                    }
                    return Status::Ok;
                }
                PreparedLocGroupModel prepared(alloc);
                prepared.groupIndex = groupIndex;
                prepared.model = rs::move(preparedModel);
                prepared.lighting = rs::move(preparedLighting);
                auto rrPushPrepared = preparedGroups.pushBack(rs::move(prepared));
                if (!rrPushPrepared.isOk()) {
                    return rrPushPrepared.status();
                }
                const i32 preparedIndex = static_cast<i32>(preparedGroups.size() - 1);
                auto rrMarkPrepared = preparedGroupLookup.insertIfMissing(groupIndex, preparedIndex);
                if (!rrMarkPrepared.isOk()) {
                    return rrMarkPrepared.status();
                }
                const PreparedLocGroupModel& finalPrepared =
                    preparedGroups[static_cast<std::size_t>(preparedIndex)];
                cachedPreparedModel = &finalPrepared.model;
                cachedPreparedLighting = &finalPrepared.lighting;
                cachedPreparedModelReady = true;
            }
            return Status::Ok;
        };

    for (std::size_t bi = 0; bi < mergeBuckets.size(); bi++) {
        LocMergeBucket& bucket = mergeBuckets[bi];
        if (bucket.entries.empty()) {
            continue;
        }

        const i32 mergedOffsetBytes = (*indexCount) * 4;
        i32 mergedElements = 0;

        for (std::size_t ei = 0; ei < bucket.entries.size(); ei++) {
            const LocMergeBucketEntry& entry = bucket.entries[ei];
            if (entry.groupIndex < 0 || entry.groupIndex >= static_cast<i32>(groups.size())) {
                return Status::OutOfRange;
            }
            LocCommandGroup& group = groups[static_cast<std::size_t>(entry.groupIndex)];
            if (cachedGroupIndex != entry.groupIndex) {
                const Status cs = refreshGroupCache(entry.groupIndex, group);
                if (!ok(cs)) {
                    return cs;
                }
            }
            if (cachedSkipGroup || !cachedResolved) {
                continue;
            }
            const DebugCommandProvenance mergeBucketProvenance = makeLocCommandProvenance(
                DebugCommandSourceKind::LocMergeBucket,
                group.locTypeId,
                group.placementType,
                group.rotation,
                group.placementType,
                group.rotation,
                bucket.transparent ? 1 : 0,
                2,
                group.debugGroupKeySignature);
            if (entry.instanceIndex < 0 ||
                entry.instanceIndex >= static_cast<i32>(group.mergedInstances.size()) ||
                entry.instanceIndex >= static_cast<i32>(group.interactInstances.size())) {
                return Status::OutOfRange;
            }

            if (entry.elementsPerInstance <= 0) {
                const i32 modelOffsetBytes = (*indexCount) * 4;
                ModelInfo interactDummy = group.interactInstances[static_cast<std::size_t>(entry.instanceIndex)];
                interactDummy.sceneX = 0;
                interactDummy.sceneZ = 0;
                interactDummy.heightOffset = 0;
                interactDummy.contourGround = static_cast<i32>(ContourGroundType::None);
                const Status zis = buffer->emitInteractCommand(
                    modelOffsetBytes,
                    0,
                    Span<const ModelInfo>(&interactDummy, 1),
                    bucket.transparent,
                    bucket.includeLod,
                    /*defer=*/false,
                    &mergeBucketProvenance);
                if (!ok(zis)) {
                    return zis;
                }
                continue;
            }
            const LocType* resolved = cachedResolved;
            const MergeNormalsEntry* mergeEntry = cachedMergeEntry;
            // ContourGroundType.AlignToSlope (type==3) is supported in applyContourToModelForPlacement now,
            // so allow mergeNormals planning to include these entries for TS parity.
            if (!mergeEntry) {
                if (!cachedPreparedModelReady && cachedModelIds.empty()) {
                    continue;
                }
            }

            if (entry.instanceIndex >= static_cast<i32>(group.sceneHeights.size()) ||
                entry.instanceIndex >= static_cast<i32>(group.contourSceneXs.size()) ||
                entry.instanceIndex >= static_cast<i32>(group.contourSceneZs.size())) {
                return Status::OutOfRange;
            }
            const ModelInfo& mergedInst = group.mergedInstances[static_cast<std::size_t>(entry.instanceIndex)];
            const i32 mergedSceneHeight = group.sceneHeights[static_cast<std::size_t>(entry.instanceIndex)];
            const i32 contourSceneX = group.contourSceneXs[static_cast<std::size_t>(entry.instanceIndex)];
            const i32 contourSceneZ = group.contourSceneZs[static_cast<std::size_t>(entry.instanceIndex)];
            // TS parity: the model build path always calls `ModelData.contourGround(...)` for contoured locs,
            // and the implementation early-returns when the sampled bounds are flat. We therefore request
            // contouring whenever the loc is contoured and let the contour helper decide if it is a no-op.
            //
            // Note: `appendLocPlacementGeometryFromDecodedModelWithLightingState` doesn't support the
            // AlignToSlope variant (type==3) yet; keep that disabled here for now.
            bool applyContour = resolved->contourGroundType > 0 && resolved->contourGroundType != 3;

            LocPlacement placement{};
            placement.id = group.locTypeId;
            placement.type = group.placementType;
            placement.rotation = group.rotation;
            placement.level = mergedInst.level;

            const i32 modelOffsetBytes = (*indexCount) * 4;
            i32 generatedElements = 0;
            Status gs = Status::Ok;
            if (mergeEntry) {
                gs = appendLocPlacementGeometryFromDecodedModelWithLightingState(
                    input,
                    scene,
                    *resolved,
                    placement,
                    mergedInst.sceneX,
                    mergedInst.sceneZ,
                    contourSceneX,
                    contourSceneZ,
                    mergedSceneHeight,
                    applyContour,
                    mergeEntry->model,
                    mergeEntry->lighting,
                    bucket.transparent,
                    debugOut,
                    &buffer->vertices,
                    &buffer->indices,
                    &generatedElements,
                    alloc);
            } else {
                if (cachedPreparedModelReady) {
                    gs = appendLocPlacementGeometryFromDecodedModelWithLightingState(
                        input,
                        scene,
                        *resolved,
                        placement,
                        mergedInst.sceneX,
                        mergedInst.sceneZ,
                        contourSceneX,
                        contourSceneZ,
                        mergedSceneHeight,
                        applyContour,
                        *cachedPreparedModel,
                        *cachedPreparedLighting,
                        bucket.transparent,
                        debugOut,
                        &buffer->vertices,
                        &buffer->indices,
                        &generatedElements,
                        alloc);
                } else {
                    gs = appendLocPlacementGeometry(
                        input,
                        scene,
                        *resolved,
                        placement,
                        mergedInst.sceneX,
                        mergedInst.sceneZ,
                        contourSceneX,
                        contourSceneZ,
                        mergedSceneHeight,
                        applyContour,
                        Span<const i32>(cachedModelIds.data(), cachedModelIds.size()),
                        bucket.transparent,
                        debugOut,
                        &buffer->vertices,
                        &buffer->indices,
                        &generatedElements,
                        alloc);
                }
            }
            if (!ok(gs)) {
                return gs;
            }
            if (generatedElements != entry.elementsPerInstance) {
                if (debugOut) {
                    const i32 delta = entry.elementsPerInstance - generatedElements;
                    debugOut->debugGeometryElementMismatchCount++;
                    debugOut->debugGeometryElementMismatchTotalDelta += (delta >= 0) ? delta : -delta;
                    if ((delta >= 0 ? delta : -delta) > debugOut->debugGeometryElementMismatchMaxDelta) {
                        debugOut->debugGeometryElementMismatchMaxDelta = (delta >= 0) ? delta : -delta;
                        debugOut->debugGeometryElementMismatchSampleTypeId = group.locTypeId;
                        debugOut->debugGeometryElementMismatchSamplePlacementType = 0;
                        debugOut->debugGeometryElementMismatchSampleRotation = 0;
                    }
                }
            }

            const i32 effectiveElements = generatedElements;
            if (debugOut && effectiveElements > 0) {
                const i32 hasFaceRenderPriorities =
                    mergeEntry ? (mergeEntry->model.hasFaceRenderPriorities ? 1 : 0) : -1;
                const i32 faceRenderPrioritiesLength =
                    mergeEntry ? static_cast<i32>(mergeEntry->model.faceRenderPriorities.size()) : -1;
                const i32 packed[13] = {
                    modelOffsetBytes >> 2,
                    effectiveElements,
                    group.locTypeId,
                    group.placementType,
                    group.rotation,
                    mergedInst.level,
                    mergedInst.priority,
                    bucket.transparent ? 1 : 0,
                    bucket.includeLod ? 1 : 0,
                    entry.groupIndex,
                    entry.instanceIndex,
                    hasFaceRenderPriorities,
                    faceRenderPrioritiesLength,
                };
                for (i32 i = 0; i < 13; i++) {
                    auto rrDbg = debugOut->debugLocMergeEmitEntriesPacked.pushBack(packed[i]);
                    if (!rrDbg.isOk()) {
                        return rrDbg.status();
                    }
                }
            }
            ModelInfo interactDummy =
                group.interactInstances[static_cast<std::size_t>(entry.instanceIndex)];
            // TS merged-geometry path bakes translation into vertices; interact commands use
            // a dummy instance position while carrying interactType/interactId.
            interactDummy.sceneX = 0;
            interactDummy.sceneZ = 0;
            interactDummy.heightOffset = 0;
            interactDummy.contourGround = static_cast<i32>(ContourGroundType::None);
            const Status is = buffer->emitInteractCommand(
                modelOffsetBytes,
                effectiveElements,
                Span<const ModelInfo>(&interactDummy, 1),
                bucket.transparent,
                bucket.includeLod,
                /*defer=*/false,
                &mergeBucketProvenance);
            if (!ok(is)) {
                return is;
            }

            *indexCount += effectiveElements;
            mergedElements += effectiveElements;
        }

        if (mergedElements > 0) {
            ModelInfo mergedDummy{};
            mergedDummy.level = bucket.level;
            mergedDummy.contourGround = static_cast<i32>(ContourGroundType::None);
            mergedDummy.priority = bucket.priority;
            mergedDummy.interactType = static_cast<i32>(InteractType::None);
            mergedDummy.interactId = 0xffff;

            if (debugOut) {
                i32 mergedDummyHash = debugOut->debugLocMergedDummyHash;
                if (mergedDummyHash == 0) {
                    mergedDummyHash = 2166136261u;
                }

                DrawBucketKey mergedDummyBuckets[2];
                i32 mergedDummyBucketCount = 0;
                if (bucket.transparent) {
                    mergedDummyBuckets[mergedDummyBucketCount++] = DrawBucketKey::Alpha;
                    if (bucket.includeLod) {
                        mergedDummyBuckets[mergedDummyBucketCount++] = DrawBucketKey::LodAlpha;
                    }
                } else {
                    mergedDummyBuckets[mergedDummyBucketCount++] = DrawBucketKey::Base;
                    if (bucket.includeLod) {
                        mergedDummyBuckets[mergedDummyBucketCount++] = DrawBucketKey::Lod;
                    }
                }

                for (i32 bucketIndex = 0; bucketIndex < mergedDummyBucketCount; bucketIndex++) {
                    const i32 mergedDummyBucket =
                        static_cast<i32>(mergedDummyBuckets[static_cast<std::size_t>(bucketIndex)]);
                    debugOut->debugLocMergedDummyCommandCount++;
                    debugOut->debugLocMergedDummyElementsTotal += mergedElements;
                    if (mergedDummyBucket == static_cast<i32>(DrawBucketKey::Base)) {
                        debugOut->debugLocMergedDummyBaseCount++;
                    } else if (mergedDummyBucket == static_cast<i32>(DrawBucketKey::Alpha)) {
                        debugOut->debugLocMergedDummyAlphaCount++;
                    } else if (mergedDummyBucket == static_cast<i32>(DrawBucketKey::Lod)) {
                        debugOut->debugLocMergedDummyLodCount++;
                    } else if (mergedDummyBucket == static_cast<i32>(DrawBucketKey::LodAlpha)) {
                        debugOut->debugLocMergedDummyLodAlphaCount++;
                    }
                    mergedDummyHash = fnv1aMixI32(mergedDummyHash, mergedDummyBucket);
                    mergedDummyHash = fnv1aMixI32(mergedDummyHash, mergedOffsetBytes >> 2);
                    mergedDummyHash = fnv1aMixI32(mergedDummyHash, mergedElements);
                    mergedDummyHash = fnv1aMixI32(mergedDummyHash, bucket.level);
                    mergedDummyHash = fnv1aMixI32(mergedDummyHash, bucket.priority);
                }
                debugOut->debugLocMergedDummyHash = mergedDummyHash;
            }

            i32 provenanceLocTypeId = -1;
            i32 provenancePlacementType = -1;
            i32 provenancePlacementRotation = -1;
            if (!bucket.entries.empty()) {
                const LocMergeBucketEntry& firstEntry = bucket.entries[0];
                if (firstEntry.groupIndex >= 0 &&
                    firstEntry.groupIndex < static_cast<i32>(groups.size())) {
                    const LocCommandGroup& provGroup =
                        groups[static_cast<std::size_t>(firstEntry.groupIndex)];
                    provenanceLocTypeId = provGroup.locTypeId;
                    provenancePlacementType = provGroup.placementType;
                    provenancePlacementRotation = provGroup.rotation;
                }
            }
            const DebugCommandProvenance mergedDummyProvenance = makeLocCommandProvenance(
                DebugCommandSourceKind::LocMergedDummy,
                provenanceLocTypeId,
                provenancePlacementType,
                provenancePlacementRotation,
                provenancePlacementType,
                provenancePlacementRotation,
                bucket.transparent ? 1 : 0,
                3);
            const Status ms = buffer->emitMergedCommand(
                mergedOffsetBytes,
                mergedElements,
                Span<const ModelInfo>(&mergedDummy, 1),
                bucket.transparent,
                bucket.includeLod,
                /*defer=*/false,
                &mergedDummyProvenance);
            if (!ok(ms)) {
                return ms;
            }
        }
    }

    return Status::Ok;
}

static Status emitLocAnimatedPlaceholders(
    Span<const LocAnimatedPlaceholder> entries,
    SceneBuffer* buffer,
    SceneLocAnimatedTickInit* outTickInit) noexcept {
    if (!buffer) {
        return Status::InvalidArgument;
    }
    for (std::size_t ai = 0; ai < entries.size(); ai++) {
        const LocAnimatedPlaceholder& animated = entries[ai];
        const Span<const ModelInfo> instSpan(&animated.instance, 1);
        const DebugCommandProvenance animatedOpaqueProvenance = makeLocCommandProvenance(
            DebugCommandSourceKind::LocAnimated,
            animated.instance.interactId,
            -1,
            -1,
            -1,
            -1,
            0,
            4);
        const DebugCommandProvenance animatedAlphaProvenance = makeLocCommandProvenance(
            DebugCommandSourceKind::LocAnimated,
            animated.instance.interactId,
            -1,
            -1,
            -1,
            -1,
            1,
            4);

        const i32 drawIndexBase = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::Base) : 0;
        Status as = buffer->emitCommandToBucket(
            DrawBucketKey::Base,
            0,
            0,
            instSpan,
            /*defer=*/false,
            &animatedOpaqueProvenance);
        if (!ok(as)) {
            return as;
        }
        if (outTickInit && ai < outTickInit->locDrawRangeIndicesBase.size()) {
            outTickInit->locDrawRangeIndicesBase[ai] = drawIndexBase;
        }
        if (animated.hasAlpha) {
            const i32 drawIndexAlpha = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::Alpha) : 0;
            as = buffer->emitCommandToBucket(
                DrawBucketKey::Alpha,
                0,
                0,
                instSpan,
                /*defer=*/false,
                &animatedAlphaProvenance);
            if (!ok(as)) {
                return as;
            }
            if (outTickInit && ai < outTickInit->locDrawRangeIndicesAlpha.size()) {
                outTickInit->locDrawRangeIndicesAlpha[ai] = drawIndexAlpha;
            }
        }

        if (animated.includeLod) {
            const i32 drawIndexLod = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::Lod) : 0;
            as = buffer->emitCommandToBucket(
                DrawBucketKey::Lod,
                0,
                0,
                instSpan,
                /*defer=*/false,
                &animatedOpaqueProvenance);
            if (!ok(as)) {
                return as;
            }
            if (outTickInit && ai < outTickInit->locDrawRangeIndicesLod.size()) {
                outTickInit->locDrawRangeIndicesLod[ai] = drawIndexLod;
            }
            if (animated.hasAlpha) {
                const i32 drawIndexLodAlpha = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::LodAlpha) : 0;
                as = buffer->emitCommandToBucket(
                    DrawBucketKey::LodAlpha,
                    0,
                    0,
                    instSpan,
                    /*defer=*/false,
                    &animatedAlphaProvenance);
                if (!ok(as)) {
                    return as;
                }
                if (outTickInit && ai < outTickInit->locDrawRangeIndicesLodAlpha.size()) {
                    outTickInit->locDrawRangeIndicesLodAlpha[ai] = drawIndexLodAlpha;
                }
            }
        }

        const i32 drawIndexInteract = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::Interact) : 0;
        as = buffer->emitCommandToBucket(
            DrawBucketKey::Interact,
            0,
            0,
            instSpan,
            /*defer=*/false,
            &animatedOpaqueProvenance);
        if (!ok(as)) {
            return as;
        }
        if (outTickInit && ai < outTickInit->locDrawRangeIndicesInteract.size()) {
            outTickInit->locDrawRangeIndicesInteract[ai] = drawIndexInteract;
        }
        if (animated.hasAlpha) {
            const i32 drawIndexInteractAlpha = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::InteractAlpha) : 0;
            as = buffer->emitCommandToBucket(
                DrawBucketKey::InteractAlpha,
                0,
                0,
                instSpan,
                /*defer=*/false,
                &animatedAlphaProvenance);
            if (!ok(as)) {
                return as;
            }
            if (outTickInit && ai < outTickInit->locDrawRangeIndicesInteractAlpha.size()) {
                outTickInit->locDrawRangeIndicesInteractAlpha[ai] = drawIndexInteractAlpha;
            }
        }

        if (animated.includeLod) {
            const i32 drawIndexInteractLod = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::InteractLod) : 0;
            as = buffer->emitCommandToBucket(
                DrawBucketKey::InteractLod,
                0,
                0,
                instSpan,
                /*defer=*/false,
                &animatedOpaqueProvenance);
            if (!ok(as)) {
                return as;
            }
            if (outTickInit && ai < outTickInit->locDrawRangeIndicesInteractLod.size()) {
                outTickInit->locDrawRangeIndicesInteractLod[ai] = drawIndexInteractLod;
            }
            if (animated.hasAlpha) {
                const i32 drawIndexInteractLodAlpha = outTickInit ? buffer->bucketCommandCount(DrawBucketKey::InteractLodAlpha) : 0;
                as = buffer->emitCommandToBucket(
                    DrawBucketKey::InteractLodAlpha,
                    0,
                    0,
                    instSpan,
                    /*defer=*/false,
                    &animatedAlphaProvenance);
                if (!ok(as)) {
                    return as;
                }
                if (outTickInit && ai < outTickInit->locDrawRangeIndicesInteractLodAlpha.size()) {
                    outTickInit->locDrawRangeIndicesInteractLodAlpha[ai] = drawIndexInteractLodAlpha;
                }
            }
        }
    }
    return Status::Ok;
}

static Status planLocCommandsFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    LocCommandPlan* outPlan,
    Allocator& alloc) noexcept {
    if (!outPlan || !locTypeCache || !varbitCache || !seqTypeCache || !modelCache) {
        return Status::InvalidArgument;
    }
    i32 sortPlacementsUs = 0;
    i32 mergeNormalsUs = 0;
    i32 placementLoopUs = 0;
    i32 renderPlanUs = 0;
    i32 animatedOrderUs = 0;
    if (debugOut) {
        debugOut->debugLocPlanSortPlacementsUs = 0;
        debugOut->debugLocPlanMergeNormalsUs = 0;
        debugOut->debugLocPlanPlacementLoopUs = 0;
        debugOut->debugLocPlanRenderPlanUs = 0;
        debugOut->debugLocPlanAnimatedOrderUs = 0;
    }
    outPlan->groups.clear();
    outPlan->mergeBuckets.clear();
    outPlan->instancedOps.clear();
    outPlan->animatedEntries.clear();
    outPlan->animatedGroups.clear();
    Vec<LocModelVariantRef> modelRefs(alloc);
    Vec<LocCommandGroup> groups(alloc);
    LocCommandGroupLookupIndex groupLookup(alloc);
    {
        auto rrReserveIndex = groupLookup.reserveForExpectedCount(scene.locPlacements.size());
        if (!rrReserveIndex.isOk()) {
            return rrReserveIndex.status();
        }
    }
    Vec<LocAnimatedPlaceholder> animatedEntries(alloc);
    Vec<LocAnimatedGroupPlan> animatedGroups(alloc);
    const i32 border = inferTerrainBorderSize(input.sizeX, input.sizeY);
    const i32 renderStart = border;
    const i32 renderEndX = border + TerrainConstants::MAP_SQUARE_SIZE;
    const i32 renderEndY = border + TerrainConstants::MAP_SQUARE_SIZE;

    if (debugOut && scene.locPlacements.size() <= static_cast<std::size_t>(2147483647)) {
        debugOut->debugLocPlacementsDecoded = static_cast<i32>(scene.locPlacements.size());
    }

    Vec<i32> locPlacementOrder(alloc);
    {
        const auto sortPlacementsStart = LocBuildClock::now();
        auto rr = locPlacementOrder.reserve(scene.locPlacements.size());
        if (!rr.isOk()) {
            return rr.status();
        }
        for (i32 i = 0; i < static_cast<i32>(scene.locPlacements.size()); i++) {
            rr = locPlacementOrder.pushBack(i);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
        // TS parity: SceneLocs walks level -> tileX -> tileY and then emits
        // floor/wall/wallDecoration/loc categories for each tile.
        sortInPlace(
            locPlacementOrder.data(),
            locPlacementOrder.size(),
            [&](const i32 aIdx, const i32 bIdx) noexcept -> bool {
                if (aIdx == bIdx) {
                    return false;
                }
                if (aIdx < 0) {
                    return true;
                }
                if (bIdx < 0) {
                    return false;
                }
                const SceneLocPlacement& a = scene.locPlacements[static_cast<std::size_t>(aIdx)];
                const SceneLocPlacement& b = scene.locPlacements[static_cast<std::size_t>(bIdx)];
                const i32 catA = locPlacementCategoryForSceneOrder(a.type);
                const i32 catB = locPlacementCategoryForSceneOrder(b.type);
                if (a.level != b.level) {
                    return a.level < b.level;
                }
                if (a.tileX != b.tileX) {
                    return a.tileX < b.tileX;
                }
                if (a.tileY != b.tileY) {
                    return a.tileY < b.tileY;
                }
                if (catA != catB) {
                    return catA < catB;
                }
                return aIdx < bIdx;
            });
        sortPlacementsUs = locElapsedUs(sortPlacementsStart);
    }
    i32 placementSerial = 0;

    const auto wallDecorOffsetForTile = [&](i32 level, i32 tileX, i32 tileY, i32* outX, i32* outZ) noexcept {
        if (!outX || !outZ) {
            return;
        }
        *outX = 0;
        *outZ = 0;
        if (!scene.isWithinBounds(level, tileX, tileY)) {
            return;
        }
        if (scene.wallDecorPresent(level, tileX, tileY) == 0) {
            return;
        }
        *outX = scene.wallDecorOffsetX(level, tileX, tileY);
        *outZ = scene.wallDecorOffsetZ(level, tileX, tileY);
    };

    // Merge-normals preprocessing (TS Scene.light): build per-placement model stats/modelHash for
    // LocType.mergeNormals placements by merging vertex normals with neighbors and hiding occluded faces.
    const auto mergeNormalsStart = LocBuildClock::now();
    outPlan->mergeNormalsEntries.clear();
    outPlan->mergeNormalsEntry0ByPlacement.clear();
    outPlan->mergeNormalsEntry1ByPlacement.clear();
    {
        auto rrMap0 = outPlan->mergeNormalsEntry0ByPlacement.resize(scene.locPlacements.size());
        if (!rrMap0.isOk()) {
            return rrMap0.status();
        }
        auto rrMap1 = outPlan->mergeNormalsEntry1ByPlacement.resize(scene.locPlacements.size());
        if (!rrMap1.isOk()) {
            return rrMap1.status();
        }
        for (std::size_t pi = 0; pi < outPlan->mergeNormalsEntry0ByPlacement.size(); pi++) {
            outPlan->mergeNormalsEntry0ByPlacement[pi] = -1;
            outPlan->mergeNormalsEntry1ByPlacement[pi] = -1;
        }

        // Helper: TS Scene.getCenterHeight. Precompute once for mergeNormals phase since
        // this value is sampled repeatedly during neighborhood walks.
        const std::size_t centerHeightCount =
            static_cast<std::size_t>(scene.levels) *
            static_cast<std::size_t>(scene.sizeX) *
            static_cast<std::size_t>(scene.sizeY);
        Vec<i32> centerHeights(alloc);
        auto rrCenter = centerHeights.resize(centerHeightCount);
        if (!rrCenter.isOk()) {
            return rrCenter.status();
        }
        for (i32 level = 0; level < scene.levels; level++) {
            for (i32 tileX = 0; tileX < scene.sizeX; tileX++) {
                for (i32 tileY = 0; tileY < scene.sizeY; tileY++) {
                    const i32 h00 = scene.height(level, tileX, tileY);
                    const i32 h01 = scene.height(level, tileX, tileY + 1);
                    const i32 h10 = scene.height(level, tileX + 1, tileY);
                    const i32 h11 = scene.height(level, tileX + 1, tileY + 1);
                    centerHeights[scene.tileIdx(level, tileX, tileY)] = (h00 + h01 + h10 + h11) >> 2;
                }
            }
        }
        const auto centerHeightForTile = [&](i32 level, i32 tileX, i32 tileY) noexcept -> i32 {
            if (level < 0 || level >= scene.levels ||
                tileX < 0 || tileY < 0 || tileX >= scene.sizeX || tileY >= scene.sizeY) {
                return 0;
            }
            return centerHeights[scene.tileIdx(level, tileX, tileY)];
        };

        const auto computeBoundsForEntry = [&](MergeNormalsEntry* e) noexcept {
            if (!e) return;
            const ModelData& m = e->model;
            const Vec<i32>* verticesY = &m.verticesY;
            if (!m.contourVerticesY.empty() &&
                m.contourVerticesY.size() == m.verticesY.size()) {
                verticesY = &m.contourVerticesY;
            }
            i32 count = m.usedVertexCount;
            const i32 vxCount = static_cast<i32>(m.verticesX.size());
            if (count <= 0 || count > vxCount) {
                count = vxCount;
            }
            if (count <= 0 ||
                m.verticesX.empty() ||
                verticesY->empty() ||
                m.verticesZ.empty()) {
                e->boundsMinX = 0;
                e->boundsMaxX = 0;
                e->boundsMinZ = 0;
                e->boundsMaxZ = 0;
                e->boundsMaxY = 0;
                return;
            }
            e->boundsMinX = m.verticesX[0];
            e->boundsMaxX = m.verticesX[0];
            e->boundsMinZ = m.verticesZ[0];
            e->boundsMaxZ = m.verticesZ[0];
            e->boundsMaxY = (*verticesY)[0];
            for (i32 vi = 1; vi < count; vi++) {
                const std::size_t i = static_cast<std::size_t>(vi);
                const i32 x = m.verticesX[i];
                const i32 y = (*verticesY)[i];
                const i32 z = m.verticesZ[i];
                if (x < e->boundsMinX) e->boundsMinX = x;
                if (x > e->boundsMaxX) e->boundsMaxX = x;
                if (z < e->boundsMinZ) e->boundsMinZ = z;
                if (z > e->boundsMaxZ) e->boundsMaxZ = z;
                if (y > e->boundsMaxY) e->boundsMaxY = y;
            }
            // TS ModelData.calculateBounds initializes `minHeight` to 0 and then tracks max vertex Y.
            // This effectively clamps to 0 when all vertices are below the origin.
            if (e->boundsMaxY < 0) {
                e->boundsMaxY = 0;
            }
        };

        // Apply TS-style ground contouring before normals/mergeNormals/light when needed.
        // This is required for LocType.mergeNormals with contourGroundType>0: TS contours the model
        // (mutating verticesY) during model build, then merges/hides faces in `Scene.light()`.
        const auto applyContourToModelForPlacement = [&](const LocType& locType,
                                                        const LocPlacement& placement,
                                                        i32 tileX,
                                                        i32 tileY,
                                                        ModelData* model) noexcept -> Status {
            if (!model) return Status::InvalidArgument;
            if (locType.contourGroundType <= 0) {
                model->contourVerticesY.clear();
                return Status::Ok;
            }
            if (model->verticesY.empty() || model->verticesX.empty() || model->verticesZ.empty()) {
                model->contourVerticesY.clear();
                return Status::Ok;
            }

            const i32 contourType = locType.contourGroundType;
            const i32 contourParam = locType.contourGroundParam;
            i32 contourX = 0;
            i32 contourZ = 0;
            computeLocContourSampleOrigin(locType, placement.rotation, tileX, tileY, &contourX, &contourZ);
            const i32 sceneHeight = computeLocSceneHeight(
                scene,
                locType,
                placement.level,
                tileX,
                tileY,
                placement.rotation);

            i32 contourVertexCount = static_cast<i32>(model->verticesY.size());
            if (contourVertexCount < 0) {
                contourVertexCount = 0;
            }
            i32 usedVertexCount = model->usedVertexCount;
            if (usedVertexCount <= 0 || usedVertexCount > contourVertexCount) {
                usedVertexCount = contourVertexCount;
            }

            i32 minY = 0;
            i32 maxY = 0;
            if (usedVertexCount > 0) {
                minY = (*model).verticesY[0];
                maxY = (*model).verticesY[0];
            }
            for (i32 vi = 1; vi < usedVertexCount; vi++) {
                const i32 vy = (*model).verticesY[static_cast<std::size_t>(vi)];
                if (vy < minY) minY = vy;
                if (vy > maxY) maxY = vy;
            }
            const i32 deltaY = maxY - minY;

            // TS parity: `ModelData.contourGround(...)` returns early when the sampled bounds are flat
            // (or out of bounds). This prevents per-placement contour variation in many cases.
            i32 minX = 999999;
            i32 maxX = -999999;
            i32 minZ = 999999;
            i32 maxZ = -999999;
            for (i32 vi = 0; vi < usedVertexCount; vi++) {
                const std::size_t i = static_cast<std::size_t>(vi);
                if (i >= model->verticesX.size() || i >= model->verticesZ.size()) {
                    break;
                }
                const i32 vx = model->verticesX[i];
                const i32 vz = model->verticesZ[i];
                if (vx < minX) minX = vx;
                if (vx > maxX) maxX = vx;
                if (vz < minZ) minZ = vz;
                if (vz > maxZ) maxZ = vz;
            }
            const i32 startWorldX = contourX + minX;
            const i32 endWorldX = contourX + maxX;
            const i32 startWorldZ = contourZ + minZ;
            const i32 endWorldZ = contourZ + maxZ;

            const auto heightMapWidth = scene.sizeX + 1;
            const auto heightMapHeight = scene.sizeY + 1;
            const i32 endXTile = (endWorldX + 128) >> 7;
            const i32 endZTile = (endWorldZ + 128) >> 7;
            if ((contourType == 1 || contourType == 2 || contourType == 3 || contourType == 4 || contourType == 5) &&
                (startWorldX < 0 ||
                 startWorldZ < 0 ||
                 endXTile >= heightMapWidth ||
                 endZTile >= heightMapHeight)) {
                model->contourVerticesY.clear();
                return Status::Ok;
            }
            if (contourType == 4 || contourType == 5) {
                const i32 above = placement.level + 1;
                if (above < 0 || above >= scene.levels) {
                    model->contourVerticesY.clear();
                    return Status::Ok;
                }
                if (startWorldX < 0 ||
                    startWorldZ < 0 ||
                    endXTile >= heightMapWidth ||
                    endZTile >= heightMapHeight) {
                    model->contourVerticesY.clear();
                    return Status::Ok;
                }
            } else {
                const i32 sx = startWorldX >> 7;
                const i32 ex = (endWorldX + 127) >> 7;
                const i32 sz = startWorldZ >> 7;
                const i32 ez = (endWorldZ + 127) >> 7;
                if (isWithinHeightBounds(scene, placement.level, sx, sz) &&
                    isWithinHeightBounds(scene, placement.level, ex, sz) &&
                    isWithinHeightBounds(scene, placement.level, sx, ez) &&
                    isWithinHeightBounds(scene, placement.level, ex, ez)) {
                    if (scene.height(placement.level, sx, sz) == sceneHeight &&
                        scene.height(placement.level, ex, sz) == sceneHeight &&
                        scene.height(placement.level, sx, ez) == sceneHeight &&
                        scene.height(placement.level, ex, ez) == sceneHeight) {
                        model->contourVerticesY.clear();
                        return Status::Ok;
                    }
                }
            }

            if (contourType == 3) {
                // TS parity: ContourGroundType.AlignToSlope rotates around X/Z to match a sampled terrain plane,
                // then translates Y to the average height. This mutates verticesY/Z/X directly and clears
                // contourVerticesY.
                const i32 paramU16 = contourParam & 0xffff;
                const i32 sizeX = (paramU16 & 0xff) * 4;
                const i32 sizeZ = ((paramU16 >> 8) & 0xff) * 4;
                const i32 halfSizeX = sizeX / 2;
                const i32 halfSizeZ = sizeZ / 2;

                auto sampleHeightMapOrZero = [&](i32 worldX, i32 worldZ) noexcept -> i32 {
                    i32 h = 0;
                    if (!sampleSceneHeightAtWorld(scene, placement.level, worldX, worldZ, &h)) {
                        return 0;
                    }
                    return h;
                };

                const i32 h00 = sampleHeightMapOrZero(contourX - halfSizeX, contourZ - halfSizeZ);
                const i32 h10 = sampleHeightMapOrZero(contourX + halfSizeX, contourZ - halfSizeZ);
                const i32 h01 = sampleHeightMapOrZero(contourX - halfSizeX, contourZ + halfSizeZ);
                const i32 h11 = sampleHeightMapOrZero(contourX + halfSizeX, contourZ + halfSizeZ);

                const i32 minTop = (h00 < h10) ? h00 : h10;
                const i32 minBottom = (h01 < h11) ? h01 : h11;
                const i32 minRight = (h10 < h11) ? h10 : h11;
                const i32 minLeft = (h00 < h01) ? h00 : h01;

                const double angleFactor = 2048.0 / (6.28318530717958647692);

                // Rotate around X (pitch) using Q16 trig table (matches TS SINE/COSINE).
                if (sizeZ != 0) {
                    const i32 pitch =
                        (static_cast<i32>(std::atan2(static_cast<double>(minTop - minBottom), static_cast<double>(sizeZ)) *
                                          angleFactor)) &
                        0x7ff;
                    if (pitch != 0) {
                        const i32 sinQ16 = animSinQ16(pitch);
                        const i32 cosQ16 = animCosQ16(pitch);
                        const i32 count = static_cast<i32>(model->verticesY.size() < model->verticesZ.size()
                                                               ? model->verticesY.size()
                                                               : model->verticesZ.size());
                        for (i32 i = 0; i < count; i++) {
                            const std::size_t ii = static_cast<std::size_t>(i);
                            const i32 y = model->verticesY[ii];
                            const i32 z = model->verticesZ[ii];
                            const i32 yNum = static_cast<i32>(static_cast<i64>(y) * cosQ16 - static_cast<i64>(z) * sinQ16);
                            const i32 zNum = static_cast<i32>(static_cast<i64>(y) * sinQ16 + static_cast<i64>(z) * cosQ16);
                            model->verticesY[ii] = yNum >> 16;
                            model->verticesZ[ii] = zNum >> 16;
                        }
                    }
                }

                // Rotate around Z (roll).
                if (sizeX != 0) {
                    const i32 roll =
                        (static_cast<i32>(std::atan2(static_cast<double>(minLeft - minRight), static_cast<double>(sizeX)) *
                                          angleFactor)) &
                        0x7ff;
                    if (roll != 0) {
                        const i32 sinQ16 = animSinQ16(roll);
                        const i32 cosQ16 = animCosQ16(roll);
                        const i32 count = static_cast<i32>(model->verticesX.size() < model->verticesY.size()
                                                               ? model->verticesX.size()
                                                               : model->verticesY.size());
                        for (i32 i = 0; i < count; i++) {
                            const std::size_t ii = static_cast<std::size_t>(i);
                            const i32 x = model->verticesX[ii];
                            const i32 y = model->verticesY[ii];
                            const i32 xNum = static_cast<i32>(static_cast<i64>(x) * cosQ16 - static_cast<i64>(y) * sinQ16);
                            const i32 yNum = static_cast<i32>(static_cast<i64>(x) * sinQ16 + static_cast<i64>(y) * cosQ16);
                            model->verticesX[ii] = xNum >> 16;
                            model->verticesY[ii] = yNum >> 16;
                        }
                    }
                }

                i32 diagSumMin = h00 + h11;
                const i32 otherDiagSum = h10 + h01;
                if (otherDiagSum < diagSumMin) {
                    diagSumMin = otherDiagSum;
                }
                const i32 yOffset = (diagSumMin >> 1) - sceneHeight;
                if (yOffset != 0) {
                    for (std::size_t i = 0; i < model->verticesY.size(); i++) {
                        model->verticesY[i] += yOffset;
                    }
                }

                model->contourVerticesY.clear();
                return Status::Ok;
            }

            // TS parity: keep base verticesY intact and store warped heights in contourVerticesY.
            model->contourVerticesY = Vec<i32>(alloc);
            auto rrContour = model->contourVerticesY.resize(model->verticesY.size());
            if (!rrContour.isOk()) {
                return rrContour.status();
            }
            for (std::size_t vi = 0; vi < model->verticesY.size(); vi++) {
                model->contourVerticesY[vi] = model->verticesY[vi];
            }

            const auto maybeRecordWorldHeightProbe = [&](i32 level, i32 worldX, i32 worldZ, i32 baseY) noexcept {
                if (!debugOut || debugOut->debugWorldHeightProbeHit != 0) {
                    return;
                }
                if (debugOut->debugWorldHeightProbeLevel < 0) {
                    return;
                }
                if (level != debugOut->debugWorldHeightProbeLevel) {
                    return;
                }
                const bool firstSampleMode =
                    debugOut->debugWorldHeightProbeWorldX == -1 &&
                    debugOut->debugWorldHeightProbeWorldZ == -1;
                if (!firstSampleMode &&
                    (worldX != debugOut->debugWorldHeightProbeWorldX ||
                     worldZ != debugOut->debugWorldHeightProbeWorldZ)) {
                    return;
                }

                const i32 tx = worldX >> 7;
                const i32 tz = worldZ >> 7;
                const i32 rx = worldX & 0x7f;
                const i32 rz = worldZ & 0x7f;
                const auto within = [&](i32 lvl, i32 x, i32 y) noexcept {
                    return lvl >= 0 &&
                           lvl < scene.levels &&
                           x >= 0 &&
                           x <= scene.sizeX &&
                           y >= 0 &&
                           y <= scene.sizeY;
                };
                const bool okSample =
                    within(level, tx, tz) &&
                    within(level, tx + 1, tz) &&
                    within(level, tx, tz + 1) &&
                    within(level, tx + 1, tz + 1);

                debugOut->debugWorldHeightProbeHit = okSample ? 1 : -1;
                debugOut->debugWorldHeightProbeLevel = level;
                debugOut->debugWorldHeightProbeWorldX = worldX;
                debugOut->debugWorldHeightProbeWorldZ = worldZ;
                debugOut->debugWorldHeightProbePacked[0] = okSample ? 1 : 0;
                debugOut->debugWorldHeightProbePacked[1] = tx;
                debugOut->debugWorldHeightProbePacked[2] = tz;
                debugOut->debugWorldHeightProbePacked[3] = rx;
                debugOut->debugWorldHeightProbePacked[4] = rz;
                if (!okSample) {
                    return;
                }
                const i32 h00 = scene.height(level, tx, tz);
                const i32 h10 = scene.height(level, tx + 1, tz);
                const i32 h01 = scene.height(level, tx, tz + 1);
                const i32 h11 = scene.height(level, tx + 1, tz + 1);
                const i32 h0Numerator = h00 * (128 - rx) + h10 * rx;
                const i32 h0 = h0Numerator >> 7;
                const i32 h1Numerator = h01 * (128 - rx) + h11 * rx;
                const i32 h1 = h1Numerator >> 7;
                const i32 hNumerator = h0 * (128 - rz) + h1 * rz;
                const i32 h = hNumerator >> 7;

                debugOut->debugWorldHeightProbePacked[5] = h00;
                debugOut->debugWorldHeightProbePacked[6] = h10;
                debugOut->debugWorldHeightProbePacked[7] = h01;
                debugOut->debugWorldHeightProbePacked[8] = h11;
                debugOut->debugWorldHeightProbePacked[9] = h0Numerator;
                debugOut->debugWorldHeightProbePacked[10] = h0;
                debugOut->debugWorldHeightProbePacked[11] = h1Numerator;
                debugOut->debugWorldHeightProbePacked[12] = h1;
                debugOut->debugWorldHeightProbePacked[13] = hNumerator;
                debugOut->debugWorldHeightProbePacked[14] = h;
                debugOut->debugWorldHeightProbePacked[15] = baseY;
            };

            const std::size_t vCount = model->verticesY.size();
            for (std::size_t vi = 0; vi < vCount; vi++) {
                const i32 baseY = model->verticesY[vi];
                const i32 worldX = contourX + model->verticesX[vi];
                const i32 worldZ = contourZ + model->verticesZ[vi];

                i32 h = 0;
                i32 hAbove = 0;
                const bool hasH = sampleSceneHeightAtWorld(scene, placement.level, worldX, worldZ, &h);
                maybeRecordWorldHeightProbe(placement.level, worldX, worldZ, baseY);
                const bool hasHAbove =
                    sampleSceneHeightAtWorld(scene, placement.level + 1, worldX, worldZ, &hAbove);

                i32 outY = baseY;
                if (contourType == 1) {
                    if (hasH) {
                        outY = baseY + h - sceneHeight;
                    }
                } else if (contourType == 2) {
                    if (contourParam != 0 && minY != 0) {
                        // TS parity: JS `baseY << 16` is a wrapping 32-bit shift; avoid UB on signed shift in C++.
                        const i32 yRatio = static_cast<i32>(static_cast<u32>(baseY) << 16) / minY;
                        if (yRatio < contourParam && hasH) {
                            outY = baseY + ((h - sceneHeight) * (contourParam - yRatio)) / contourParam;
                        }
                    }
                } else if (contourType == 4) {
                    if (hasHAbove) {
                        outY = baseY + hAbove - sceneHeight + deltaY;
                    }
                } else if (contourType == 5) {
                    if (deltaY != 0 && hasH && hasHAbove) {
                        const i32 deltaHeight = h - hAbove;
                        // TS parity: JS `baseY << 8` is a wrapping 32-bit shift; avoid UB on signed shift in C++.
                        const i32 yScale = static_cast<i32>(static_cast<u32>(baseY) << 8) / deltaY;
                        const i32 yOffset = (yScale * deltaHeight) >> 8;
                        outY = yOffset - (sceneHeight - h);
                    }
                }

                model->contourVerticesY[vi] = outY;
            }

            return Status::Ok;
        };

        const auto ensureFaceRenderTypes = [&](ModelData* m) noexcept -> Status {
            if (!m) return Status::InvalidArgument;
            if (m->hasFaceRenderTypes && m->faceRenderTypes.size() >= static_cast<std::size_t>(m->faceCount)) {
                return Status::Ok;
            }
            m->hasFaceRenderTypes = true;
            m->faceRenderTypes = Vec<i8>(alloc);
            const std::size_t fc = static_cast<std::size_t>(m->faceCount < 0 ? 0 : m->faceCount);
            auto rr = m->faceRenderTypes.resize(fc);
            if (!rr.isOk()) return rr.status();
            for (std::size_t i = 0; i < fc; i++) {
                m->faceRenderTypes[i] = 0;
            }
            return Status::Ok;
        };

        const auto ensureMergedNormalsStorage = [&](ModelFaceLightingState* ls, i32 vertexCount) noexcept -> Status {
            if (!ls) return Status::InvalidArgument;
            if (vertexCount < 0) return Status::InvalidArgument;
            const std::size_t vc = static_cast<std::size_t>(vertexCount);
            if (!ls->mergedVertexPresent.empty() && ls->mergedVertexPresent.size() == vc) {
                return Status::Ok;
            }
            ls->mergedVertexNormalX = Vec<i32>(alloc);
            ls->mergedVertexNormalY = Vec<i32>(alloc);
            ls->mergedVertexNormalZ = Vec<i32>(alloc);
            ls->mergedVertexNormalMagnitude = Vec<i32>(alloc);
            ls->mergedVertexPresent = Vec<u8>(alloc);
            auto rr = ls->mergedVertexNormalX.resize(vc);
            if (!rr.isOk()) return rr.status();
            rr = ls->mergedVertexNormalY.resize(vc);
            if (!rr.isOk()) return rr.status();
            rr = ls->mergedVertexNormalZ.resize(vc);
            if (!rr.isOk()) return rr.status();
            rr = ls->mergedVertexNormalMagnitude.resize(vc);
            if (!rr.isOk()) return rr.status();
            rr = ls->mergedVertexPresent.resize(vc);
            if (!rr.isOk()) return rr.status();
            for (std::size_t i = 0; i < vc; i++) {
                ls->mergedVertexNormalX[i] = 0;
                ls->mergedVertexNormalY[i] = 0;
                ls->mergedVertexNormalZ[i] = 0;
                ls->mergedVertexNormalMagnitude[i] = 0;
                ls->mergedVertexPresent[i] = 0;
            }
            return Status::Ok;
        };

        MergeNormalsScratch scratch(alloc);

        const auto mergeNormalsBetween = [&](MergeNormalsEntry& a,
                                             MergeNormalsEntry& b,
                                             i32 offsetX,
                                             i32 offsetY,
                                             i32 offsetZ,
                                             bool hideOccludedFaces,
                                             i32 callKind) noexcept -> Status {
            // Match TS: calculateBounds + calculateVertexNormals already applied before merge.
            const i32 vCountA = static_cast<i32>(a.model.verticesCount);
            const i32 vCountB = static_cast<i32>(b.model.verticesCount);
            const i32 sizeA = (a.model.usedVertexCount > vCountA) ? a.model.usedVertexCount : vCountA;
            const i32 sizeB = (b.model.usedVertexCount > vCountB) ? b.model.usedVertexCount : vCountB;
            const Status ss = scratch.nextStamp(sizeA, sizeB);
            if (!ok(ss)) return ss;
            const i32 stamp = scratch.stamp;

            const i32 usedA = a.model.usedVertexCount;
            const i32 usedB = b.model.usedVertexCount;
            if (usedA <= 0 || usedB <= 0) {
                return Status::Ok;
            }

            const Vec<i32>* verticesYA = &a.model.verticesY;
            if (!a.model.contourVerticesY.empty() &&
                a.model.contourVerticesY.size() == a.model.verticesY.size()) {
                verticesYA = &a.model.contourVerticesY;
            }
            const Vec<i32>* verticesYB = &b.model.verticesY;
            if (!b.model.contourVerticesY.empty() &&
                b.model.contourVerticesY.size() == b.model.verticesY.size()) {
                verticesYB = &b.model.contourVerticesY;
            }

            i32 mergedCount = 0;
            for (i32 v0 = 0; v0 < usedA; v0++) {
                const std::size_t i0 = static_cast<std::size_t>(v0);
                if (i0 >= a.model.verticesX.size() ||
                    i0 >= verticesYA->size() ||
                    i0 >= a.model.verticesZ.size() ||
                    i0 >= a.lighting.vertexNormalMagnitude.size()) {
                    break;
                }
                if (a.lighting.vertexNormalMagnitude[i0] == 0) {
                    continue;
                }
                const i32 y = (*verticesYA)[i0] - offsetY;
                if (y > b.boundsMaxY) {
                    continue;
                }
                const i32 x = a.model.verticesX[i0] - offsetX;
                if (x < b.boundsMinX || x > b.boundsMaxX) {
                    continue;
                }
                const i32 z = a.model.verticesZ[i0] - offsetZ;
                if (z < b.boundsMinZ || z > b.boundsMaxZ) {
                    continue;
                }

                for (i32 v1 = 0; v1 < usedB; v1++) {
                    const std::size_t i1 = static_cast<std::size_t>(v1);
                    if (i1 >= b.model.verticesX.size() ||
                        i1 >= verticesYB->size() ||
                        i1 >= b.model.verticesZ.size() ||
                        i1 >= b.lighting.vertexNormalMagnitude.size()) {
                        break;
                    }
                    if (b.model.verticesX[i1] != x ||
                        b.model.verticesZ[i1] != z ||
                        (*verticesYB)[i1] != y ||
                        b.lighting.vertexNormalMagnitude[i1] == 0) {
                        continue;
                    }

                    const Status em0 = ensureMergedNormalsStorage(&a.lighting, vCountA);
                    if (!ok(em0)) return em0;
                    const Status em1 = ensureMergedNormalsStorage(&b.lighting, vCountB);
                    if (!ok(em1)) return em1;

                    if (a.lighting.mergedVertexPresent[i0] == 0) {
                        a.lighting.mergedVertexPresent[i0] = 1;
                        a.lighting.mergedVertexNormalX[i0] = a.lighting.vertexNormalX[i0];
                        a.lighting.mergedVertexNormalY[i0] = a.lighting.vertexNormalY[i0];
                        a.lighting.mergedVertexNormalZ[i0] = a.lighting.vertexNormalZ[i0];
                        a.lighting.mergedVertexNormalMagnitude[i0] = a.lighting.vertexNormalMagnitude[i0];
                    }
                    if (b.lighting.mergedVertexPresent[i1] == 0) {
                        b.lighting.mergedVertexPresent[i1] = 1;
                        b.lighting.mergedVertexNormalX[i1] = b.lighting.vertexNormalX[i1];
                        b.lighting.mergedVertexNormalY[i1] = b.lighting.vertexNormalY[i1];
                        b.lighting.mergedVertexNormalZ[i1] = b.lighting.vertexNormalZ[i1];
                        b.lighting.mergedVertexNormalMagnitude[i1] = b.lighting.vertexNormalMagnitude[i1];
                    }

                    a.lighting.mergedVertexNormalX[i0] += b.lighting.vertexNormalX[i1];
                    a.lighting.mergedVertexNormalY[i0] += b.lighting.vertexNormalY[i1];
                    a.lighting.mergedVertexNormalZ[i0] += b.lighting.vertexNormalZ[i1];
                    a.lighting.mergedVertexNormalMagnitude[i0] += b.lighting.vertexNormalMagnitude[i1];

                    b.lighting.mergedVertexNormalX[i1] += a.lighting.vertexNormalX[i0];
                    b.lighting.mergedVertexNormalY[i1] += a.lighting.vertexNormalY[i0];
                    b.lighting.mergedVertexNormalZ[i1] += a.lighting.vertexNormalZ[i0];
                    b.lighting.mergedVertexNormalMagnitude[i1] += a.lighting.vertexNormalMagnitude[i0];

                    if (i0 < scratch.model0VertexStamp.size()) scratch.model0VertexStamp[i0] = stamp;
                    if (i1 < scratch.model1VertexStamp.size()) scratch.model1VertexStamp[i1] = stamp;
                    mergedCount++;
                }
            }

            if (debugOut) {
                const i32 packed[22] = {
                    a.locTypeId,
                    a.placementType,
                    a.rotation,
                    a.level,
                    a.tileX,
                    a.tileY,
                    a.sizeX,
                    a.sizeY,
                    b.locTypeId,
                    b.placementType,
                    b.rotation,
                    b.level,
                    b.tileX,
                    b.tileY,
                    b.sizeX,
                    b.sizeY,
                    offsetX,
                    offsetY,
                    offsetZ,
                    hideOccludedFaces ? 1 : 0,
                    mergedCount,
                    callKind,
                };
                for (i32 i = 0; i < 22; i++) {
                    auto rr = debugOut->debugLocMergeNormalsTraceEntriesPacked.pushBack(packed[i]);
                    if (!rr.isOk()) {
                        return rr.status();
                    }
                }
            }

            if (mergedCount >= 3 && hideOccludedFaces) {
                const Status fr0 = ensureFaceRenderTypes(&a.model);
                if (!ok(fr0)) return fr0;
                const Status fr1 = ensureFaceRenderTypes(&b.model);
                if (!ok(fr1)) return fr1;

                for (i32 fi = 0; fi < a.model.faceCount; fi++) {
                    const std::size_t f = static_cast<std::size_t>(fi);
                    if (f >= a.model.indices1.size() ||
                        f >= a.model.indices2.size() ||
                        f >= a.model.indices3.size() ||
                        f >= a.model.faceRenderTypes.size()) {
                        continue;
                    }
                    const i32 ia = a.model.indices1[f];
                    const i32 ib = a.model.indices2[f];
                    const i32 ic = a.model.indices3[f];
                    if (ia < 0 || ib < 0 || ic < 0) {
                        continue;
                    }
                    const std::size_t sia = static_cast<std::size_t>(ia);
                    const std::size_t sib = static_cast<std::size_t>(ib);
                    const std::size_t sic = static_cast<std::size_t>(ic);
                    if (sia < scratch.model0VertexStamp.size() &&
                        sib < scratch.model0VertexStamp.size() &&
                        sic < scratch.model0VertexStamp.size() &&
                        scratch.model0VertexStamp[sia] == stamp &&
                        scratch.model0VertexStamp[sib] == stamp &&
                        scratch.model0VertexStamp[sic] == stamp) {
                        a.model.faceRenderTypes[f] = static_cast<i8>(2);
                    }
                }
                for (i32 fi = 0; fi < b.model.faceCount; fi++) {
                    const std::size_t f = static_cast<std::size_t>(fi);
                    if (f >= b.model.indices1.size() ||
                        f >= b.model.indices2.size() ||
                        f >= b.model.indices3.size() ||
                        f >= b.model.faceRenderTypes.size()) {
                        continue;
                    }
                    const i32 ia = b.model.indices1[f];
                    const i32 ib = b.model.indices2[f];
                    const i32 ic = b.model.indices3[f];
                    if (ia < 0 || ib < 0 || ic < 0) {
                        continue;
                    }
                    const std::size_t sia = static_cast<std::size_t>(ia);
                    const std::size_t sib = static_cast<std::size_t>(ib);
                    const std::size_t sic = static_cast<std::size_t>(ic);
                    if (sia < scratch.model1VertexStamp.size() &&
                        sib < scratch.model1VertexStamp.size() &&
                        sic < scratch.model1VertexStamp.size() &&
                        scratch.model1VertexStamp[sia] == stamp &&
                        scratch.model1VertexStamp[sib] == stamp &&
                        scratch.model1VertexStamp[sic] == stamp) {
                        b.model.faceRenderTypes[f] = static_cast<i8>(2);
                    }
                }
            }

            return Status::Ok;
        };

        // Phase 1: decode+init lighting for mergeNormals placements.
        // TS ordering is tile-driven and depends on per-tile loc insertion order; use placement-index order
        // here so Phase 2 can reproduce TS "process+light as you go" semantics.
        for (i32 placementIndex = 0;
             placementIndex < static_cast<i32>(scene.locPlacements.size());
             placementIndex++) {
            const SceneLocPlacement& sp = scene.locPlacements[static_cast<std::size_t>(placementIndex)];

            LocPlacement p{};
            p.id = sp.originalId;
            p.type = sp.type;
            p.rotation = sp.rotation;
            p.level = sp.level;

            ResolvedLocRenderPlacement resolvedPlacement{};
            const Status rps = resolveLocRenderPlacement(
                input,
                scene,
                tileHasValidFaceColorsAForLowDetail,
                locTypeCache,
                varbitCache,
                p,
                sp.tileX,
                sp.tileY,
                &resolvedPlacement,
                alloc);
            if (!ok(rps) || !resolvedPlacement.locType) {
                continue;
            }
            const LocType* resolved = resolvedPlacement.locType;
            if (!resolved->mergeNormals || resolvedPlacement.sourceIsEntity) {
                continue;
            }

            modelRefs.clear();
            if (!collectLocTypeModelRefs(*resolved, p.type, p.rotation, &modelRefs) || modelRefs.empty()) {
                continue;
            }

            // TS expandLocPlacementModelVariants can produce up to 2 variants for a single placement.
            // Scene.light merges/hides per-entity, so we need a mergeNormals entry per variant key
            // (placementType+rotation), not a single representative.
            for (std::size_t variantBegin = 0; variantBegin < modelRefs.size();) {
                const i32 variantType = modelRefs[variantBegin].placementType;
                const i32 variantRot = modelRefs[variantBegin].rotation;
                std::size_t variantEnd = variantBegin + 1;
                while (variantEnd < modelRefs.size() &&
                       modelRefs[variantEnd].placementType == variantType &&
                       modelRefs[variantEnd].rotation == variantRot) {
                    variantEnd++;
                }

                MergeNormalsEntry entry(alloc);
                entry.placementIndex = placementIndex;
                entry.level = sp.level;
                entry.tileX = sp.tileX;
                entry.tileY = sp.tileY;
                entry.centerHeight = centerHeightForTile(sp.level, sp.tileX, sp.tileY);
                entry.locTypeId = resolved->id;
                entry.placementType = variantType;
                entry.rotation = variantRot;
                entry.modelId = modelRefs[variantBegin].modelId;

                // TS `Scene.mergeLargeLocNormals(...)` size handling: walls/floor decors are treated as 1x1.
                if ((entry.placementType >= 0 && entry.placementType <= 3) || entry.placementType == 22) {
                    entry.sizeX = 1;
                    entry.sizeY = 1;
                } else {
                    i32 sx = resolved->sizeX;
                    i32 sy = resolved->sizeY;
                    if ((p.rotation & 1) != 0) {
                        const i32 swap = sx;
                        sx = sy;
                        sy = swap;
                    }
                    entry.sizeX = sx;
                    entry.sizeY = sy;
                }

                const std::size_t variantCount = variantEnd - variantBegin;
                if (variantCount == 1) {
                    const Status ds = decodeLocModelFromBlobForPlacement(
                        input,
                        *resolved,
                        variantType,
                        variantRot,
                        entry.modelId,
                        &entry.model,
                        /*applyDiagonalNormalVariantRotation=*/true,
                        alloc);
                    if (!ok(ds)) {
                        variantBegin = variantEnd;
                        continue;
                    }
                } else {
                    Vec<ModelData> parts(alloc);
                    auto rrReserve = parts.reserve(variantCount);
                    if (!rrReserve.isOk()) {
                        return rrReserve.status();
                    }
                    bool okAll = true;
                    for (std::size_t mi = variantBegin; mi < variantEnd; mi++) {
                        ModelData part(alloc);
                        const Status ds = decodeLocModelFromBlobForPlacement(
                            input,
                            *resolved,
                            variantType,
                            variantRot,
                            modelRefs[mi].modelId,
                            &part,
                            /*applyDiagonalNormalVariantRotation=*/true,
                            alloc);
                        if (!ok(ds)) {
                            okAll = false;
                            break;
                        }
                        auto rrPush = parts.pushBack(rs::move(part));
                        if (!rrPush.isOk()) {
                            return rrPush.status();
                        }
                    }
                    if (!okAll) {
                        variantBegin = variantEnd;
                        continue;
                    }
                    const Status ms = mergeModelDataTS(
                        Span<const ModelData>(parts.data(), parts.size()),
                        static_cast<i32>(parts.size()),
                        &entry.model,
                        alloc);
                    if (!ok(ms)) {
                        variantBegin = variantEnd;
                        continue;
                    }
                }

                // TS parity: contouring uses the entity rotation, which for some placement
                // types differs from the raw placement rotation due to variant expansion.
                LocPlacement contourPlacement = p;
                contourPlacement.rotation = variantRot;
                const Status contourStatus =
                    applyContourToModelForPlacement(
                        *resolved,
                        contourPlacement,
                        sp.tileX,
                        sp.tileY,
                        &entry.model);
                if (contourStatus == Status::Unsupported) {
                    variantBegin = variantEnd;
                    continue;
                }
                if (!ok(contourStatus)) {
                    variantBegin = variantEnd;
                    continue;
                }
                const Status ls = initModelFaceLightingState(entry.model, &entry.lighting, alloc);
                if (!ok(ls)) {
                    variantBegin = variantEnd;
                    continue;
                }
                computeBoundsForEntry(&entry);

                const i32 entryIndex = static_cast<i32>(outPlan->mergeNormalsEntries.size());
                auto rrPush = outPlan->mergeNormalsEntries.pushBack(rs::move(entry));
                if (!rrPush.isOk()) {
                    return rrPush.status();
                }

                // Map (placementIndex -> up to 2 entries).
                const std::size_t pi = static_cast<std::size_t>(placementIndex);
                if (pi < outPlan->mergeNormalsEntry0ByPlacement.size() &&
                    pi < outPlan->mergeNormalsEntry1ByPlacement.size()) {
                    if (outPlan->mergeNormalsEntry0ByPlacement[pi] < 0) {
                        outPlan->mergeNormalsEntry0ByPlacement[pi] = entryIndex;
                    } else if (outPlan->mergeNormalsEntry1ByPlacement[pi] < 0) {
                        outPlan->mergeNormalsEntry1ByPlacement[pi] = entryIndex;
                    }
                }

                variantBegin = variantEnd;
            }
        }

	        // Phase 2: apply TS mergeLargeLocNormals over the mergeNormals placements.
	        if (!outPlan->mergeNormalsEntries.empty()) {
                struct TileEntryNode final {
                    i32 entryIndex = -1;
                    i32 next = -1;
                };

	            Vec<i32> tileHeadWall(alloc);
	            Vec<i32> tileHeadNonWall(alloc);
	            Vec<i32> tileHeadFloor(alloc);
                Vec<i32> tileTailWall(alloc);
                Vec<i32> tileTailNonWall(alloc);
                Vec<i32> tileTailFloor(alloc);
                Vec<TileEntryNode> wallNodes(alloc);
                Vec<TileEntryNode> nonWallNodes(alloc);
                Vec<TileEntryNode> floorNodes(alloc);
	            const std::size_t tileCount =
	                static_cast<std::size_t>(scene.levels) *
	                static_cast<std::size_t>(scene.sizeX) *
	                static_cast<std::size_t>(scene.sizeY);
	            auto rrHeadWall = tileHeadWall.resize(tileCount);
	            if (!rrHeadWall.isOk()) return rrHeadWall.status();
	            auto rrHeadNonWall = tileHeadNonWall.resize(tileCount);
	            if (!rrHeadNonWall.isOk()) return rrHeadNonWall.status();
	            auto rrHeadFloor = tileHeadFloor.resize(tileCount);
	            if (!rrHeadFloor.isOk()) {
	                return rrHeadFloor.status();
	            }
                auto rrTailWall = tileTailWall.resize(tileCount);
                if (!rrTailWall.isOk()) return rrTailWall.status();
                auto rrTailNonWall = tileTailNonWall.resize(tileCount);
                if (!rrTailNonWall.isOk()) return rrTailNonWall.status();
                auto rrTailFloor = tileTailFloor.resize(tileCount);
                if (!rrTailFloor.isOk()) return rrTailFloor.status();
	            for (std::size_t ti = 0; ti < tileCount; ti++) {
	                tileHeadWall[ti] = -1;
	                tileHeadNonWall[ti] = -1;
	                tileHeadFloor[ti] = -1;
                    tileTailWall[ti] = -1;
                    tileTailNonWall[ti] = -1;
                    tileTailFloor[ti] = -1;
	            }

                const auto appendTileNode =
	                    [&](Vec<i32>* tileHeads,
                        Vec<i32>* tileTails,
	                        Vec<TileEntryNode>* nodes,
	                        std::size_t tileIdx,
	                        i32 entryIndex) noexcept -> Status {
	                    if (!tileHeads || !tileTails || !nodes) {
	                        return Status::InvalidArgument;
	                    }
	                    if (tileIdx >= tileHeads->size() || tileIdx >= tileTails->size()) {
	                        return Status::OutOfRange;
	                    }
	                    TileEntryNode node{};
	                    node.entryIndex = entryIndex;
	                    node.next = -1;
	                    auto rr = nodes->pushBack(node);
	                    if (!rr.isOk()) {
	                        return rr.status();
	                    }
	                    const i32 nodeIndex = static_cast<i32>(nodes->size() - 1);
                        const i32 tail = (*tileTails)[tileIdx];
                        if (tail < 0) {
                            (*tileHeads)[tileIdx] = nodeIndex;
                            (*tileTails)[tileIdx] = nodeIndex;
                        } else {
                            if (tail >= static_cast<i32>(nodes->size())) {
                                return Status::OutOfRange;
                            }
                            (*nodes)[static_cast<std::size_t>(tail)].next = nodeIndex;
                            (*tileTails)[tileIdx] = nodeIndex;
                        }
	                    return Status::Ok;
	                };

	            for (i32 ei = 0; ei < static_cast<i32>(outPlan->mergeNormalsEntries.size()); ei++) {
	                const MergeNormalsEntry& e = outPlan->mergeNormalsEntries[static_cast<std::size_t>(ei)];
	                if (!scene.isWithinBounds(e.level, e.tileX, e.tileY)) {
	                    continue;
	                }
	                if (e.placementType == 22) {
                        const std::size_t idx = scene.tileIdx(e.level, e.tileX, e.tileY);
                        const Status as = appendTileNode(
                            &tileHeadFloor,
                            &tileTailFloor,
                            &floorNodes,
                            idx,
                            ei);
                        if (!ok(as)) return as;
	                } else if (e.placementType >= 0 && e.placementType <= 3) {
                        const std::size_t idx = scene.tileIdx(e.level, e.tileX, e.tileY);
                        const Status as = appendTileNode(
                            &tileHeadWall,
                            &tileTailWall,
                            &wallNodes,
                            idx,
                            ei);
                        if (!ok(as)) return as;
	                } else {
                        // TS Scene stores large locs on every covered tile; mirror that for mergeNormals walk order.
                        const i32 endTileX = e.tileX + (e.sizeX > 0 ? e.sizeX : 1) - 1;
                        const i32 endTileY = e.tileY + (e.sizeY > 0 ? e.sizeY : 1) - 1;
                        for (i32 tx = e.tileX; tx <= endTileX; tx++) {
                            for (i32 ty = e.tileY; ty <= endTileY; ty++) {
                                if (!scene.isWithinBounds(e.level, tx, ty)) {
                                    continue;
                                }
                                const std::size_t idx = scene.tileIdx(e.level, tx, ty);
                                const Status as = appendTileNode(
                                    &tileHeadNonWall,
                                    &tileTailNonWall,
                                    &nonWallNodes,
                                    idx,
                                    ei);
                                if (!ok(as)) return as;
                            }
                        }
	                }
	            }

	            // TS parity: entities are "lit" (stop participating in mergeNormals) as we walk tiles.
	            // This makes mergeNormals directional and order-dependent.
	            Vec<u8> active(alloc);
	            auto rrActive = active.resize(outPlan->mergeNormalsEntries.size());
	            if (!rrActive.isOk()) return rrActive.status();
	            for (std::size_t i = 0; i < active.size(); i++) active[i] = 1;

	            const auto mergeLargeLocNormalsTsOrdered =
	                [&](i32 ai) noexcept -> Status {
	                if (ai < 0 || ai >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                    return Status::OutOfRange;
	                }
	                if (active[static_cast<std::size_t>(ai)] == 0) {
	                    return Status::Ok;
	                }
	                MergeNormalsEntry& a = outPlan->mergeNormalsEntries[static_cast<std::size_t>(ai)];
	                if (a.placementType == 22) {
	                    return Status::Ok;
	                }
	                bool hideOccluded = true;
	                i32 startX = a.tileX;
	                const i32 endX = a.tileX + a.sizeX;
	                const i32 startY = a.tileY - 1;
	                const i32 endY = a.tileY + a.sizeY;

	                for (i32 level = a.level; level <= a.level + 1; level++) {
	                    if (level == scene.levels) {
	                        continue;
	                    }
	                    for (i32 localX = startX; localX <= endX; localX++) {
	                        if (localX >= 0 && localX < scene.sizeX) {
	                            for (i32 localY = startY; localY <= endY; localY++) {
	                                if (localY < 0 || localY >= scene.sizeY) {
	                                    continue;
	                                }
	                                if (!hideOccluded ||
	                                    localX >= endX ||
	                                    localY >= endY ||
	                                    (localY < a.tileY && a.tileX != localX)) {
	                                    const i32 deltaHeight =
	                                        centerHeightForTile(level, localX, localY) - a.centerHeight;
	                                    const std::size_t tileIndex = scene.tileIdx(level, localX, localY);
	                                    const auto mergeWithList =
	                                        [&](i32 head, const Vec<TileEntryNode>& nodes) noexcept -> Status {
	                                        for (i32 ni = head; ni != -1;) {
                                                if (ni < 0 || ni >= static_cast<i32>(nodes.size())) {
                                                    break;
                                                }
                                                const TileEntryNode& node =
                                                    nodes[static_cast<std::size_t>(ni)];
                                                const i32 bi = node.entryIndex;
                                                ni = node.next;
                                            if (bi == ai) {
                                                continue;
                                            }
	                                            if (bi < 0 ||
	                                                bi >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                                                continue;
	                                            }
	                                            // TS parity: only merge with entities that are still "active" (ModelData).
	                                            // In TS, once a neighbor entity is lit it stops participating in mergeNormals,
	                                            // so calls are directional and order-dependent.
	                                            if (bi >= 0 && bi < static_cast<i32>(active.size()) &&
	                                                active[static_cast<std::size_t>(bi)] == 0) {
	                                                continue;
	                                            }
	                                            MergeNormalsEntry& b =
	                                                outPlan->mergeNormalsEntries[static_cast<std::size_t>(bi)];
                                            const i32 offX =
                                                (b.sizeX - a.sizeX) * 64 + (b.tileX - a.tileX) * 128;
                                            const i32 offZ =
	                                                (b.tileY - a.tileY) * 128 + (b.sizeY - a.sizeY) * 64;
	                                            const Status ms = mergeNormalsBetween(
	                                                a,
	                                                b,
	                                                offX,
	                                                deltaHeight,
	                                                offZ,
	                                                hideOccluded,
	                                                1);
	                                            if (!ok(ms)) return ms;
	                                        }
	                                        return Status::Ok;
	                                    };

	                                    Status ms = mergeWithList(tileHeadWall[tileIndex], wallNodes);
	                                    if (!ok(ms)) return ms;
	                                    ms = mergeWithList(tileHeadNonWall[tileIndex], nonWallNodes);
	                                    if (!ok(ms)) return ms;
	                                }
	                            }
	                        }
	                    }
	                    startX--;
	                    hideOccluded = false;
	                }
	                return Status::Ok;
	            };

	            // Walk tiles in TS order: walls (defer "lighting" until both sides processed) then locs.
	            Vec<i32> wallsInTile(alloc);
	            for (i32 level = 0; level < scene.levels; level++) {
	                for (i32 tileX = 0; tileX < scene.sizeX; tileX++) {
	                    for (i32 tileY = 0; tileY < scene.sizeY; tileY++) {
	                        const std::size_t idx = scene.tileIdx(level, tileX, tileY);

	                        // Walls: mergeLargeLocNormals for each wall entity while all are still active.
	                        wallsInTile.clear();
	                        for (i32 nwi = tileHeadWall[idx]; nwi != -1;) {
                                if (nwi < 0 || nwi >= static_cast<i32>(wallNodes.size())) {
                                    break;
                                }
                                const TileEntryNode& wallNode =
                                    wallNodes[static_cast<std::size_t>(nwi)];
                                const i32 wi = wallNode.entryIndex;
                                nwi = wallNode.next;
	                            if (wi < 0 ||
	                                wi >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                                continue;
	                            }
	                            if (active[static_cast<std::size_t>(wi)] == 0) {
	                                continue;
	                            }
	                            const Status ms = mergeLargeLocNormalsTsOrdered(wi);
	                            if (!ok(ms)) return ms;
	                            auto rrPush = wallsInTile.pushBack(wi);
	                            if (!rrPush.isOk()) return rrPush.status();
	                        }
	                        // TS `model0.mergeNormals(model1, 0,0,0, false)` for the two wall sides.
	                        if (wallsInTile.size() >= 2) {
	                            for (std::size_t i = 0; i < wallsInTile.size(); i++) {
	                                for (std::size_t j = i + 1; j < wallsInTile.size(); j++) {
	                                    MergeNormalsEntry& a =
	                                        outPlan->mergeNormalsEntries[static_cast<std::size_t>(wallsInTile[i])];
	                                    MergeNormalsEntry& b =
	                                        outPlan->mergeNormalsEntries[static_cast<std::size_t>(wallsInTile[j])];
	                                    const Status ms = mergeNormalsBetween(a, b, 0, 0, 0, false, 2);
	                                    if (!ok(ms)) return ms;
	                                }
	                            }
	                        }
	                        // "Light" walls: mark inactive so later locs don't merge back with them.
	                        for (std::size_t i = 0; i < wallsInTile.size(); i++) {
	                            const i32 wi = wallsInTile[i];
	                            if (wi >= 0 && wi < static_cast<i32>(active.size())) {
	                                active[static_cast<std::size_t>(wi)] = 0;
	                            }
	                        }

	                        // Locs/decors: process sequentially, marking each inactive immediately (TS lights per-loc).
	                        for (i32 nli = tileHeadNonWall[idx]; nli != -1;) {
                                if (nli < 0 || nli >= static_cast<i32>(nonWallNodes.size())) {
                                    break;
                                }
                                const TileEntryNode& nonWallNode =
                                    nonWallNodes[static_cast<std::size_t>(nli)];
                                const i32 li = nonWallNode.entryIndex;
                                nli = nonWallNode.next;
	                            if (li < 0 ||
	                                li >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                                continue;
	                            }
	                            if (active[static_cast<std::size_t>(li)] == 0) {
	                                continue;
	                            }
		                            const Status ms = mergeLargeLocNormalsTsOrdered(li);
		                            if (!ok(ms)) return ms;
		                            active[static_cast<std::size_t>(li)] = 0;
		                        }

		                        // Floor decorations: TS merges+lights these as part of the same tile walk.
		                        for (i32 nfi = tileHeadFloor[idx]; nfi != -1;) {
		                            if (nfi < 0 || nfi >= static_cast<i32>(floorNodes.size())) {
		                                break;
		                            }
		                            const TileEntryNode& floorNode =
		                                floorNodes[static_cast<std::size_t>(nfi)];
		                            const i32 fi = floorNode.entryIndex;
		                            nfi = floorNode.next;
		                            if (fi < 0 ||
		                                fi >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
		                                continue;
		                            }
		                            if (active[static_cast<std::size_t>(fi)] == 0) {
		                                continue;
		                            }
		                            MergeNormalsEntry& a =
		                                outPlan->mergeNormalsEntries[static_cast<std::size_t>(fi)];
		                            if (a.placementType != 22) {
		                                continue;
		                            }

		                            const i32 endX = a.tileX + 1;
		                            const i32 startY = a.tileY - 1;
		                            const i32 endY = a.tileY + 1;
		                            for (i32 x = a.tileX; x <= endX; x++) {
		                                if (x < 0 || x >= scene.sizeX) {
		                                    continue;
		                                }
		                                for (i32 y = startY; y <= endY; y++) {
		                                    if (y < 0 || y >= scene.sizeY) {
		                                        continue;
		                                    }
		                                    if (x < endX && y < endY) {
		                                        continue;
		                                    }

		                                    const i32 deltaHeight =
		                                        centerHeightForTile(a.level, x, y) - a.centerHeight;
		                                    const i32 offX = (x - a.tileX) * 128;
		                                    const i32 offZ = (y - a.tileY) * 128;
		                                    const std::size_t tileIndex = scene.tileIdx(a.level, x, y);
		                                    for (i32 nbi = tileHeadFloor[tileIndex]; nbi != -1;) {
		                                        if (nbi < 0 || nbi >= static_cast<i32>(floorNodes.size())) {
		                                            break;
		                                        }
		                                        const TileEntryNode& floorNodeB =
		                                            floorNodes[static_cast<std::size_t>(nbi)];
		                                        const i32 bi = floorNodeB.entryIndex;
		                                        nbi = floorNodeB.next;
		                                        if (bi == fi) {
		                                            continue;
		                                        }
		                                        if (bi < 0 ||
		                                            bi >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
		                                            continue;
		                                        }
		                                        if (active[static_cast<std::size_t>(bi)] == 0) {
		                                            continue;
		                                        }
		                                        MergeNormalsEntry& b =
		                                            outPlan->mergeNormalsEntries[static_cast<std::size_t>(bi)];
		                                        const Status ms = mergeNormalsBetween(
		                                            a,
		                                            b,
		                                            offX,
		                                            deltaHeight,
		                                            offZ,
		                                            true,
		                                            3);
		                                        if (!ok(ms)) {
		                                            return ms;
		                                        }
		                                    }
		                                }
		                            }

		                            // "Light" floor decoration: mark inactive so later tiles don't merge back with it.
		                            active[static_cast<std::size_t>(fi)] = 0;
		                        }
		                    }
		                }
		            }
	            // Phase 3: compute per-entry stats+hash after merging/hiding.
	            for (std::size_t ei = 0; ei < outPlan->mergeNormalsEntries.size(); ei++) {
	                MergeNormalsEntry& e = outPlan->mergeNormalsEntries[ei];
                if (e.locTypeId < 0) {
                    continue;
                }
                const LocType* resolved = nullptr;
                const Status ts = tryDecodeLocTypeFromBlob(
                    input,
                    locTypeCache,
                    e.locTypeId,
                    &resolved,
                    alloc);
                if (!ok(ts) || !resolved) {
                    continue;
                }
                ModelFaceStats stats{};
                stats.hasBounds = true;
                stats.minX = e.boundsMinX;
                stats.maxX = e.boundsMaxX;
                stats.minZ = e.boundsMinZ;
                stats.maxZ = e.boundsMaxZ;

	                for (i32 fi = 0; fi < e.model.faceCount; fi++) {
	                    i32 faceType = 0;
	                    if (e.model.hasFaceRenderTypes &&
	                        fi >= 0 &&
	                        fi < static_cast<i32>(e.model.faceRenderTypes.size())) {
	                        faceType = static_cast<i32>(e.model.faceRenderTypes[static_cast<std::size_t>(fi)]);
	                    }
	                    // TS parity: ModelData.light() treats faceAlphas -2/-1 as renderType overrides.
	                    const i32 rawAlphaSigned =
	                        (e.model.hasFaceAlphas && fi >= 0 && fi < static_cast<i32>(e.model.faceAlphas.size()))
	                            ? static_cast<i32>(e.model.faceAlphas[static_cast<std::size_t>(fi)])
	                            : 0;
	                    if (rawAlphaSigned == -2) {
	                        faceType = 3;
	                    } else if (rawAlphaSigned == -1) {
	                        faceType = 2;
	                    }

	                    const i32 textureId =
	                        (e.model.hasFaceTextures && fi >= 0 && fi < static_cast<i32>(e.model.faceTextures.size()))
	                            ? static_cast<i32>(e.model.faceTextures[static_cast<std::size_t>(fi)])
	                            : -1;
                    // TS parity: ModelData.light() filters faceTextures to SD-only (otherwise texture=-1).
                    const bool hasTexture =
                        textureId != -1 &&
                        findTypeBlobIndex(input.textureIds, textureId) >= 0;

                    i32 alpha = 0xff;
                    if (!hasTexture &&
                        e.model.hasFaceAlphas &&
                        fi >= 0 &&
                        fi < static_cast<i32>(e.model.faceAlphas.size())) {
                        alpha = 0xff - (static_cast<i32>(e.model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
                    }
                    if (alpha == 0 || alpha == 1) {
                        continue;
                    }

                    if (!hasTexture) {
                        if (faceType != 0 && faceType != 1 && faceType != 3) {
                            continue;
                        }
                    } else {
                        if (faceType != 0 && faceType != 1) {
                            continue;
                        }
                    }

                    const bool textureAlpha =
                        hasTexture &&
                        findTypeBlobIndex(input.textureTransparentIds, textureId) >= 0;
                    if (alpha < 0xff || textureAlpha) {
                        stats.alphaElements += 3;
                    } else {
                        stats.opaqueElements += 3;
                    }
                }

                const i32 ambient = resolved->ambient + 64;
                const i32 contrast = resolved->contrast + 768;
                i32 hash = 0;
                const Status hs = computeLitModelHashForGroupingWithLightingState(
                    input,
                    e.model,
                    e.lighting,
                    ambient,
                    contrast,
                    e.placementType,
                    e.rotation,
                    resolved,
                    nullptr,
                    &hash,
                    alloc);
                if (ok(hs)) {
                    stats.modelHash = hash;
                }
                e.stats = stats;
            }
        }
    }

    mergeNormalsUs = locElapsedUs(mergeNormalsStart);

    const auto placementLoopStart = LocBuildClock::now();
    for (std::size_t i = 0; i < locPlacementOrder.size(); i++) {
        const i32 placementIndex = locPlacementOrder[i];
        if (placementIndex < 0 || placementIndex >= static_cast<i32>(scene.locPlacements.size())) {
            continue;
        }
        const SceneLocPlacement& sp = scene.locPlacements[static_cast<std::size_t>(placementIndex)];

        LocPlacement p{};
        p.id = sp.originalId;
        p.type = sp.type;
        p.rotation = sp.rotation;
        p.level = sp.level;

        const i32 sceneX = sp.tileX;
        const i32 sceneY = sp.tileY;
        if (sceneX < renderStart ||
            sceneY < renderStart ||
            sceneX >= renderEndX ||
            sceneY >= renderEndY) {
            continue;
        }
                // TS parity: this is the encounter order produced by the tile-scan ordering above.
                // We use it later to reproduce TS animated-loc grouping/placeholder emission ordering
                // (group-major, but with per-loc encounter ordering).
                const i32 placementOrder = placementSerial++;
                if (debugOut) {
                    debugOut->debugLocPlacementsInBounds++;
                }

                ResolvedLocRenderPlacement resolvedPlacement{};
                const Status rps = resolveLocRenderPlacement(
                    input,
                    scene,
                    tileHasValidFaceColorsAForLowDetail,
                    locTypeCache,
                    varbitCache,
                    p,
                    sceneX,
                    sceneY,
                    &resolvedPlacement,
                    alloc);
                if (rps == Status::NotFound) {
                    if (debugOut) {
                        debugOut->debugLocResolveNotFound++;
                    }
                    continue;
                }
                if (!ok(rps)) {
                    return rps;
                }
                if (debugOut) {
                    debugOut->debugLocPlacementsResolved++;
                }

                const LocType* resolved = resolvedPlacement.locType;
                // If this placement is a mergeNormals candidate, Phase 1-3 precomputed a decoded
                // model + lighting + face-hide stats. Use those stats (and later geometry) to
                // match TS `Scene.light()` ordering: normals -> mergeNormals/hide -> light/hash.
                i32 mergeNormalsEntryIndex0 = -1;
                i32 mergeNormalsEntryIndex1 = -1;
                if (resolved &&
                    resolved->mergeNormals &&
                    !resolvedPlacement.sourceIsEntity &&
                    placementIndex >= 0 &&
                    placementIndex < static_cast<i32>(outPlan->mergeNormalsEntry0ByPlacement.size()) &&
                    placementIndex < static_cast<i32>(outPlan->mergeNormalsEntry1ByPlacement.size())) {
                    mergeNormalsEntryIndex0 =
                        outPlan->mergeNormalsEntry0ByPlacement[static_cast<std::size_t>(placementIndex)];
                    mergeNormalsEntryIndex1 =
                        outPlan->mergeNormalsEntry1ByPlacement[static_cast<std::size_t>(placementIndex)];
                }
                if (debugOut && resolved) {
                    // TS loc placement stage digest uses resolved loc type id for interactId.
                    // Keep debug stage fields aligned without changing runtime interact semantics.
                    const i32 stageInteractId = resolved->id;
                    u32 h = static_cast<u32>(debugOut->debugLocRenderPlacementDigestHash);
                    h = fnv1a32UpdateI32ForDebug(h, p.id);
                    h = fnv1a32UpdateI32ForDebug(h, resolved->id);
                    h = fnv1a32UpdateI32ForDebug(h, p.type);
                    h = fnv1a32UpdateI32ForDebug(h, p.rotation);
                    h = fnv1a32UpdateI32ForDebug(h, p.level);
                    h = fnv1a32UpdateI32ForDebug(h, sceneX);
                    h = fnv1a32UpdateI32ForDebug(h, sceneY);
                    h = fnv1a32UpdateI32ForDebug(h, resolvedPlacement.seqId);
                    h = fnv1a32UpdateI32ForDebug(h, resolvedPlacement.priority);
                    h = fnv1a32UpdateI32ForDebug(h, stageInteractId);
                    h = fnv1a32UpdateI32ForDebug(h, resolvedPlacement.includeLod ? 1 : 0);
                    h = fnv1a32UpdateI32ForDebug(h, resolvedPlacement.forceMerge ? 1 : 0);
                    h = fnv1a32UpdateI32ForDebug(h, resolvedPlacement.sourceIsEntity ? 1 : 0);
                    debugOut->debugLocRenderPlacementDigestHash = static_cast<i32>(h);
                    debugOut->debugLocRenderPlacementCount++;

                    // Debug parity: keep the packed per-placement record so TS can diff exact fields.
                    // Stride=13 ints:
                    // [id,resolvedId,type,rotation,level,sceneX,sceneY,seqId,priority,interactId,includeLod,forceMerge,sourceIsEntity]
                    auto rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(p.id);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(resolved->id);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(p.type);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(p.rotation);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(p.level);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(sceneX);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(sceneY);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(resolvedPlacement.seqId);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(resolvedPlacement.priority);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(stageInteractId);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(resolvedPlacement.includeLod ? 1 : 0);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(resolvedPlacement.forceMerge ? 1 : 0);
                    if (!rrDbg.isOk()) return rrDbg.status();
                    rrDbg = debugOut->debugLocRenderPlacementEntriesPacked.pushBack(resolvedPlacement.sourceIsEntity ? 1 : 0);
                    if (!rrDbg.isOk()) return rrDbg.status();
                }
                const bool isAnimatedEntity = resolvedPlacement.seqId != -1;
                const i32 priority = resolvedPlacement.priority;
                const bool includeLod = resolvedPlacement.includeLod;
                const bool hasModelsForPlacement =
                    collectLocTypeModelRefs(*resolved, p.type, p.rotation, &modelRefs);

                if (input.locLoadType == 0 && isAnimatedEntity) {
                    bool hasAlpha = false;
                    bool hasAnyFaces = !hasModelsForPlacement;
                    // Match TS `addLocAnimationFrames`: if the seq can't be loaded or has zero frames,
                    // the animated group is skipped entirely (no placeholders, no static fallback).
                    const SeqType* seq = nullptr;
                    const Status sqs = tryDecodeSeqTypeFromBlob(
                        input,
                        seqTypeCache,
                        resolvedPlacement.seqId,
                        &seq,
                        alloc);
                    i32 frameCount = 0;
                    if (ok(sqs) && seq) {
                        if (seq->animMayaId >= 0) {
                            frameCount = seq->animMayaEnd - seq->animMayaStart;
                        } else {
                            frameCount = static_cast<i32>(seq->frameIds.size());
                        }
                        if (frameCount <= 0) {
                            continue;
                        }
                    }

                    bool seqHintHasAlpha = false;
                    const bool hasSeqHint =
                        tryGetSeqAlphaHintFromBlob(input, resolvedPlacement.seqId, &seqHintHasAlpha);
                    if (hasSeqHint) {
                        if (seqHintHasAlpha) {
                            hasAlpha = true;
                        }
                    } else if (seq && seq->animMayaId >= 0) {
                        hasAlpha = true;
                    } else {
                        // Fallback when seq alpha hints are not available in the runtime cache:
                        // derive "has alpha transform" directly from uploaded classic seq-frame blobs.
                        if (seq) {
                            for (std::size_t fi = 0; fi < seq->frameIds.size(); fi++) {
                            const i32 frameId = seq->frameIds[fi];
                            SeqBase frameBase(-1, alloc);
                            SeqFrame frame(alloc);
                            const Status fs = tryDecodeBridgeSeqFrameFromBlob(
                                input,
                                frameId,
                                &frameBase,
                                &frame,
                                alloc);
                            if (!ok(fs)) {
                                continue;
                            }
                            if (frame.hasAlphaTransform) {
                                hasAlpha = true;
                                break;
                            }
                            }
                        }
                    }
                    if (hasModelsForPlacement) {
                        std::size_t variantBegin = 0;
                        while (variantBegin < modelRefs.size()) {
                            const i32 variantType = modelRefs[variantBegin].placementType;
	                            const i32 variantRotation = modelRefs[variantBegin].rotation;
	                            std::size_t variantEnd = variantBegin + 1;
	                            while (variantEnd < modelRefs.size() &&
	                                   modelRefs[variantEnd].placementType == variantType &&
	                                   modelRefs[variantEnd].rotation == variantRotation) {
	                                variantEnd++;
	                            }

		                            i32 variantOpaque = 0;
		                            i32 variantAlpha = 0;
		                            bool variantFailed = false;
	                            const MergeNormalsEntry* mergeNormalsEntryForVariant = nullptr;
	                            const auto tryMatchMergeNormalsStats =
	                                [&](i32 candidateIndex) noexcept -> void {
	                                if (mergeNormalsEntryForVariant) {
	                                    return;
	                                }
	                                if (candidateIndex < 0 ||
	                                    candidateIndex >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                                    return;
	                                }
	                                const MergeNormalsEntry& candidate =
	                                    outPlan->mergeNormalsEntries[static_cast<std::size_t>(candidateIndex)];
	                                if (candidate.locTypeId == resolved->id &&
	                                    candidate.placementIndex == placementIndex &&
	                                    candidate.stats.modelHash != 0 &&
	                                    candidate.placementType == variantType &&
	                                    candidate.rotation == variantRotation) {
	                                    mergeNormalsEntryForVariant = &candidate;
	                                }
	                            };
	                            tryMatchMergeNormalsStats(mergeNormalsEntryIndex0);
	                            tryMatchMergeNormalsStats(mergeNormalsEntryIndex1);
		                            bool variantHasBounds = false;
		                            i32 variantBoundsMinX = 0;
		                            i32 variantBoundsMaxX = 0;
		                            i32 variantBoundsMinZ = 0;
		                            i32 variantBoundsMaxZ = 0;
		                            if (mergeNormalsEntryForVariant) {
		                                // TS mergeNormals: faces are hidden on the *final merged model* (after
		                                // mergeNormalsBetween), so per-model stats are invalid. Use the precomputed
		                                // merged stats once for the whole variant.
		                                const ModelFaceStats& stats = mergeNormalsEntryForVariant->stats;
		                                variantOpaque = stats.opaqueElements;
		                                variantAlpha = stats.alphaElements;
		                                if (stats.hasBounds) {
		                                    variantHasBounds = true;
		                                    variantBoundsMinX = stats.minX;
		                                    variantBoundsMaxX = stats.maxX;
		                                    variantBoundsMinZ = stats.minZ;
		                                    variantBoundsMaxZ = stats.maxZ;
		                                }
		                            } else {
	                                for (std::size_t mi = variantBegin; mi < variantEnd; mi++) {
	                                    const LocModelVariantRef& modelRef = modelRefs[mi];
	                                    if (debugOut) {
	                                        debugOut->debugLocModelCandidates++;
	                                    }
	                                    const ModelFaceStats* stats = nullptr;
	                                    const Status ms = tryDecodeModelFaceStatsFromBlob(
	                                        input,
	                                        modelCache,
	                                        *resolved,
	                                        modelRef.placementType,
	                                        modelRef.rotation,
	                                        modelRef.modelId,
	                                        &stats,
	                                        alloc);
	                                    if (!ok(ms) || !stats) {
	                                        variantFailed = true;
	                                        if (debugOut) {
	                                            debugOut->debugLocModelStatsDecodeFailed++;
	                                            if (ms == Status::NotFound) {
	                                                debugOut->debugLocModelStatsNotFound++;
	                                                if (debugOut->debugLocMissingModelSampleCount == 0) {
	                                                    debugOut->debugLocMissingModelSample0 = modelRef.modelId;
	                                                    debugOut->debugLocMissingModelLocTypeId = resolved->id;
	                                                    debugOut->debugLocMissingModelPlacementType = modelRef.placementType;
	                                                    debugOut->debugLocMissingModelRotation = modelRef.rotation;
	                                                } else if (debugOut->debugLocMissingModelSampleCount == 1) {
	                                                    debugOut->debugLocMissingModelSample1 = modelRef.modelId;
	                                                } else if (debugOut->debugLocMissingModelSampleCount == 2) {
	                                                    debugOut->debugLocMissingModelSample2 = modelRef.modelId;
	                                                } else if (debugOut->debugLocMissingModelSampleCount == 3) {
	                                                    debugOut->debugLocMissingModelSample3 = modelRef.modelId;
	                                                }
	                                                debugOut->debugLocMissingModelSampleCount++;
	                                            } else {
	                                                debugOut->debugLocModelStatsOtherError++;
	                                            }
	                                        }
	                                        break;
	                                    }
	                                    if (stats->hasBounds) {
	                                        if (!variantHasBounds) {
	                                            variantHasBounds = true;
	                                            variantBoundsMinX = stats->minX;
	                                            variantBoundsMaxX = stats->maxX;
	                                            variantBoundsMinZ = stats->minZ;
	                                            variantBoundsMaxZ = stats->maxZ;
	                                        } else {
	                                            if (stats->minX < variantBoundsMinX) variantBoundsMinX = stats->minX;
	                                            if (stats->maxX > variantBoundsMaxX) variantBoundsMaxX = stats->maxX;
	                                            if (stats->minZ < variantBoundsMinZ) variantBoundsMinZ = stats->minZ;
	                                            if (stats->maxZ > variantBoundsMaxZ) variantBoundsMaxZ = stats->maxZ;
	                                        }
	                                    }
	                                    variantOpaque += stats->opaqueElements;
	                                    variantAlpha += stats->alphaElements;
	                                }
	                            }

	                            if (!variantFailed) {
	                                if (variantOpaque > 0 || variantAlpha > 0) {
	                                    hasAnyFaces = true;
	                                    if (variantAlpha > 0) {
                                        hasAlpha = true;
                                    }
                                } else if (debugOut) {
                                    debugOut->debugLocModelStatsZeroFaces++;
                                }
                            }

                            variantBegin = variantEnd;
                        }
                    }
                    // Animated loc placeholders are grouped and keyed by the *entity* type/rotation in TS
                    // (see `createLocAnimatedGroupKey(resolved.rotation, resolved.type, locTypeId)`).
                    // For some placement types (e.g. normal diagonal=11, wall decorations 5-8, wall corner=2),
                    // TS creates LocEntity instances using the expanded variant type/rotation. Mirror that here.
                    SceneLocPlacementModelVariant variants[2]{};
                    const i32 variantCount =
                        expandSceneLocPlacementModelVariants(p.type, p.rotation, variants, 2);

                    for (i32 vi = 0; vi < variantCount; vi++) {
                        const i32 variantType = variants[static_cast<std::size_t>(vi)].placementType;
                        const i32 variantRot = variants[static_cast<std::size_t>(vi)].rotation;
                        const i32 groupKey = variantRot + (variantType << 3) + (resolved->id << 10);

                        LocAnimatedPlaceholder placeholder{};
                        if (p.type >= 4 && p.type <= 8) {
                            i32 offX = 0;
                            i32 offZ = 0;
                            // TS SceneLocs: wallDecoration.entity1 (diagonal-double secondary) does NOT
                            // include wallDecoration offsets, only entity0 does.
                            if (!(p.type == 8 && vi == 1)) {
                                wallDecorOffsetForTile(p.level, sceneX, sceneY, &offX, &offZ);
                            }
                            placeholder.instance.sceneX = (sceneX - border) * 128 + 64 + offX;
                            placeholder.instance.sceneZ = (sceneY - border) * 128 + 64 + offZ;
                        } else {
                            computeLocScenePosition(
                                *resolved,
                                p,
                                variantRot,
                                border,
                                sceneX,
                                sceneY,
                                /*wallDecorDisplacement=*/0,
                                &placeholder.instance.sceneX,
                                &placeholder.instance.sceneZ);
                        }
                        placeholder.instance.heightOffset = 0;
                        placeholder.instance.level = p.level;
                        placeholder.instance.contourGround =
                            (resolvedPlacement.sourceIsEntity && resolved->contourGroundType > 0)
                                ? static_cast<i32>(ContourGroundType::Vertex)
                                : resolveLocInstanceContourGround(scene, *resolved, p.level, sceneX, sceneY);
                        placeholder.instance.priority = priority;
                        placeholder.instance.interactType = static_cast<i32>(InteractType::Loc);
                        // TS parity: interactId uses the original placement id (pre-transform).
                        placeholder.instance.interactId = p.id;
                        // Preserve per-placement encounter order, but keep multi-variant placements stable
                        // (TS emits entity0 then entity1 for wall-corner/diagonal-double).
                        placeholder.sortKey = placementOrder * 2 + vi;
                        placeholder.groupKey = groupKey;
                        placeholder.includeLod = includeLod;
                        placeholder.hasAlpha = hasAlpha;
                        auto rrAnimated = animatedEntries.pushBack(placeholder);
                        if (!rrAnimated.isOk()) {
                            return rrAnimated.status();
                        }

                        // Record first-seen animated group ordering (TS Map insertion order) so we can append
                        // per-frame geometry in a deterministic order later.
                        i32 groupIndex = -1;
                        for (std::size_t gi = 0; gi < animatedGroups.size(); gi++) {
                            if (animatedGroups[gi].groupKey == groupKey) {
                                groupIndex = static_cast<i32>(gi);
                                break;
                            }
                        }
                        if (groupIndex < 0) {
                            LocAnimatedGroupPlan g{};
                            g.groupKey = groupKey;
                            g.seqId = resolvedPlacement.seqId;
                            g.locTypeId = resolved->id;
                            g.placementType = variantType;
                            g.rotation = variantRot;
                            g.hasAlpha = hasAlpha;
                            g.firstSortKey = placementOrder * 2 + vi;
                            auto rrGroup = animatedGroups.pushBack(g);
                            if (!rrGroup.isOk()) {
                                return rrGroup.status();
                            }
                        } else if (hasAlpha) {
                            animatedGroups[static_cast<std::size_t>(groupIndex)].hasAlpha = true;
                        }
                    }
                    if (debugOut) {
                        debugOut->debugLocAnimatedQueued += variantCount;
                    }
                    continue;
                }
                if (!hasModelsForPlacement) {
                    if (debugOut) {
                        debugOut->debugLocNoModelsForPlacement++;
                    }
                    continue;
                }

                const bool forceMerge = resolvedPlacement.forceMerge;
                const i32 placementCategory = locPlacementCategoryForSceneOrder(p.type);
                bool placementQueuedAnyModel = false;
                std::size_t variantBegin = 0;
	                while (variantBegin < modelRefs.size()) {
	                    const i32 variantType = modelRefs[variantBegin].placementType;
	                    const i32 variantRotation = modelRefs[variantBegin].rotation;
	                    std::size_t variantEnd = variantBegin + 1;
	                    while (variantEnd < modelRefs.size() &&
	                           modelRefs[variantEnd].placementType == variantType &&
	                           modelRefs[variantEnd].rotation == variantRotation) {
	                        variantEnd++;
	                    }

		                    i32 variantOpaque = 0;
		                    i32 variantAlpha = 0;
		                    i32 variantModelHash = 0;
		                    bool variantHasModelHash = false;
		                    bool variantFailed = false;
	                    const MergeNormalsEntry* mergeNormalsEntryForVariant = nullptr;
	                    const auto tryMatchMergeNormalsStats =
	                        [&](i32 candidateIndex) noexcept -> void {
	                        if (mergeNormalsEntryForVariant) {
	                            return;
	                        }
	                        if (candidateIndex < 0 ||
	                            candidateIndex >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                            return;
	                        }
	                        const MergeNormalsEntry& candidate =
	                            outPlan->mergeNormalsEntries[static_cast<std::size_t>(candidateIndex)];
	                        if (candidate.locTypeId == resolved->id &&
	                            candidate.placementIndex == placementIndex &&
	                            candidate.stats.modelHash != 0 &&
	                            candidate.placementType == variantType &&
	                            candidate.rotation == variantRotation) {
	                            mergeNormalsEntryForVariant = &candidate;
	                        }
	                    };
	                    tryMatchMergeNormalsStats(mergeNormalsEntryIndex0);
	                    tryMatchMergeNormalsStats(mergeNormalsEntryIndex1);
		                    bool variantHasBounds = false;
		                    i32 variantBoundsMinX = 0;
		                    i32 variantBoundsMaxX = 0;
		                    i32 variantBoundsMinZ = 0;
		                    i32 variantBoundsMaxZ = 0;
		                    if (mergeNormalsEntryForVariant) {
		                        // TS mergeNormals: use stats from the fully merged+hidden model, not the sum of
		                        // per-model stats.
		                        const ModelFaceStats& stats = mergeNormalsEntryForVariant->stats;
		                        variantOpaque = stats.opaqueElements;
		                        variantAlpha = stats.alphaElements;
		                        variantModelHash = stats.modelHash;
		                        variantHasModelHash = true;
		                        if (stats.hasBounds) {
		                            variantHasBounds = true;
		                            variantBoundsMinX = stats.minX;
		                            variantBoundsMaxX = stats.maxX;
		                            variantBoundsMinZ = stats.minZ;
		                            variantBoundsMaxZ = stats.maxZ;
		                        }
		                    } else {
	                        for (std::size_t mi = variantBegin; mi < variantEnd; mi++) {
	                            const LocModelVariantRef& modelRef = modelRefs[mi];
	                            if (debugOut) {
	                                debugOut->debugLocModelCandidates++;
	                            }
	                            const ModelFaceStats* stats = nullptr;
	                            const Status ms = tryDecodeModelFaceStatsFromBlob(
	                                input,
	                                modelCache,
	                                *resolved,
	                                modelRef.placementType,
	                                modelRef.rotation,
	                                modelRef.modelId,
	                                &stats,
	                                alloc);
	                            if (!ok(ms) || !stats) {
	                                variantFailed = true;
	                                if (debugOut) {
	                                    debugOut->debugLocModelStatsDecodeFailed++;
	                                    if (ms == Status::NotFound) {
	                                        debugOut->debugLocModelStatsNotFound++;
	                                        if (debugOut->debugLocMissingModelSampleCount == 0) {
	                                            debugOut->debugLocMissingModelSample0 = modelRef.modelId;
	                                            debugOut->debugLocMissingModelLocTypeId = resolved->id;
	                                            debugOut->debugLocMissingModelPlacementType = modelRef.placementType;
	                                            debugOut->debugLocMissingModelRotation = modelRef.rotation;
	                                        } else if (debugOut->debugLocMissingModelSampleCount == 1) {
	                                            debugOut->debugLocMissingModelSample1 = modelRef.modelId;
	                                        } else if (debugOut->debugLocMissingModelSampleCount == 2) {
	                                            debugOut->debugLocMissingModelSample2 = modelRef.modelId;
	                                        } else if (debugOut->debugLocMissingModelSampleCount == 3) {
	                                            debugOut->debugLocMissingModelSample3 = modelRef.modelId;
	                                        }
	                                        debugOut->debugLocMissingModelSampleCount++;
	                                    } else {
	                                        debugOut->debugLocModelStatsOtherError++;
	                                    }
	                                }
	                                break;
	                            }
	                            if (stats->hasBounds) {
	                                if (!variantHasBounds) {
	                                    variantHasBounds = true;
	                                    variantBoundsMinX = stats->minX;
	                                    variantBoundsMaxX = stats->maxX;
	                                    variantBoundsMinZ = stats->minZ;
	                                    variantBoundsMaxZ = stats->maxZ;
	                                } else {
	                                    if (stats->minX < variantBoundsMinX) variantBoundsMinX = stats->minX;
	                                    if (stats->maxX > variantBoundsMaxX) variantBoundsMaxX = stats->maxX;
	                                    if (stats->minZ < variantBoundsMinZ) variantBoundsMinZ = stats->minZ;
	                                    if (stats->maxZ > variantBoundsMaxZ) variantBoundsMaxZ = stats->maxZ;
	                                }
	                            }
	                            variantOpaque += stats->opaqueElements;
	                            variantAlpha += stats->alphaElements;
	                            if (!variantHasModelHash) {
	                                variantModelHash = stats->modelHash;
	                                variantHasModelHash = true;
	                            }
	                        }
	                    }

                    if (debugOut) {
                        debugOut->debugLocVariantCandidatesExpanded++;
                    }

	                    if (!variantFailed) {
	                        if (false && variantOpaque <= 0 && variantAlpha <= 0) {
	                            if (debugOut) {
	                                debugOut->debugLocModelStatsZeroFaces++;
	                            }
	                        } else {
		                            i32 variantSignature = variantModelHash;
		                            const std::size_t variantModelCount = variantEnd - variantBegin;
		                            if (!mergeNormalsEntryForVariant && variantModelCount > 1) {
		                                Vec<i32> variantModelIds(alloc);
		                                auto rrIds = variantModelIds.resize(variantModelCount);
		                                if (!rrIds.isOk()) {
		                                    return rrIds.status();
		                                }
	                                for (std::size_t mi = 0; mi < variantModelCount; mi++) {
	                                    variantModelIds[mi] = modelRefs[variantBegin + mi].modelId;
	                                }
	                                const Status hs = computeLocVariantModelHashForGroupingFromBlob(
	                                    input,
	                                    *resolved,
	                                    variantType,
	                                    variantRotation,
	                                    Span<const i32>(variantModelIds.data(), variantModelIds.size()),
	                                    &variantSignature,
	                                    alloc);
	                                if (!ok(hs)) {
	                                    variantFailed = true;
	                                }
	                            }
                            if (variantFailed) {
                                if (debugOut) {
                                    debugOut->debugLocVariantDecodeFailed++;
                                }
                                variantBegin = variantEnd;
                                continue;
                            }

                            if (debugOut) {
                                debugOut->debugLocVariantGroupsQueued++;
                                if (variantType == 9) {
                                    debugOut->debugLocVariantType9Queued++;
                                    if (resolved->id == 1651) {
                                        debugOut->debugLocVariantId1651Type9Queued++;
                                    }
                                } else if (variantType == 0) {
                                    debugOut->debugLocVariantType0Queued++;
                                    if (resolved->id == 1651) {
                                        debugOut->debugLocVariantId1651Type0Queued++;
                                    }
                                }
                                i32 variantDebugHash = debugOut->debugLocVariantGroupsHash;
                                if (variantDebugHash == 0) {
                                    variantDebugHash = 2166136261u;
                                }
                                variantDebugHash = fnv1aMixI32(variantDebugHash, resolved->id);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, p.type);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, p.rotation);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, variantType);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, variantRotation);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, priority);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, p.level);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, sceneX);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, sceneY);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, forceMerge ? 1 : 0);
                                variantDebugHash = fnv1aMixI32(variantDebugHash, includeLod ? 1 : 0);
                                debugOut->debugLocVariantGroupsHash = variantDebugHash;
                            }

                            i32 mergedSceneX = 0;
                            i32 mergedSceneZ = 0;
                            if (p.type >= 4 && p.type <= 8) {
                                i32 offX = 0;
                                i32 offZ = 0;
                                bool applyOffset = true;
                                if (p.type == 8) {
                                    // TS expandLocPlacementModelVariants: secondary is (rotation+2)&3 + 4.
                                    const i32 secondaryRot = (((p.rotation + 2) & 3) + 4);
                                    if (variantRotation == secondaryRot) {
                                        applyOffset = false;
                                    }
                                }
                                if (applyOffset) {
                                    wallDecorOffsetForTile(p.level, sceneX, sceneY, &offX, &offZ);
                                }
                                mergedSceneX = (sceneX - border) * 128 + 64 + offX;
                                mergedSceneZ = (sceneY - border) * 128 + 64 + offZ;
                            } else {
                                computeLocScenePosition(
                                    *resolved,
                                    p,
                                    variantRotation,
                                    border,
                                    sceneX,
                                    sceneY,
                                    /*wallDecorDisplacement=*/0,
                                    &mergedSceneX,
                                    &mergedSceneZ);
                            }
                            i32 contourSceneX = 0;
                            i32 contourSceneZ = 0;
                            computeLocContourSampleOrigin(
                                *resolved,
                                variantRotation,
                                sceneX,
                                sceneY,
                                &contourSceneX,
                                &contourSceneZ);
                            const i32 mergedSceneHeight = computeLocSceneHeight(
                                scene,
                                *resolved,
                                p.level,
                                sceneX,
                                sceneY,
                                variantRotation);
                            const i32 mergedContour =
                                (resolvedPlacement.sourceIsEntity && resolved->contourGroundType > 0)
                                    ? static_cast<i32>(ContourGroundType::Vertex)
                                    : ((variantType == 10)
                                           ? resolveLocInstanceContourGroundWithBounds(
                                                 scene,
                                                 *resolved,
                                                 p.level,
                                                 sceneX,
                                                 sceneY,
                                                 variantRotation,
                                                 variantHasBounds,
                                                 variantBoundsMinX,
                                                 variantBoundsMaxX,
                                                 variantBoundsMinZ,
                                                 variantBoundsMaxZ)
                                           : resolveLocInstanceContourGround(
                                                 scene,
                                                 *resolved,
                                                 p.level,
                                                 sceneX,
                                                 sceneY));
                            i32 modelIdsHash = 2166136261u;
                            for (std::size_t mi = variantBegin; mi < variantEnd; mi++) {
                                modelIdsHash = fnv1aMixI32(modelIdsHash, modelRefs[mi].modelId);
                            }

                            if (debugOut) {
                                i32 preMergeHash = debugOut->debugLocPreMergeGroupKeysHash;
                                if (preMergeHash == 0) {
                                    preMergeHash = 2166136261u;
                                }

                                const i32 preMergeContour = resolveLocInstanceContourGround(
                                    scene,
                                    *resolved,
                                    p.level,
                                    sceneX,
                                    sceneY);

                                preMergeHash = fnv1aMixI32(preMergeHash, resolved->id);
                                preMergeHash = fnv1aMixI32(preMergeHash, p.type);
                                preMergeHash = fnv1aMixI32(preMergeHash, p.rotation);
                                preMergeHash = fnv1aMixI32(preMergeHash, variantType);
                                preMergeHash = fnv1aMixI32(preMergeHash, variantRotation);
                                preMergeHash = fnv1aMixI32(preMergeHash, priority);
                                preMergeHash = fnv1aMixI32(preMergeHash, p.level);
                                preMergeHash = fnv1aMixI32(preMergeHash, sceneX);
                                preMergeHash = fnv1aMixI32(preMergeHash, sceneY);
                                preMergeHash = fnv1aMixI32(preMergeHash, forceMerge ? 1 : 0);
                                preMergeHash = fnv1aMixI32(preMergeHash, includeLod ? 1 : 0);
                                preMergeHash = fnv1aMixI32(preMergeHash, mergedSceneHeight);
                                preMergeHash = fnv1aMixI32(preMergeHash, contourSceneX);
                                preMergeHash = fnv1aMixI32(preMergeHash, contourSceneZ);
                                preMergeHash = fnv1aMixI32(preMergeHash, preMergeContour);
                                preMergeHash = fnv1aMixI32(preMergeHash, modelIdsHash);

                                i32 preMergeSignature = 2166136261u;
                                preMergeSignature = fnv1aMixI32(preMergeSignature, resolved->id);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, p.type);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, p.rotation);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, variantType);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, variantRotation);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, priority);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, p.level);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, sceneX);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, sceneY);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, forceMerge ? 1 : 0);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, includeLod ? 1 : 0);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, mergedSceneHeight);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, contourSceneX);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, contourSceneZ);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, preMergeContour);
                                preMergeSignature = fnv1aMixI32(preMergeSignature, modelIdsHash);
                                auto rrPreMergeSignature = debugOut->debugLocPreMergeGroupKeySignatures.pushBack(preMergeSignature);
                                if (!rrPreMergeSignature.isOk()) {
                                    return rrPreMergeSignature.status();
                                }

                                const i32 preMergeEntryPacked[17] = {
                                    preMergeSignature,
                                    resolved->id,
                                    p.type,
                                    p.rotation,
                                    variantType,
                                    variantRotation,
                                    p.level,
                                    sceneX,
                                    sceneY,
                                    priority,
                                    forceMerge ? 1 : 0,
                                    includeLod ? 1 : 0,
                                    mergedSceneHeight,
                                    contourSceneX,
                                    contourSceneZ,
                                    preMergeContour,
                                    modelIdsHash,
                                };
                                for (std::size_t pei = 0; pei < 17; pei++) {
                                    auto rrPreMergeEntry = debugOut->debugLocPreMergeGroupKeyEntriesPacked.pushBack(preMergeEntryPacked[pei]);
                                    if (!rrPreMergeEntry.isOk()) {
                                        return rrPreMergeEntry.status();
                                    }
                                }

                                debugOut->debugLocPreMergeGroupKeysQueued++;
                                debugOut->debugLocPreMergeGroupKeysHash = preMergeHash;
                            }
	                            // TS does not introduce runtime-only contour profile partitions when
		                            // grouping loc models into draw commands.
		                            const bool contourSensitive = false;
		                            const i32 contourProfileHash = 0;
	                            i32 mergeNormalsEntryIndex = -1;
	                            const auto tryMatchMergeNormalsEntryIndex =
	                                [&](i32 candidateIndex) noexcept -> void {
	                                if (mergeNormalsEntryIndex >= 0) {
	                                    return;
	                                }
	                                if (candidateIndex < 0 ||
	                                    candidateIndex >= static_cast<i32>(outPlan->mergeNormalsEntries.size())) {
	                                    return;
	                                }
	                                const MergeNormalsEntry& candidate =
	                                    outPlan->mergeNormalsEntries[static_cast<std::size_t>(candidateIndex)];
	                                if (candidate.locTypeId == resolved->id &&
	                                    candidate.placementIndex == placementIndex &&
	                                    candidate.stats.modelHash != 0 &&
	                                    candidate.placementType == variantType &&
	                                    candidate.rotation == variantRotation) {
	                                    mergeNormalsEntryIndex = candidateIndex;
	                                }
	                            };
	                            tryMatchMergeNormalsEntryIndex(mergeNormalsEntryIndex0);
	                            tryMatchMergeNormalsEntryIndex(mergeNormalsEntryIndex1);
	                            const bool canUseMergeNormalsEntry = mergeNormalsEntryIndex >= 0;
                                const SceneLocCommandGroupKey groupKey{
                                    .modelSignature = variantSignature,
                                    .modelIdsHash = modelIdsHash,
                                    .placementType = variantType,
                                    .rotation = variantRotation,
                                    .level = p.level,
                                    .priority = priority,
                                    .forceMerge = forceMerge,
                                    .contourSensitive = contourSensitive,
                                    .contourSceneHeight = mergedSceneHeight,
                                    .contourSceneX = contourSceneX,
                                    .contourSceneZ = contourSceneZ,
                                    .contourGround = mergedContour,
                                    .contourProfileHash = contourProfileHash,
                                };
                                i32 groupIndex = -1;
                                (void)groupLookup.find(groupKey, &groupIndex);

                            i32 targetGroupIndex = groupIndex;
                            bool createdNewGroup = false;
	                            if (targetGroupIndex < 0) {
	                                LocCommandGroup group(alloc);
	                                group.locTypeId = resolved->id;
	                                group.modelSignature = variantSignature;
	                                group.modelIdsHash = modelIdsHash;
	                                group.placementType = variantType;
	                                group.rotation = variantRotation;
	                                // Representative model id for debug/provenance only (variants may have >1 models).
	                                group.modelId = modelRefs[variantBegin].modelId;
	                                group.level = p.level;
	                                group.priority = priority;
	                                group.firstSeenOrder = placementOrder;
	                                group.placementCategory = placementCategory;
                                group.forceMerge = forceMerge;
                                group.contourSensitive = contourSensitive;
                                group.hasBounds = variantHasBounds;
                                group.boundsMinX = variantBoundsMinX;
                                group.boundsMaxX = variantBoundsMaxX;
                                group.boundsMinZ = variantBoundsMinZ;
                                group.boundsMaxZ = variantBoundsMaxZ;
                                group.opaqueElementsPerInstance = variantOpaque;
                                group.alphaElementsPerInstance = variantAlpha;
                                group.contourKeySceneHeight = mergedSceneHeight;
                                group.contourKeySceneX = contourSceneX;
	                                group.contourKeySceneZ = contourSceneZ;
	                                group.contourKeyGround = mergedContour;
	                                group.contourKeyProfileHash = contourProfileHash;
	                                group.mergeNormalsEntryIndex =
	                                    canUseMergeNormalsEntry ? mergeNormalsEntryIndex : -1;
	                                const SceneLocCommandGroupKey debugGroupKey{
	                                    .modelSignature = group.modelSignature,
	                                    .modelIdsHash = group.modelIdsHash,
	                                    .placementType = group.placementType,
                                    .rotation = group.rotation,
                                    .level = group.level,
                                    .priority = group.priority,
                                    .forceMerge = group.forceMerge,
                                    .contourSensitive = group.contourSensitive,
                                    .contourSceneHeight = group.contourKeySceneHeight,
                                    .contourSceneX = group.contourKeySceneX,
                                    .contourSceneZ = group.contourKeySceneZ,
                                    .contourGround = group.contourKeyGround,
                                    .contourProfileHash = group.contourKeyProfileHash,
                                };
                                group.debugGroupKeySignature = hashSceneLocCommandGroupKeyForDebug(debugGroupKey);
                                auto rrGroup = groups.pushBack(rs::move(group));
                                if (!rrGroup.isOk()) {
                                    return rrGroup.status();
                                }
                                targetGroupIndex = static_cast<i32>(groups.size() - 1);
                                createdNewGroup = true;
                                auto rrInsertIndex = groupLookup.insertIfMissing(groupKey, targetGroupIndex);
                                if (!rrInsertIndex.isOk()) {
                                    return rrInsertIndex.status();
                                }
                            }

                            if (targetGroupIndex < 0 ||
                                targetGroupIndex >= static_cast<i32>(groups.size())) {
	                                return Status::OutOfRange;
	                            }
	                            // Any representative is fine as long as modelSignature matches.
	                            if (canUseMergeNormalsEntry) {
	                                LocCommandGroup& group = groups[static_cast<std::size_t>(targetGroupIndex)];
	                                if (group.mergeNormalsEntryIndex < 0) {
	                                    group.mergeNormalsEntryIndex = mergeNormalsEntryIndex;
	                                }
	                            }

	                            const Status mergeDebugStatus = appendLocMergeDecisionEntryPacked(
	                                debugOut,
	                                resolved->id,
                                p.type,
                                p.rotation,
                                variantType,
                                variantRotation,
                                p.level,
                                sceneX,
                                sceneY,
                                priority,
                                forceMerge,
                                includeLod,
                                contourSensitive,
                                mergedSceneHeight,
                                contourSceneX,
                                contourSceneZ,
                                mergedContour,
                                contourProfileHash,
                                variantSignature,
                                modelIdsHash,
                                groupIndex,
                                targetGroupIndex,
                                createdNewGroup,
                                variantOpaque,
                                variantAlpha,
                                placementCategory,
                                placementOrder,
                                static_cast<i32>(variantEnd - variantBegin));
                            if (!ok(mergeDebugStatus)) {
                                return mergeDebugStatus;
                            }

                            const LocCommandGroup& candidateGroup =
                                groups[static_cast<std::size_t>(targetGroupIndex)];
                            if (candidateGroup.opaqueElementsPerInstance != variantOpaque ||
                                candidateGroup.alphaElementsPerInstance != variantAlpha ||
                                candidateGroup.hasBounds != variantHasBounds ||
                                (candidateGroup.hasBounds &&
                                 (candidateGroup.boundsMinX != variantBoundsMinX ||
                                  candidateGroup.boundsMaxX != variantBoundsMaxX ||
                                  candidateGroup.boundsMinZ != variantBoundsMinZ ||
                                  candidateGroup.boundsMaxZ != variantBoundsMaxZ))) {
                                if (debugOut) {
                                    debugOut->debugLocGroupStatsMismatch++;
                                }
	                                LocCommandGroup replacementGroup(alloc);
	                                replacementGroup.locTypeId = resolved->id;
	                                replacementGroup.modelSignature = variantSignature;
	                                replacementGroup.modelIdsHash = modelIdsHash;
	                                replacementGroup.placementType = variantType;
	                                replacementGroup.rotation = variantRotation;
	                                replacementGroup.modelId = modelRefs[variantBegin].modelId;
	                                replacementGroup.level = p.level;
	                                replacementGroup.priority = priority;
	                                replacementGroup.firstSeenOrder = placementOrder;
	                                replacementGroup.placementCategory = placementCategory;
                                replacementGroup.forceMerge = forceMerge;
                                replacementGroup.contourSensitive = contourSensitive;
                                replacementGroup.hasBounds = variantHasBounds;
                                replacementGroup.boundsMinX = variantBoundsMinX;
                                replacementGroup.boundsMaxX = variantBoundsMaxX;
                                replacementGroup.boundsMinZ = variantBoundsMinZ;
                                replacementGroup.boundsMaxZ = variantBoundsMaxZ;
                                replacementGroup.opaqueElementsPerInstance = variantOpaque;
                                replacementGroup.alphaElementsPerInstance = variantAlpha;
                                replacementGroup.contourKeySceneHeight = mergedSceneHeight;
	                                replacementGroup.contourKeySceneX = contourSceneX;
	                                replacementGroup.contourKeySceneZ = contourSceneZ;
	                                replacementGroup.contourKeyGround = mergedContour;
	                                replacementGroup.contourKeyProfileHash = contourProfileHash;
	                                replacementGroup.mergeNormalsEntryIndex =
	                                    canUseMergeNormalsEntry ? mergeNormalsEntryIndex : -1;
	                                const SceneLocCommandGroupKey replacementDebugGroupKey{
	                                    .modelSignature = replacementGroup.modelSignature,
	                                    .modelIdsHash = replacementGroup.modelIdsHash,
	                                    .placementType = replacementGroup.placementType,
                                    .rotation = replacementGroup.rotation,
                                    .level = replacementGroup.level,
                                    .priority = replacementGroup.priority,
                                    .forceMerge = replacementGroup.forceMerge,
                                    .contourSensitive = replacementGroup.contourSensitive,
                                    .contourSceneHeight = replacementGroup.contourKeySceneHeight,
                                    .contourSceneX = replacementGroup.contourKeySceneX,
                                    .contourSceneZ = replacementGroup.contourKeySceneZ,
                                    .contourGround = replacementGroup.contourKeyGround,
                                    .contourProfileHash = replacementGroup.contourKeyProfileHash,
                                };
                                replacementGroup.debugGroupKeySignature =
                                    hashSceneLocCommandGroupKeyForDebug(replacementDebugGroupKey);
                                auto rrReplacement = groups.pushBack(rs::move(replacementGroup));
                                if (!rrReplacement.isOk()) {
                                    return rrReplacement.status();
                                }
                                targetGroupIndex = static_cast<i32>(groups.size() - 1);
                                createdNewGroup = true;
                            }
                            if (targetGroupIndex < 0 ||
                                targetGroupIndex >= static_cast<i32>(groups.size())) {
                                return Status::OutOfRange;
                            }
                            LocCommandGroup& group = groups[static_cast<std::size_t>(targetGroupIndex)];
                            if (placementOrder < group.firstSeenOrder) {
                                group.firstSeenOrder = placementOrder;
                            }
                            if (placementCategory < group.placementCategory) {
                                group.placementCategory = placementCategory;
                            }

                            ModelInfo mergedInst{};
                            mergedInst.sceneX = mergedSceneX;
                            mergedInst.sceneZ = mergedSceneZ;
                            mergedInst.heightOffset = 0;
                            mergedInst.level = p.level;
                            mergedInst.contourGround = mergedContour;
                            mergedInst.interactType = static_cast<i32>(InteractType::None);
                            mergedInst.priority = priority;
                            mergedInst.interactId = 0xffff;
                            auto rrMerged = group.mergedInstances.pushBack(mergedInst);
                            if (!rrMerged.isOk()) {
                                return rrMerged.status();
                            }
                            auto rrHeight = group.sceneHeights.pushBack(mergedSceneHeight);
                            if (!rrHeight.isOk()) {
                                return rrHeight.status();
                            }
                            auto rrContourX = group.contourSceneXs.pushBack(contourSceneX);
                            if (!rrContourX.isOk()) {
                                return rrContourX.status();
                            }
                            auto rrContourZ = group.contourSceneZs.pushBack(contourSceneZ);
                            if (!rrContourZ.isOk()) {
                                return rrContourZ.status();
                            }
                            if (debugOut) {
                                debugOut->debugLocInstancesQueued++;
                            }
                            placementQueuedAnyModel = true;

                            ModelInfo interactInst = mergedInst;
                            interactInst.interactType = static_cast<i32>(InteractType::Loc);
                            interactInst.interactId = resolvedPlacement.interactId;
                            auto rrInteract = group.interactInstances.pushBack(interactInst);
                            if (!rrInteract.isOk()) {
                                return rrInteract.status();
                            }
                            auto rrLod = group.includeLodFlags.pushBack(static_cast<u8>(includeLod ? 1 : 0));
                            if (!rrLod.isOk()) {
                                return rrLod.status();
                            }
                            auto rrOrder = group.placementOrders.pushBack(placementOrder);
                            if (!rrOrder.isOk()) {
                                return rrOrder.status();
                            }
                        }
                    } else {
                        if (debugOut) {
                            debugOut->debugLocVariantDecodeFailed++;
                        }
                    }

                    variantBegin = variantEnd;
                }
                if (placementQueuedAnyModel && debugOut) {
                    debugOut->debugLocPlacementsQueuedAnyModel++;
                }
        }
    placementLoopUs = locElapsedUs(placementLoopStart);

    Vec<LocMergeBucket> mergeBuckets(alloc);
    Vec<LocInstancedOp> instancedOps(alloc);
    Vec<ModelInfo> instancedInstancesPool(alloc);
    Vec<ModelInfo> instancedLodInstancesPool(alloc);

    const auto renderPlanStart = LocBuildClock::now();
    const Status planStatus = buildLocRenderCommandPlan(
        input,
        Span<const LocCommandGroup>(groups.data(), groups.size()),
        planOps,
        &mergeBuckets,
        &instancedOps,
        &instancedInstancesPool,
        &instancedLodInstancesPool,
        debugOut,
        alloc);
    renderPlanUs = locElapsedUs(renderPlanStart);
    if (!ok(planStatus)) {
        return planStatus;
    }

    // TS parity: `SceneBuffer.addLocAnimatedGroups()` emits placeholders group-major, iterating
    // groups in first-seen order (Map insertion), and within each group, locs in encounter order.
    // Our planning loop encounters placements in tile-scan order, but stores placeholders in a flat
    // list. Reorder them to the TS group-major order and reorder groups accordingly so frame-geometry
    // append order matches as well.
    const auto animatedOrderStart = LocBuildClock::now();
    if (!animatedEntries.empty()) {
        Vec<LocAnimatedPlaceholder> sortedEntries(alloc);
        auto rrSorted = sortedEntries.resize(animatedEntries.size());
        if (!rrSorted.isOk()) {
            return rrSorted.status();
        }
        for (std::size_t ei = 0; ei < animatedEntries.size(); ei++) {
            sortedEntries[ei] = animatedEntries[ei];
        }
        sortInPlace(
            sortedEntries.data(),
            sortedEntries.size(),
            [&](const LocAnimatedPlaceholder& a, const LocAnimatedPlaceholder& b) noexcept -> bool {
                return a.sortKey < b.sortKey;
            });

        Vec<i32> orderedGroupKeys(alloc);
        I32LookupIndex seenGroupKeys(alloc);
        // At most one group per placeholder in the worst case.
        auto rrKeys = orderedGroupKeys.reserve(sortedEntries.size());
        if (!rrKeys.isOk()) {
            return rrKeys.status();
        }
        auto rrSeenKeys = seenGroupKeys.reserveForExpectedCount(sortedEntries.size() + 1);
        if (!rrSeenKeys.isOk()) {
            return rrSeenKeys.status();
        }
        for (std::size_t ei = 0; ei < sortedEntries.size(); ei++) {
            const i32 key = sortedEntries[ei].groupKey;
            unsigned char seenValue = 0;
            const bool seen = seenGroupKeys.find(key, &seenValue);
            if (!seen) {
                auto rrKey = orderedGroupKeys.pushBack(key);
                if (!rrKey.isOk()) {
                    return rrKey.status();
                }
                auto rrInsertKey = seenGroupKeys.insertIfMissing(key, static_cast<unsigned char>(1));
                if (!rrInsertKey.isOk()) {
                    return rrInsertKey.status();
                }
            }
        }

        Vec<LocAnimatedGroupPlan> orderedGroups(alloc);
        auto rrOG = orderedGroups.reserve(orderedGroupKeys.size());
        if (!rrOG.isOk()) {
            return rrOG.status();
        }
        for (std::size_t ki = 0; ki < orderedGroupKeys.size(); ki++) {
            const i32 key = orderedGroupKeys[ki];
            i32 found = -1;
            for (std::size_t gi = 0; gi < animatedGroups.size(); gi++) {
                if (animatedGroups[gi].groupKey == key) {
                    found = static_cast<i32>(gi);
                    break;
                }
            }
            if (found < 0) {
                // Should not happen (groups are created at the same time as placeholders), but keep
                // the runtime robust.
                continue;
            }
            LocAnimatedGroupPlan g = animatedGroups[static_cast<std::size_t>(found)];
            // First member in encounter order defines group insertion order.
            for (std::size_t ei = 0; ei < sortedEntries.size(); ei++) {
                if (sortedEntries[ei].groupKey == key) {
                    g.firstSortKey = sortedEntries[ei].sortKey;
                    break;
                }
            }
            auto rrG = orderedGroups.pushBack(g);
            if (!rrG.isOk()) {
                return rrG.status();
            }
        }

        Vec<LocAnimatedPlaceholder> orderedEntries(alloc);
        auto rrOE = orderedEntries.reserve(sortedEntries.size());
        if (!rrOE.isOk()) {
            return rrOE.status();
        }
        for (std::size_t ki = 0; ki < orderedGroupKeys.size(); ki++) {
            const i32 key = orderedGroupKeys[ki];
            for (std::size_t ei = 0; ei < sortedEntries.size(); ei++) {
                if (sortedEntries[ei].groupKey != key) {
                    continue;
                }
                auto rrE = orderedEntries.pushBack(sortedEntries[ei]);
                if (!rrE.isOk()) {
                    return rrE.status();
                }
            }
        }

        animatedGroups = rs::move(orderedGroups);
        animatedEntries = rs::move(orderedEntries);
    }

    animatedOrderUs = locElapsedUs(animatedOrderStart);
    if (debugOut) {
        debugOut->debugLocPlanSortPlacementsUs = sortPlacementsUs;
        debugOut->debugLocPlanMergeNormalsUs = mergeNormalsUs;
        debugOut->debugLocPlanPlacementLoopUs = placementLoopUs;
        debugOut->debugLocPlanRenderPlanUs = renderPlanUs;
        debugOut->debugLocPlanAnimatedOrderUs = animatedOrderUs;
    }

    outPlan->groups = rs::move(groups);
    outPlan->mergeBuckets = rs::move(mergeBuckets);
    outPlan->instancedOps = rs::move(instancedOps);
    outPlan->instancedInstancesPool = rs::move(instancedInstancesPool);
    outPlan->instancedLodInstancesPool = rs::move(instancedLodInstancesPool);
    outPlan->animatedEntries = rs::move(animatedEntries);
    outPlan->animatedGroups = rs::move(animatedGroups);
    return Status::Ok;
}

static Status executeLocCommandsFromPlan(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedSeqTypeCache* seqTypeCache,
    LocCommandPlan* plan,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !locTypeCache || !seqTypeCache || !plan) {
        return Status::InvalidArgument;
    }
    (void)seqTypeCache; // animated frames are appended later, after static scene geometry.
    i32 executeInstancedUs = 0;
    i32 executeMergedUs = 0;
    if (debugOut) {
        debugOut->debugLocExecuteInstancedUs = 0;
        debugOut->debugLocExecuteMergedUs = 0;
    }

    Vec<i32> groupModelIds(alloc);

    const auto executeInstancedStart = LocBuildClock::now();
    const Status instancedStatus = executeLocInstancedOps(
        input,
        scene,
        Span<LocCommandGroup>(plan->groups.data(), plan->groups.size()),
        Span<const LocInstancedOp>(plan->instancedOps.data(), plan->instancedOps.size()),
        Span<const ModelInfo>(plan->instancedInstancesPool.data(), plan->instancedInstancesPool.size()),
        Span<const ModelInfo>(plan->instancedLodInstancesPool.data(), plan->instancedLodInstancesPool.size()),
        Span<const MergeNormalsEntry>(plan->mergeNormalsEntries.data(), plan->mergeNormalsEntries.size()),
        buffer,
        &groupModelIds,
        indexCount,
        locTypeCache,
        debugOut,
        alloc);
    executeInstancedUs = locElapsedUs(executeInstancedStart);
    if (debugOut) {
        debugOut->debugLocExecuteInstancedUs = executeInstancedUs;
    }
    if (!ok(instancedStatus)) {
        return instancedStatus;
    }

    const auto executeMergedStart = LocBuildClock::now();
    const Status mergedStatus = executeLocMergeBuckets(
        input,
        scene,
        Span<LocCommandGroup>(plan->groups.data(), plan->groups.size()),
        Span<LocMergeBucket>(plan->mergeBuckets.data(), plan->mergeBuckets.size()),
        Span<const MergeNormalsEntry>(plan->mergeNormalsEntries.data(), plan->mergeNormalsEntries.size()),
        buffer,
        &groupModelIds,
        indexCount,
        locTypeCache,
        debugOut,
        alloc);
    executeMergedUs = locElapsedUs(executeMergedStart);
    if (debugOut) {
        debugOut->debugLocExecuteMergedUs = executeMergedUs;
    }
    if (!ok(mergedStatus)) {
        return mergedStatus;
    }

    return Status::Ok;
}

static Status appendAnimatedLocFrameGeometryFromPlan(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<const LocAnimatedGroupPlan> groups,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedSeqTypeCache* seqTypeCache,
    SceneLocAnimatedTickInit* outTickInit,
    Vec<i32>* outGroupFrameOffsetsBase,
    Vec<i32>* outGroupFrameCountsBase,
    Vec<i32>* outGroupFrameOffsetsAlpha,
    Vec<i32>* outGroupFrameCountsAlpha,
    Vec<u8>* outGroupHasAlpha,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !locTypeCache || !seqTypeCache) {
        return Status::InvalidArgument;
    }
    if (groups.empty()) {
        return Status::Ok;
    }

    if (outGroupFrameOffsetsBase) {
        auto rr = outGroupFrameOffsetsBase->resize(groups.size());
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < outGroupFrameOffsetsBase->size(); i++) (*outGroupFrameOffsetsBase)[i] = -1;
    }
    if (outGroupFrameCountsBase) {
        auto rr = outGroupFrameCountsBase->resize(groups.size());
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < outGroupFrameCountsBase->size(); i++) (*outGroupFrameCountsBase)[i] = 0;
    }
    if (outGroupFrameOffsetsAlpha) {
        auto rr = outGroupFrameOffsetsAlpha->resize(groups.size());
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < outGroupFrameOffsetsAlpha->size(); i++) (*outGroupFrameOffsetsAlpha)[i] = -1;
    }
    if (outGroupFrameCountsAlpha) {
        auto rr = outGroupFrameCountsAlpha->resize(groups.size());
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < outGroupFrameCountsAlpha->size(); i++) (*outGroupFrameCountsAlpha)[i] = 0;
    }

    if (outGroupHasAlpha) {
        auto rr = outGroupHasAlpha->resize(groups.size());
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < outGroupHasAlpha->size(); i++) {
            (*outGroupHasAlpha)[i] = 0;
        }
    }

    Vec<i32> modelIds(alloc);

    const auto pushAnimFrame = [&](Vec<i32>* packed, i32 offsetBytes, i32 elements, i32 instances) noexcept -> Status {
        if (!packed) {
            return Status::Ok;
        }
        auto rr0 = packed->pushBack(offsetBytes);
        if (!rr0.isOk()) return rr0.status();
        auto rr1 = packed->pushBack(elements);
        if (!rr1.isOk()) return rr1.status();
        auto rr2 = packed->pushBack(instances);
        if (!rr2.isOk()) return rr2.status();
        return Status::Ok;
    };

    for (std::size_t gi = 0; gi < groups.size(); gi++) {
        const LocAnimatedGroupPlan& g = groups[gi];
        bool groupHasAlpha = false;
        // TS parity: alpha placeholder buckets (`framesAlpha`) are enabled only when transparent
        // geometry is actually emitted for at least one frame (i.e. `addModelAnimFrame(..., true)`
        // returns elements > 0). Do not use seq alpha-hints as a proxy signal here.
        if (g.seqId < 0 || g.locTypeId < 0) {
            if (outGroupHasAlpha && groupHasAlpha) {
                (*outGroupHasAlpha)[gi] = 1;
            }
            continue;
        }

        const SeqType* seq = nullptr;
        const Status sqs = tryDecodeSeqTypeFromBlob(input, seqTypeCache, g.seqId, &seq, alloc);
        if (!ok(sqs) || !seq) {
            if (outGroupHasAlpha && groupHasAlpha) {
                (*outGroupHasAlpha)[gi] = 1;
            }
            continue;
        }

        const LocType* locType = nullptr;
        const Status lts = tryDecodeLocTypeFromBlob(input, locTypeCache, g.locTypeId, &locType, alloc);
        if (!ok(lts) || !locType) {
            if (outGroupHasAlpha && groupHasAlpha) {
                (*outGroupHasAlpha)[gi] = 1;
            }
            continue;
        }

        if (!collectLocTypeModelIdsForVariant(*locType, g.placementType, &modelIds) || modelIds.empty()) {
            if (outGroupHasAlpha && groupHasAlpha) {
                (*outGroupHasAlpha)[gi] = 1;
            }
            continue;
        }

        const i32 rot = g.rotation & 3;
        const bool applyContour = false;
        const i32 contourSceneX = 0;
        const i32 contourSceneZ = 0;
        const i32 sceneHeight = 0;

        LocPlacement placement{};
        placement.id = g.locTypeId;
        placement.type = g.placementType;
        placement.rotation = g.rotation;
        placement.level = 0;

        const i32 groupBaseOffset =
            outTickInit ? static_cast<i32>(outTickInit->locAnimFramesBasePacked.size()) : -1;
        const i32 groupAlphaOffset =
            outTickInit ? static_cast<i32>(outTickInit->locAnimFramesAlphaPacked.size()) : -1;
        i32 groupFrameCount = 0;

        if (seq->animMayaId >= 0) {
            const i32 duration = seq->animMayaEnd - seq->animMayaStart;
            if (duration <= 0) {
                continue;
            }
            groupFrameCount = duration;

            SkeletalSeq skeletalSeq(alloc);
            SeqBase seqBase(-1, alloc);
            const Status ss = tryDecodeSkeletalSeqFromBlob(
                input,
                seq->animMayaId,
                &skeletalSeq,
                &seqBase,
                alloc);
            if (!ok(ss)) {
                continue;
            }

            for (i32 frame = 0; frame < duration; frame++) {
                bool haveModel = true;
                // TS LocModelLoader.getLocModelData merges all variant models *before* lighting/animation.
                ModelData model(alloc);
                if (modelIds.size() == 1) {
                    const Status ms = decodeLocModelFromBlobForPlacement(
                        input,
                        *locType,
                        g.placementType,
                        g.rotation,
                        modelIds[0],
                        &model,
                        /*applyDiagonalNormalVariantRotation=*/false,
                        alloc);
                    if (!ok(ms)) {
                        haveModel = false;
                    }
                } else {
                    Vec<ModelData> parts(alloc);
                    auto rrReserve = parts.reserve(modelIds.size());
                    if (!rrReserve.isOk()) {
                        return rrReserve.status();
                    }
                    bool okAll = true;
                    for (std::size_t mi = 0; mi < modelIds.size(); mi++) {
                        ModelData part(alloc);
                        const Status ms = decodeLocModelFromBlobForPlacement(
                            input,
                            *locType,
                            g.placementType,
                            g.rotation,
                            modelIds[mi],
                            &part,
                            /*applyDiagonalNormalVariantRotation=*/false,
                            alloc);
                        if (!ok(ms)) {
                            okAll = false;
                            break;
                        }
                        auto rrPush = parts.pushBack(rs::move(part));
                        if (!rrPush.isOk()) {
                            return rrPush.status();
                        }
                    }
                    if (!okAll) {
                        haveModel = false;
                    }
                    if (haveModel) {
                        const Status ms = mergeModelDataTS(
                            Span<const ModelData>(parts.data(), parts.size()),
                            static_cast<i32>(parts.size()),
                            &model,
                            alloc);
                        if (!ok(ms)) {
                            haveModel = false;
                        }
                    }
                }

                if (!haveModel) {
                    // TS parity: missing model decodes become NULL_DRAW_RANGE for both passes.
                    Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                    if (!ok(ps)) return ps;
                    ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                    if (!ok(ps)) return ps;
                    continue;
                }

                ModelFaceLightingState lighting(alloc);
                const Status ls = initModelFaceLightingState(model, &lighting, alloc);
                if (!ok(ls)) {
                    Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                    if (!ok(ps)) return ps;
                    ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                    if (!ok(ps)) return ps;
                    continue;
                }

                if (skeletalSeq.hasAlphaTransform) {
                    const Status as = ensureAnimatedModelHasFaceAlphas(&model);
                    if (!ok(as)) {
                        return as;
                    }
                }

                // TS transformModel (skeletal): unrotate -> animateSkeletal -> rotate back.
                if (rot == 1) model.rotate270();
                else if (rot == 2) model.rotate180();
                else if (rot == 3) model.rotate90();

                const Status as = applySkeletalToModel(&model, seqBase, skeletalSeq, frame, alloc);
                if (!ok(as)) {
                    Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                    if (!ok(ps)) return ps;
                    ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                    if (!ok(ps)) return ps;
                    continue;
                }

                if (rot == 1) model.rotate90();
                else if (rot == 2) model.rotate180();
                else if (rot == 3) model.rotate270();

                // TS getModelAnimated: apply diagonal rotation after animation transforms.
                if (g.placementType == 10 && g.rotation > 3) {
                    model.rotate(256);
                }

                // Opaque then alpha, matching TS addModelAnimFrame(false/true).
                for (int pass = 0; pass < 2; pass++) {
                    const bool transparentOnly = (pass == 1);
                    const i32 offsetBytes = buffer->indexByteOffset();
                    i32 generatedElements = 0;
                    const Status gs = appendLocPlacementGeometryFromDecodedModelWithLightingState(
                        input,
                        scene,
                        *locType,
                        placement,
                        0,
                        0,
                        contourSceneX,
                        contourSceneZ,
                        sceneHeight,
                        applyContour,
                        model,
                        lighting,
                        transparentOnly,
                        /*debugOut=*/nullptr,
                        &buffer->vertices,
                        &buffer->indices,
                        &generatedElements,
                        alloc);
                    if (!ok(gs)) {
                        return gs;
                    }
                    *indexCount += generatedElements;
                    if (transparentOnly && generatedElements > 0) {
                        // TS parity: `framesAlpha` exists iff any alpha pass returns elements > 0.
                        groupHasAlpha = true;
                    }
                    const i32 instances = 1;
                    Status ps = pushAnimFrame(
                        outTickInit
                            ? (transparentOnly ? &outTickInit->locAnimFramesAlphaPacked
                                               : &outTickInit->locAnimFramesBasePacked)
                            : nullptr,
                        offsetBytes,
                        generatedElements,
                        instances);
                    if (!ok(ps)) return ps;
                }
            }
            if (outGroupHasAlpha && groupHasAlpha) {
                (*outGroupHasAlpha)[gi] = 1;
            }
            if (outGroupFrameOffsetsBase) (*outGroupFrameOffsetsBase)[gi] = groupBaseOffset;
            if (outGroupFrameCountsBase) (*outGroupFrameCountsBase)[gi] = groupFrameCount;
            if (outGroupFrameOffsetsAlpha) (*outGroupFrameOffsetsAlpha)[gi] = groupAlphaOffset;
            if (outGroupFrameCountsAlpha) (*outGroupFrameCountsAlpha)[gi] = groupFrameCount;
            continue;
        }

        if (seq->frameIds.empty()) {
            continue;
        }
        groupFrameCount = static_cast<i32>(seq->frameIds.size());

        for (std::size_t fi = 0; fi < seq->frameIds.size(); fi++) {
            const i32 frameId = seq->frameIds[fi];
            SeqBase frameBase(-1, alloc);
            SeqFrame frame(alloc);
            const Status fs = tryDecodeBridgeSeqFrameFromBlob(input, frameId, &frameBase, &frame, alloc);
            if (!ok(fs)) {
                // TS parity: missing frame/model decode becomes NULL_DRAW_RANGE.
                Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                continue;
            }

            // TS LocModelLoader.getLocModelData merges all variant models *before* lighting/animation.
            bool haveModel = true;
            ModelData model(alloc);
            if (modelIds.size() == 1) {
                const Status ms = decodeLocModelFromBlobForPlacement(
                    input,
                    *locType,
                    g.placementType,
                    g.rotation,
                    modelIds[0],
                    &model,
                    /*applyDiagonalNormalVariantRotation=*/false,
                    alloc);
                if (!ok(ms)) {
                    haveModel = false;
                }
            } else {
                Vec<ModelData> parts(alloc);
                auto rrReserve = parts.reserve(modelIds.size());
                if (!rrReserve.isOk()) {
                    return rrReserve.status();
                }
                bool okAll = true;
                for (std::size_t mi = 0; mi < modelIds.size(); mi++) {
                    ModelData part(alloc);
                    const Status ms = decodeLocModelFromBlobForPlacement(
                        input,
                        *locType,
                        g.placementType,
                        g.rotation,
                        modelIds[mi],
                        &part,
                        /*applyDiagonalNormalVariantRotation=*/false,
                        alloc);
                    if (!ok(ms)) {
                        okAll = false;
                        break;
                    }
                    auto rrPush = parts.pushBack(rs::move(part));
                    if (!rrPush.isOk()) {
                        return rrPush.status();
                    }
                }
                if (!okAll) {
                    haveModel = false;
                }
                if (haveModel) {
                    const Status ms = mergeModelDataTS(
                        Span<const ModelData>(parts.data(), parts.size()),
                        static_cast<i32>(parts.size()),
                        &model,
                        alloc);
                    if (!ok(ms)) {
                        haveModel = false;
                    }
                }
            }

            if (!haveModel) {
                Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                continue;
            }

            // Classic animation uses vertex labels for transform ops and face labels for alpha ops.
            // TS still applies alpha transforms even when vertex labels are absent.
            AnimLabelTables labelTables(alloc);
            const Status lts2 = buildAnimLabelTables(model, &labelTables, alloc);
            if (!ok(lts2)) {
                Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                continue;
            }

            if (frame.hasAlphaTransform) {
                const Status as = ensureAnimatedModelHasFaceAlphas(&model);
                if (!ok(as)) {
                    return as;
                }
            }

            ModelFaceLightingState lighting(alloc);
            const Status ls = initModelFaceLightingState(model, &lighting, alloc);
            if (!ok(ls)) {
                Status ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesBasePacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                ps = pushAnimFrame(outTickInit ? &outTickInit->locAnimFramesAlphaPacked : nullptr, 0, 0, 0);
                if (!ok(ps)) return ps;
                continue;
            }

            // TS transformModel: unrotate -> animate -> rotate back.
            if (rot == 1) model.rotate270();
            else if (rot == 2) model.rotate180();
            else if (rot == 3) model.rotate90();

            applyBridgeSeqFrameToModelClassic(&model, labelTables, frameBase, frame);

            if (rot == 1) model.rotate90();
            else if (rot == 2) model.rotate180();
            else if (rot == 3) model.rotate270();

            // TS getModelAnimated: apply diagonal rotation after animation transforms.
            if (g.placementType == 10 && g.rotation > 3) {
                model.rotate(256);
            }

            // Opaque then alpha, matching TS addModelAnimFrame(false/true).
            for (int pass = 0; pass < 2; pass++) {
                const bool transparentOnly = (pass == 1);
                const i32 offsetBytes = buffer->indexByteOffset();
                i32 generatedElements = 0;
                const Status gs = appendLocPlacementGeometryFromDecodedModelWithLightingState(
                    input,
                    scene,
                    *locType,
                    placement,
                    0,
                    0,
                    contourSceneX,
                    contourSceneZ,
                    sceneHeight,
                    applyContour,
                    model,
                    lighting,
                    transparentOnly,
                    /*debugOut=*/nullptr,
                    &buffer->vertices,
                    &buffer->indices,
                    &generatedElements,
                    alloc);
                if (!ok(gs)) {
                    return gs;
                }
                *indexCount += generatedElements;
                if (transparentOnly && generatedElements > 0) {
                    // TS parity: `framesAlpha` exists iff any alpha pass returns elements > 0.
                    groupHasAlpha = true;
                }
                const i32 instances = 1;
                Status ps = pushAnimFrame(
                    outTickInit
                        ? (transparentOnly ? &outTickInit->locAnimFramesAlphaPacked
                                           : &outTickInit->locAnimFramesBasePacked)
                        : nullptr,
                    offsetBytes,
                    generatedElements,
                    instances);
                if (!ok(ps)) return ps;
            }
        }
        if (outGroupHasAlpha && groupHasAlpha) {
            (*outGroupHasAlpha)[gi] = 1;
        }
        if (outGroupFrameOffsetsBase) (*outGroupFrameOffsetsBase)[gi] = groupBaseOffset;
        if (outGroupFrameCountsBase) (*outGroupFrameCountsBase)[gi] = groupFrameCount;
        if (outGroupFrameOffsetsAlpha) (*outGroupFrameOffsetsAlpha)[gi] = groupAlphaOffset;
        if (outGroupFrameCountsAlpha) (*outGroupFrameCountsAlpha)[gi] = groupFrameCount;
    }
    return Status::Ok;
}

Status emitLocCommandsFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    Vec<LocAnimatedGroupPlan>* outAnimatedGroups,
    Vec<LocAnimatedPlaceholder>* outAnimatedEntries,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !locTypeCache || !varbitCache || !seqTypeCache || !modelCache) {
        return Status::InvalidArgument;
    }
    if (outAnimatedGroups) {
        outAnimatedGroups->clear();
    }
    if (outAnimatedEntries) {
        outAnimatedEntries->clear();
    }
    if (debugOut) {
        debugOut->debugLocPlanTotalUs = 0;
        debugOut->debugLocExecuteTotalUs = 0;
    }

    LocCommandPlan plan(alloc);
    const auto locPlanStart = LocBuildClock::now();
    const Status ps = planLocCommandsFromMapLocBytes(
        input,
        scene,
        tileHasValidFaceColorsAForLowDetail,
        planOps,
        locTypeCache,
        varbitCache,
        seqTypeCache,
        modelCache,
        debugOut,
        &plan,
        alloc);
    const i32 locPlanUs = locElapsedUs(locPlanStart);
    if (debugOut) {
        debugOut->debugLocPlanTotalUs = locPlanUs;
    }
    if (!ok(ps)) {
        return ps;
    }

    if (outAnimatedGroups) {
        *outAnimatedGroups = rs::move(plan.animatedGroups);
    }
    if (outAnimatedEntries) {
        *outAnimatedEntries = rs::move(plan.animatedEntries);
    }
    const auto locExecuteStart = LocBuildClock::now();
    const Status execStatus = executeLocCommandsFromPlan(
        input,
        scene,
        buffer,
        indexCount,
        locTypeCache,
        seqTypeCache,
        &plan,
        debugOut,
        alloc);
    const i32 locExecuteUs = locElapsedUs(locExecuteStart);
    if (debugOut) {
        debugOut->debugLocExecuteTotalUs = locExecuteUs;
    }
    return execStatus;
}

struct LocDeferredPlan final {
    LocCommandPlan plan;
    explicit LocDeferredPlan(Allocator& alloc) noexcept : plan(alloc) {}
};

Status createLocDeferredPlanFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    LocDeferredPlan** outPlan,
    Vec<LocAnimatedGroupPlan>* outAnimatedGroups,
    Vec<LocAnimatedPlaceholder>* outAnimatedEntries,
    Allocator& alloc) noexcept {
    if (!outPlan || !locTypeCache || !varbitCache || !seqTypeCache || !modelCache) {
        return Status::InvalidArgument;
    }
    *outPlan = nullptr;
    if (outAnimatedGroups) outAnimatedGroups->clear();
    if (outAnimatedEntries) outAnimatedEntries->clear();

    void* mem = alloc.alloc ? alloc.alloc(alloc.ctx, sizeof(LocDeferredPlan), alignof(LocDeferredPlan)) : nullptr;
    if (!mem) {
        return Status::OutOfMemory;
    }
    LocDeferredPlan* plan = new (mem) LocDeferredPlan(alloc);

    const Status ps = planLocCommandsFromMapLocBytes(
        input,
        scene,
        tileHasValidFaceColorsAForLowDetail,
        planOps,
        locTypeCache,
        varbitCache,
        seqTypeCache,
        modelCache,
        debugOut,
        &plan->plan,
        alloc);
    if (!ok(ps)) {
        plan->~LocDeferredPlan();
        if (alloc.free) alloc.free(alloc.ctx, mem, alignof(LocDeferredPlan));
        return ps;
    }

    if (outAnimatedGroups) {
        *outAnimatedGroups = rs::move(plan->plan.animatedGroups);
    }
    if (outAnimatedEntries) {
        *outAnimatedEntries = rs::move(plan->plan.animatedEntries);
    }

    *outPlan = plan;
    return Status::Ok;
}

Status executeLocDeferredPlanInstanced(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    LocDeferredPlan* plan,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !locTypeCache || !plan) {
        return Status::InvalidArgument;
    }
    Vec<i32> groupModelIds(alloc);
    return executeLocInstancedOps(
        input,
        scene,
        Span<LocCommandGroup>(plan->plan.groups.data(), plan->plan.groups.size()),
        Span<const LocInstancedOp>(plan->plan.instancedOps.data(), plan->plan.instancedOps.size()),
        Span<const ModelInfo>(plan->plan.instancedInstancesPool.data(), plan->plan.instancedInstancesPool.size()),
        Span<const ModelInfo>(plan->plan.instancedLodInstancesPool.data(), plan->plan.instancedLodInstancesPool.size()),
        Span<const MergeNormalsEntry>(plan->plan.mergeNormalsEntries.data(), plan->plan.mergeNormalsEntries.size()),
        buffer,
        &groupModelIds,
        indexCount,
        locTypeCache,
        debugOut,
        alloc);
}

Status executeLocDeferredPlanMerged(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    LocDeferredPlan* plan,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !locTypeCache || !plan) {
        return Status::InvalidArgument;
    }
    Vec<i32> groupModelIds(alloc);
    return executeLocMergeBuckets(
        input,
        scene,
        Span<LocCommandGroup>(plan->plan.groups.data(), plan->plan.groups.size()),
        Span<LocMergeBucket>(plan->plan.mergeBuckets.data(), plan->plan.mergeBuckets.size()),
        Span<const MergeNormalsEntry>(plan->plan.mergeNormalsEntries.data(), plan->plan.mergeNormalsEntries.size()),
        buffer,
        &groupModelIds,
        indexCount,
        locTypeCache,
        debugOut,
        alloc);
}

Status destroyLocDeferredPlan(LocDeferredPlan* plan, Allocator& alloc) noexcept {
    if (!plan) return Status::Ok;
    plan->~LocDeferredPlan();
    if (alloc.free) {
        alloc.free(alloc.ctx, plan, alignof(LocDeferredPlan));
    }
    return Status::Ok;
}

Status emitLocAnimatedFramesAndPlaceholdersFromPlannedGroups(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<const LocAnimatedGroupPlan> groups,
    Span<const LocAnimatedPlaceholder> entries,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedSeqTypeCache* seqTypeCache,
    SceneLocAnimatedTickInit* outTickInit,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !locTypeCache || !seqTypeCache) {
        return Status::InvalidArgument;
    }
    if (groups.empty() && entries.empty()) {
        return Status::Ok;
    }

    Vec<u8> groupHasAlpha(alloc);
    Vec<i32> groupFrameOffsetsBase(alloc);
    Vec<i32> groupFrameCountsBase(alloc);
    Vec<i32> groupFrameOffsetsAlpha(alloc);
    Vec<i32> groupFrameCountsAlpha(alloc);
    const Status animGeoStatus = appendAnimatedLocFrameGeometryFromPlan(
        input,
        scene,
        groups,
        buffer,
        indexCount,
        locTypeCache,
        seqTypeCache,
        outTickInit,
        &groupFrameOffsetsBase,
        &groupFrameCountsBase,
        &groupFrameOffsetsAlpha,
        &groupFrameCountsAlpha,
        &groupHasAlpha,
        alloc);
    if (!ok(animGeoStatus)) {
        return animGeoStatus;
    }

    if (entries.empty()) {
        return Status::Ok;
    }

    // TS parity: placeholder alpha buckets are controlled by whether animation frames produce
    // any transparent geometry for that animated group (`framesAlpha`), not by static model hints.
    Vec<LocAnimatedPlaceholder> normalizedEntries(alloc);
    auto rr = normalizedEntries.resize(entries.size());
    if (!rr.isOk()) {
        return rr.status();
    }
    for (std::size_t i = 0; i < entries.size(); i++) {
        LocAnimatedPlaceholder entry = entries[i];
        bool matchedGroup = false;
        for (std::size_t gi = 0; gi < groups.size(); gi++) {
            if (groups[gi].groupKey != entry.groupKey) {
                continue;
            }
            if (gi < groupHasAlpha.size()) {
                // TS parity: placeholder alpha buckets are controlled exclusively by whether any
                // frame actually emitted transparent geometry (`framesAlpha` exists).
                entry.hasAlpha = (groupHasAlpha[gi] != 0);
            }
            matchedGroup = true;
            break;
        }
        // If we didn't match a group (should be rare), keep the planned hint instead of forcing off.
        (void)matchedGroup;
        normalizedEntries[i] = entry;
    }

    if (outTickInit) {
        const std::size_t locCount = normalizedEntries.size();
        // Resize per-loc arrays and set defaults.
        auto rr = outTickInit->locSeqIds.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locRandomStart.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locSortKeys.resize(locCount);
        if (!rr.isOk()) return rr.status();

        rr = outTickInit->locDrawRangeIndicesBase.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesAlpha.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesLod.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesLodAlpha.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesInteract.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesInteractAlpha.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesInteractLod.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locDrawRangeIndicesInteractLodAlpha.resize(locCount);
        if (!rr.isOk()) return rr.status();

        rr = outTickInit->locAnimFrameOffsetsBase.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locAnimFrameCountsBase.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locAnimFrameOffsetsAlpha.resize(locCount);
        if (!rr.isOk()) return rr.status();
        rr = outTickInit->locAnimFrameCountsAlpha.resize(locCount);
        if (!rr.isOk()) return rr.status();

        for (std::size_t i = 0; i < locCount; i++) {
            outTickInit->locSeqIds[i] = -1;
            outTickInit->locRandomStart[i] = 0;
            outTickInit->locSortKeys[i] = normalizedEntries[i].sortKey;

            outTickInit->locDrawRangeIndicesBase[i] = -1;
            outTickInit->locDrawRangeIndicesAlpha[i] = -1;
            outTickInit->locDrawRangeIndicesLod[i] = -1;
            outTickInit->locDrawRangeIndicesLodAlpha[i] = -1;
            outTickInit->locDrawRangeIndicesInteract[i] = -1;
            outTickInit->locDrawRangeIndicesInteractAlpha[i] = -1;
            outTickInit->locDrawRangeIndicesInteractLod[i] = -1;
            outTickInit->locDrawRangeIndicesInteractLodAlpha[i] = -1;

            outTickInit->locAnimFrameOffsetsBase[i] = -1;
            outTickInit->locAnimFrameCountsBase[i] = 0;
            outTickInit->locAnimFrameOffsetsAlpha[i] = -1;
            outTickInit->locAnimFrameCountsAlpha[i] = 0;
        }

        // Fill per-loc seq/frames table refs by matching groupKey.
        for (std::size_t li = 0; li < locCount; li++) {
            const LocAnimatedPlaceholder& e = normalizedEntries[li];
            i32 groupIndex = -1;
            for (std::size_t gi = 0; gi < groups.size(); gi++) {
                if (groups[gi].groupKey == e.groupKey) {
                    groupIndex = static_cast<i32>(gi);
                    break;
                }
            }
            if (groupIndex < 0) {
                continue;
            }
            const LocAnimatedGroupPlan& g = groups[static_cast<std::size_t>(groupIndex)];
            outTickInit->locSeqIds[li] = g.seqId;

            const LocType* locType = nullptr;
            const Status lts = tryDecodeLocTypeFromBlob(input, locTypeCache, g.locTypeId, &locType, alloc);
            if (ok(lts) && locType) {
                outTickInit->locRandomStart[li] = locType->seqRandomStart ? 1 : 0;
            }

            if (groupIndex >= 0 && groupIndex < static_cast<i32>(groupFrameOffsetsBase.size())) {
                const i32 offBase = groupFrameOffsetsBase[static_cast<std::size_t>(groupIndex)];
                const i32 cntBase = groupFrameCountsBase[static_cast<std::size_t>(groupIndex)];
                if (offBase >= 0 && cntBase > 0) {
                    outTickInit->locAnimFrameOffsetsBase[li] = offBase;
                    outTickInit->locAnimFrameCountsBase[li] = cntBase;
                }
            }
            if (e.hasAlpha &&
                groupIndex >= 0 && groupIndex < static_cast<i32>(groupFrameOffsetsAlpha.size())) {
                const i32 offAlpha = groupFrameOffsetsAlpha[static_cast<std::size_t>(groupIndex)];
                const i32 cntAlpha = groupFrameCountsAlpha[static_cast<std::size_t>(groupIndex)];
                if (offAlpha >= 0 && cntAlpha > 0) {
                    outTickInit->locAnimFrameOffsetsAlpha[li] = offAlpha;
                    outTickInit->locAnimFrameCountsAlpha[li] = cntAlpha;
                }
            }
        }
    }

    return emitLocAnimatedPlaceholders(
        Span<const LocAnimatedPlaceholder>(normalizedEntries.data(), normalizedEntries.size()),
        buffer,
        outTickInit);
}

Status appendLocPlanOpsFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!locTypeCache || !varbitCache || !seqTypeCache || !modelCache) {
        return Status::InvalidArgument;
    }
    LocCommandPlan plan(alloc);
    return planLocCommandsFromMapLocBytes(
        input,
        scene,
        tileHasValidFaceColorsAForLowDetail,
        planOps,
        locTypeCache,
        varbitCache,
        seqTypeCache,
        modelCache,
        debugOut,
        &plan,
        alloc);
}

} // namespace scb
} // namespace rs
