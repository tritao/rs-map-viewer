#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../core/Move.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../seq/SeqBaseLoader.hpp"
#include "SkeletalCurve.hpp"
#include "SkeletalTransformType.hpp"

namespace rs {

struct SkeletalCurveSlot final {
    bool hasCurve = false;
    SkeletalCurve curve{};

    explicit SkeletalCurveSlot(Allocator& alloc = defaultAllocator()) noexcept
        : curve(0, alloc) {}
};

// Mirrors src/rs/model/skeletal/SkeletalSeq.ts decode surface, including curve data.
struct SkeletalSeq final {
    i32 id = -1;
    i32 version = 0;
    i32 baseId = -1;
    i32 poseId = 0;
    i32 curveCount = 0;
    bool hasAlphaTransform = false;
    Vec<Vec<SkeletalCurveSlot>> boneCurves{};
    Vec<Vec<SkeletalCurveSlot>> curves{};

    explicit SkeletalSeq(Allocator& alloc = defaultAllocator()) noexcept
        : boneCurves(alloc),
          curves(alloc) {}

    [[nodiscard]] const SkeletalCurve* tryGetBoneCurve(i32 boneIndex, i32 curveIndex) const noexcept {
        if (boneIndex < 0 || curveIndex < 0) return nullptr;
        if (static_cast<std::size_t>(boneIndex) >= boneCurves.size()) return nullptr;
        const Vec<SkeletalCurveSlot>& channels = boneCurves[static_cast<std::size_t>(boneIndex)];
        if (static_cast<std::size_t>(curveIndex) >= channels.size()) return nullptr;
        const SkeletalCurveSlot& slot = channels[static_cast<std::size_t>(curveIndex)];
        return slot.hasCurve ? &slot.curve : nullptr;
    }

    [[nodiscard]] const SkeletalCurve* tryGetCurve(i32 transformIndex, i32 curveIndex) const noexcept {
        if (transformIndex < 0 || curveIndex < 0) return nullptr;
        if (static_cast<std::size_t>(transformIndex) >= curves.size()) return nullptr;
        const Vec<SkeletalCurveSlot>& channels = curves[static_cast<std::size_t>(transformIndex)];
        if (static_cast<std::size_t>(curveIndex) >= channels.size()) return nullptr;
        const SkeletalCurveSlot& slot = channels[static_cast<std::size_t>(curveIndex)];
        return slot.hasCurve ? &slot.curve : nullptr;
    }
};

inline Status ensureSkeletalCurveChannels(
    Vec<Vec<SkeletalCurveSlot>>* table,
    i32 tableIndex,
    i32 channelCount) noexcept {
    if (!table) return Status::InvalidArgument;
    if (tableIndex < 0 || channelCount <= 0) return Status::Ok;
    if (static_cast<std::size_t>(tableIndex) >= table->size()) return Status::Ok;

    Vec<SkeletalCurveSlot>& channels = (*table)[static_cast<std::size_t>(tableIndex)];
    if (!channels.empty()) return Status::Ok;

    auto rr = channels.resize(static_cast<std::size_t>(channelCount));
    if (!rr.isOk()) return rr.status();
    return Status::Ok;
}

inline Status decodeDat2SkeletalSeq(
    const Dat2SeqBaseLoader& baseLoader,
    i32 id,
    Span<const u8> data,
    SkeletalSeq* out) noexcept {
    (void)getSkeletalCurveCount; // helper kept for parity with TS transform table.
    if (!out) {
        return Status::InvalidArgument;
    }

    Uint8ArrayReader reader(data, 0);

    u8 version = 0;
    Status s = reader.readUnsignedByte(&version);
    if (!ok(s)) {
        return s;
    }

    u16 baseIdU16 = 0;
    s = reader.readUnsignedShort(&baseIdU16);
    if (!ok(s)) {
        return s;
    }
    const i32 baseId = static_cast<i32>(baseIdU16);

    const SeqBase* base = nullptr;
    s = baseLoader.tryLoad(baseId, &base);
    if (!ok(s)) {
        return s;
    }
    if (!base || !base->hasSkeletalBase) {
        return Status::BadFormat;
    }

    u16 ignoredU16 = 0;
    s = reader.readUnsignedShort(&ignoredU16);
    if (!ok(s)) return s;
    s = reader.readUnsignedShort(&ignoredU16);
    if (!ok(s)) return s;

    u8 poseId = 0;
    s = reader.readUnsignedByte(&poseId);
    if (!ok(s)) {
        return s;
    }

    u16 curveCountU16 = 0;
    s = reader.readUnsignedShort(&curveCountU16);
    if (!ok(s)) {
        return s;
    }

    const i32 boneCount = base->skeletalBase.boneCount();
    auto rr = out->boneCurves.resize(static_cast<std::size_t>(boneCount >= 0 ? boneCount : 0));
    if (!rr.isOk()) return rr.status();
    rr = out->curves.resize(static_cast<std::size_t>(base->count >= 0 ? base->count : 0));
    if (!rr.isOk()) return rr.status();
    for (std::size_t i = 0; i < out->boneCurves.size(); i++) out->boneCurves[i].clear();
    for (std::size_t i = 0; i < out->curves.size(); i++) out->curves[i].clear();
    out->hasAlphaTransform = false;

    bool hasAlphaTransform = false;
    for (u16 i = 0; i < curveCountU16; i++) {
        u8 transformTypeId = 0;
        s = reader.readUnsignedByte(&transformTypeId);
        if (!ok(s)) return s;
        const SkeletalTransformType transformType =
            getSkeletalTransformTypeForId(static_cast<i32>(transformTypeId));

        i32 boneIndex = 0;
        s = reader.readSmart2(&boneIndex);
        if (!ok(s)) return s;

        u8 curveTypeId = 0;
        s = reader.readUnsignedByte(&curveTypeId);
        if (!ok(s)) return s;
        const i32 curveIndex = getSkeletalCurveIndex(static_cast<i32>(curveTypeId));

        SkeletalCurve curve(static_cast<i32>(i));
        s = decodeSkeletalCurve(reader, static_cast<i32>(version), &curve);
        if (!ok(s)) return s;
        s = loadSkeletalCurve(&curve);
        if (!ok(s)) return s;

        if (curveIndex >= 0) {
            Vec<Vec<SkeletalCurveSlot>>* target = nullptr;
            if (transformType == SkeletalTransformType::BONE) {
                target = &out->boneCurves;
            } else {
                target = &out->curves;
            }
            const i32 channelCount = getSkeletalCurveCount(transformType);
            s = ensureSkeletalCurveChannels(target, boneIndex, channelCount);
            if (!ok(s)) return s;
            if (boneIndex >= 0 &&
                static_cast<std::size_t>(boneIndex) < target->size() &&
                channelCount > 0 &&
                curveIndex < channelCount) {
                SkeletalCurveSlot& slot = (*target)[static_cast<std::size_t>(boneIndex)][static_cast<std::size_t>(curveIndex)];
                slot.hasCurve = true;
                slot.curve = rs::move(curve);
            }
        }

        if (transformType == SkeletalTransformType::ALPHA) {
            hasAlphaTransform = true;
        }
    }

    out->id = id;
    out->version = static_cast<i32>(version);
    out->baseId = baseId;
    out->poseId = static_cast<i32>(poseId);
    out->curveCount = static_cast<i32>(curveCountU16);
    out->hasAlphaTransform = hasAlphaTransform;

    return Status::Ok;
}

} // namespace rs
