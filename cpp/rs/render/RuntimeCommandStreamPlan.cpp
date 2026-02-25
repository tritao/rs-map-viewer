#include "RuntimeCommandStreamPlan.hpp"

#include <cstddef>

namespace rs {

static i32 roundHeightOffsetDiv8Js(i32 heightOffset) noexcept {
    if (heightOffset >= 0) {
        return (heightOffset + 4) / 8;
    }
    return -(((-heightOffset) + 3) / 8);
}

i32 runtimeCommandModelInfoTextureLengthFromCounts(i32 cmdCount, i32 instanceCount) noexcept {
    const i32 dataLengthRounded = ((cmdCount * 4 + instanceCount + 15) / 16) * 16;
    return (dataLengthRounded > 16 ? dataLengthRounded : 16) * 4;
}

Status buildRuntimeCommandStreamPlan(
    Span<const i32> bucketCmdCounts,
    Span<const i32> cmdInstanceCounts,
    RuntimeCommandStreamPlan* outPlan) noexcept {
    if (!outPlan) {
        return Status::InvalidArgument;
    }
    if (bucketCmdCounts.size() != static_cast<std::size_t>(kSceneCommandBucketCount)) {
        return Status::SizeMismatch;
    }

    RuntimeCommandStreamPlan plan{};
    for (i32 bucket = 0; bucket < kSceneCommandBucketCount; bucket++) {
        const i32 cmdCount = bucketCmdCounts[static_cast<std::size_t>(bucket)];
        if (cmdCount < 0) {
            return Status::InvalidArgument;
        }
        RuntimeCommandBucketPlan& bp = plan.buckets[static_cast<std::size_t>(bucket)];
        bp.cmdStart = plan.totalCmdCount;
        bp.cmdCount = cmdCount;
        plan.totalCmdCount += cmdCount;
    }

    if (cmdInstanceCounts.size() != static_cast<std::size_t>(plan.totalCmdCount)) {
        return Status::SizeMismatch;
    }

    for (i32 bucket = 0; bucket < kSceneCommandBucketCount; bucket++) {
        RuntimeCommandBucketPlan& bp = plan.buckets[static_cast<std::size_t>(bucket)];
        i32 bucketInstanceCount = 0;
        for (i32 i = 0; i < bp.cmdCount; i++) {
            const i32 instanceCount =
                cmdInstanceCounts[static_cast<std::size_t>(bp.cmdStart + i)];
            if (instanceCount < 0) {
                return Status::InvalidArgument;
            }
            bucketInstanceCount += instanceCount;
        }
        bp.instanceStart = plan.totalInstanceCount;
        bp.instanceCount = bucketInstanceCount;
        bp.modelInfoOffset = plan.totalModelInfoLength;
        bp.modelInfoLength = runtimeCommandModelInfoTextureLengthFromCounts(bp.cmdCount, bucketInstanceCount);
        plan.totalInstanceCount += bucketInstanceCount;
        plan.totalModelInfoLength += bp.modelInfoLength;
    }

    *outPlan = plan;
    return Status::Ok;
}

Status packRuntimeCommandRangesAndModelInfo(
    const RuntimeCommandStreamPlan& plan,
    Span<const i32> cmdOffsets,
    Span<const i32> cmdElements,
    Span<const i32> cmdInstanceCounts,
    Span<const i32> packedInstances,
    Span<i32> outDrawRanges,
    Span<u16> outModelInfoTextureConcat) noexcept {
    if (cmdOffsets.size() != static_cast<std::size_t>(plan.totalCmdCount) ||
        cmdElements.size() != static_cast<std::size_t>(plan.totalCmdCount) ||
        cmdInstanceCounts.size() != static_cast<std::size_t>(plan.totalCmdCount)) {
        return Status::SizeMismatch;
    }
    if (packedInstances.size() !=
        static_cast<std::size_t>(plan.totalInstanceCount * kSceneCommandInstanceStrideInts)) {
        return Status::SizeMismatch;
    }
    if (outDrawRanges.size() != static_cast<std::size_t>(plan.totalCmdCount * 3)) {
        return Status::SizeMismatch;
    }
    if (outModelInfoTextureConcat.size() != static_cast<std::size_t>(plan.totalModelInfoLength)) {
        return Status::SizeMismatch;
    }

    for (i32 bucket = 0; bucket < kSceneCommandBucketCount; bucket++) {
        const RuntimeCommandBucketPlan& bp = plan.buckets[static_cast<std::size_t>(bucket)];

        for (i32 i = 0; i < bp.modelInfoLength; i++) {
            outModelInfoTextureConcat[static_cast<std::size_t>(bp.modelInfoOffset + i)] = 0;
        }

        i32 dataOffset = 0;
        for (i32 i = 0; i < bp.cmdCount; i++) {
            const i32 cmdIndex = bp.cmdStart + i;
            const i32 outDrawOff = cmdIndex * 3;
            outDrawRanges[static_cast<std::size_t>(outDrawOff + 0)] =
                cmdOffsets[static_cast<std::size_t>(cmdIndex)];
            outDrawRanges[static_cast<std::size_t>(outDrawOff + 1)] =
                cmdElements[static_cast<std::size_t>(cmdIndex)];
            outDrawRanges[static_cast<std::size_t>(outDrawOff + 2)] =
                cmdInstanceCounts[static_cast<std::size_t>(cmdIndex)];

            outModelInfoTextureConcat[static_cast<std::size_t>(bp.modelInfoOffset + i * 4)] =
                static_cast<u16>(bp.cmdCount + dataOffset);
            dataOffset += cmdInstanceCounts[static_cast<std::size_t>(cmdIndex)];
        }

        for (i32 i = 0; i < bp.instanceCount; i++) {
            const i32 inOff = (bp.instanceStart + i) * kSceneCommandInstanceStrideInts;
            const i32 sceneX = packedInstances[static_cast<std::size_t>(inOff + 0)];
            const i32 sceneZ = packedInstances[static_cast<std::size_t>(inOff + 1)];
            const i32 heightOffset = packedInstances[static_cast<std::size_t>(inOff + 2)];
            const i32 level = packedInstances[static_cast<std::size_t>(inOff + 3)];
            const i32 contourGround = packedInstances[static_cast<std::size_t>(inOff + 4)];
            const i32 priority = packedInstances[static_cast<std::size_t>(inOff + 5)];
            const i32 interactType = packedInstances[static_cast<std::size_t>(inOff + 6)];
            const i32 interactId = packedInstances[static_cast<std::size_t>(inOff + 7)];

            const i32 outOff = bp.modelInfoOffset + bp.cmdCount * 4 + i * 4;
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 0)] =
                static_cast<u16>(sceneX | (level << 14));
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 1)] =
                static_cast<u16>(sceneZ | (contourGround << 14));
            const i32 packed3 =
                (priority & 0x7) |
                ((interactId >> 16) << 3) |
                (interactType << 4) |
                (roundHeightOffsetDiv8Js(heightOffset) << 6);
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 2)] =
                static_cast<u16>(packed3);
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 3)] =
                static_cast<u16>(interactId);
        }
    }

    return Status::Ok;
}

} // namespace rs
