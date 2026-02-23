#pragma once

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

static constexpr i32 kScenePackBucketCount = 8;
static constexpr i32 kScenePackInstanceStrideInts = 8;

struct ScenePackBucketPlan final {
    i32 cmdStart = 0;
    i32 cmdCount = 0;
    i32 instanceStart = 0;
    i32 instanceCount = 0;
    i32 modelInfoOffset = 0;
    i32 modelInfoLength = 0;
};

struct ScenePackPlan final {
    i32 totalCmdCount = 0;
    i32 totalInstanceCount = 0;
    i32 totalModelInfoLength = 0;
    ScenePackBucketPlan buckets[kScenePackBucketCount]{};
};

i32 scenePackModelInfoTextureLengthFromCounts(i32 cmdCount, i32 instanceCount) noexcept;

Status buildScenePackPlan(
    Span<const i32> bucketCmdCounts,
    Span<const i32> cmdInstanceCounts,
    ScenePackPlan* outPlan) noexcept;

Status packSceneDrawRangesAndModelInfo(
    const ScenePackPlan& plan,
    Span<const i32> cmdOffsets,
    Span<const i32> cmdElements,
    Span<const i32> cmdInstanceCounts,
    Span<const i32> packedInstances,
    Span<i32> outDrawRanges,
    Span<u16> outModelInfoTextureConcat) noexcept;

} // namespace rs
