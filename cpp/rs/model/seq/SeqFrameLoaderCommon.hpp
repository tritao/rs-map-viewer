#pragma once

#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Status.hpp"
#include "SeqFrame.hpp"

namespace rs {

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

