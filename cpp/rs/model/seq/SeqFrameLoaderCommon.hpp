#pragma once

#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Status.hpp"
#include "SeqBase.hpp"
#include "SeqFrame.hpp"

namespace rs {

inline Status cloneSeqBase(const SeqBase& src, Allocator& alloc, SeqBase* out) noexcept {
    if (!out) return Status::InvalidArgument;

    SeqBase copy(src.id, alloc);
    copy.count = src.count;

    auto rr = copy.types.resize(src.types.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.transformActor.resize(src.transformActor.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.masks.resize(src.masks.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.labels.resize(src.labels.size());
    if (!rr.isOk()) return rr.status();

    for (std::size_t i = 0; i < src.types.size(); i++) copy.types[i] = src.types[i];
    for (std::size_t i = 0; i < src.transformActor.size(); i++) copy.transformActor[i] = src.transformActor[i];
    for (std::size_t i = 0; i < src.masks.size(); i++) copy.masks[i] = src.masks[i];
    for (std::size_t i = 0; i < src.labels.size(); i++) {
        const Vec<i32>& srcLabels = src.labels[i];
        Vec<i32> dstLabels(alloc);
        auto lr = dstLabels.resize(srcLabels.size());
        if (!lr.isOk()) return lr.status();
        for (std::size_t j = 0; j < srcLabels.size(); j++) dstLabels[j] = srcLabels[j];
        copy.labels[i] = rs::move(dstLabels);
    }

    copy.hasSkeletalBase = src.hasSkeletalBase;
    copy.skeletalBoneCount = src.skeletalBoneCount;
    copy.skeletalBase.poseCount = src.skeletalBase.poseCount;
    if (src.hasSkeletalBase && src.skeletalBase.boneCount() > 0) {
        auto pr = copy.skeletalBase.parentIds.resize(src.skeletalBase.parentIds.size());
        if (!pr.isOk()) return pr.status();
        pr = copy.skeletalBase.localMatrices.resize(src.skeletalBase.localMatrices.size());
        if (!pr.isOk()) return pr.status();
        pr = copy.skeletalBase.rotations.resize(src.skeletalBase.rotations.size());
        if (!pr.isOk()) return pr.status();
        pr = copy.skeletalBase.translations.resize(src.skeletalBase.translations.size());
        if (!pr.isOk()) return pr.status();
        pr = copy.skeletalBase.scalings.resize(src.skeletalBase.scalings.size());
        if (!pr.isOk()) return pr.status();

        for (std::size_t i = 0; i < src.skeletalBase.parentIds.size(); i++) copy.skeletalBase.parentIds[i] = src.skeletalBase.parentIds[i];
        for (std::size_t i = 0; i < src.skeletalBase.localMatrices.size(); i++) copy.skeletalBase.localMatrices[i] = src.skeletalBase.localMatrices[i];
        for (std::size_t i = 0; i < src.skeletalBase.rotations.size(); i++) copy.skeletalBase.rotations[i] = src.skeletalBase.rotations[i];
        for (std::size_t i = 0; i < src.skeletalBase.translations.size(); i++) copy.skeletalBase.translations[i] = src.skeletalBase.translations[i];
        for (std::size_t i = 0; i < src.skeletalBase.scalings.size(); i++) copy.skeletalBase.scalings[i] = src.skeletalBase.scalings[i];
    }

    *out = rs::move(copy);
    return Status::Ok;
}

inline Status cloneSeqFrame(const SeqFrame& src, Allocator& alloc, SeqFrame* out) noexcept {
    if (!out) return Status::InvalidArgument;

    SeqFrame copy(alloc);
    copy.frameLength = src.frameLength;
    copy.baseId = src.baseId;
    copy.transformCount = src.transformCount;
    copy.hasAlphaTransform = src.hasAlphaTransform;
    copy.hasColorTransform = src.hasColorTransform;

    auto rr = copy.transformGroups.resize(src.transformGroups.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.transformX.resize(src.transformX.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.transformY.resize(src.transformY.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.transformZ.resize(src.transformZ.size());
    if (!rr.isOk()) return rr.status();
    rr = copy.resetOriginGroups.resize(src.resetOriginGroups.size());
    if (!rr.isOk()) return rr.status();

    for (std::size_t i = 0; i < src.transformGroups.size(); i++) copy.transformGroups[i] = src.transformGroups[i];
    for (std::size_t i = 0; i < src.transformX.size(); i++) copy.transformX[i] = src.transformX[i];
    for (std::size_t i = 0; i < src.transformY.size(); i++) copy.transformY[i] = src.transformY[i];
    for (std::size_t i = 0; i < src.transformZ.size(); i++) copy.transformZ[i] = src.transformZ[i];
    for (std::size_t i = 0; i < src.resetOriginGroups.size(); i++) copy.resetOriginGroups[i] = src.resetOriginGroups[i];

    *out = rs::move(copy);
    return Status::Ok;
}

} // namespace rs
