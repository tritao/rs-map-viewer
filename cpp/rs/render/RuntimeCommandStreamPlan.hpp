#pragma once

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

static constexpr i32 kSceneCommandBucketCount = 8;
static constexpr i32 kSceneCommandInstanceStrideInts = 8;

struct RuntimeCommandBucketPlan final {
    i32 cmdStart = 0;
    i32 cmdCount = 0;
    i32 instanceStart = 0;
    i32 instanceCount = 0;
    i32 modelInfoOffset = 0;
    i32 modelInfoLength = 0;
};

// Plan for packing the runtime command-stream outputs (draw ranges + model-info texture),
// matching the TS runtime packer in `src/renderer/buffer/SceneCommandBuilder.ts`.
struct RuntimeCommandStreamPlan final {
    i32 totalCmdCount = 0;
    i32 totalInstanceCount = 0;
    i32 totalModelInfoLength = 0;
    RuntimeCommandBucketPlan buckets[kSceneCommandBucketCount]{};
};

i32 runtimeCommandModelInfoTextureLengthFromCounts(i32 cmdCount, i32 instanceCount) noexcept;

Status buildRuntimeCommandStreamPlan(
    Span<const i32> bucketCmdCounts,
    Span<const i32> cmdInstanceCounts,
    RuntimeCommandStreamPlan* outPlan) noexcept;

Status packRuntimeCommandRangesAndModelInfo(
    const RuntimeCommandStreamPlan& plan,
    Span<const i32> cmdOffsets,
    Span<const i32> cmdElements,
    Span<const i32> cmdInstanceCounts,
    Span<const i32> packedInstances,
    Span<i32> outDrawRanges,
    Span<u16> outModelInfoTextureConcat) noexcept;

} // namespace rs
