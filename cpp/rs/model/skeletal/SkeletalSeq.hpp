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

struct SkeletalCurveBinding final {
    SkeletalTransformType transformType = SkeletalTransformType::TYPE_0;
    i32 boneIndex = 0;
    i32 curveIndex = 0;
    SkeletalCurve curve{};

    explicit SkeletalCurveBinding(Allocator& alloc = defaultAllocator()) noexcept
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
    Vec<SkeletalCurveBinding> bindings{};

    explicit SkeletalSeq(Allocator& alloc = defaultAllocator()) noexcept
        : bindings(alloc) {}
};

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

    out->bindings.clear();
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
            auto br = out->bindings.emplaceBack(SkeletalCurveBinding(defaultAllocator()));
            if (!br.isOk()) return br.status();
            SkeletalCurveBinding* binding = br.value();
            binding->transformType = transformType;
            binding->boneIndex = boneIndex;
            binding->curveIndex = curveIndex;
            binding->curve = rs::move(curve);
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
