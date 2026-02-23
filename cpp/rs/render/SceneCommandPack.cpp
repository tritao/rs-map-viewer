#include "SceneCommandPack.hpp"

#include "../core/Vec.hpp"

namespace rs {

Status packRuntimeInputFromCommandStream(
    Span<const i32> cmdBucketIndices,
    Span<const i32> cmdOffsets,
    Span<const i32> cmdElements,
    Span<const i32> cmdInstanceCounts,
    Span<const i32> cmdPackedInstances,
    Span<i32> outBucketCmdCounts,
    Span<i32> outCmdOffsets,
    Span<i32> outCmdElements,
    Span<i32> outCmdInstanceCounts,
    Span<i32> outPackedInstances,
    Allocator& alloc) noexcept {
    const i32 totalCmdCount = static_cast<i32>(cmdBucketIndices.size());
    if (cmdOffsets.size() != cmdBucketIndices.size() ||
        cmdElements.size() != cmdBucketIndices.size() ||
        cmdInstanceCounts.size() != cmdBucketIndices.size()) {
        return Status::SizeMismatch;
    }
    if (outBucketCmdCounts.size() != static_cast<std::size_t>(kSceneCommandBucketCount)) {
        return Status::SizeMismatch;
    }
    if (outCmdOffsets.size() != cmdBucketIndices.size() ||
        outCmdElements.size() != cmdBucketIndices.size() ||
        outCmdInstanceCounts.size() != cmdBucketIndices.size()) {
        return Status::SizeMismatch;
    }

    Vec<i32> cmdInstanceStarts(alloc);
    auto startsResize = cmdInstanceStarts.resize(static_cast<std::size_t>(totalCmdCount));
    if (!startsResize.isOk()) {
        return startsResize.status();
    }

    i32 totalInstances = 0;
    for (i32 i = 0; i < totalCmdCount; i++) {
        const i32 bucket = cmdBucketIndices[static_cast<std::size_t>(i)];
        if (bucket < 0 || bucket >= kSceneCommandBucketCount) {
            return Status::OutOfRange;
        }
        const i32 instanceCount = cmdInstanceCounts[static_cast<std::size_t>(i)];
        if (instanceCount < 0) {
            return Status::InvalidArgument;
        }
        cmdInstanceStarts[static_cast<std::size_t>(i)] = totalInstances;
        totalInstances += instanceCount;
    }

    const i32 expectedPackedInstancesLength = totalInstances * kSceneCommandInstanceStrideInts;
    if (cmdPackedInstances.size() != static_cast<std::size_t>(expectedPackedInstancesLength) ||
        outPackedInstances.size() != static_cast<std::size_t>(expectedPackedInstancesLength)) {
        return Status::SizeMismatch;
    }

    for (i32 bucket = 0; bucket < kSceneCommandBucketCount; bucket++) {
        outBucketCmdCounts[static_cast<std::size_t>(bucket)] = 0;
    }
    for (i32 i = 0; i < totalCmdCount; i++) {
        const i32 bucket = cmdBucketIndices[static_cast<std::size_t>(i)];
        outBucketCmdCounts[static_cast<std::size_t>(bucket)]++;
    }

    i32 outCmdCursor = 0;
    i32 outInstanceCursor = 0;
    for (i32 bucket = 0; bucket < kSceneCommandBucketCount; bucket++) {
        for (i32 i = 0; i < totalCmdCount; i++) {
            if (cmdBucketIndices[static_cast<std::size_t>(i)] != bucket) {
                continue;
            }

            const i32 instanceCount = cmdInstanceCounts[static_cast<std::size_t>(i)];
            outCmdOffsets[static_cast<std::size_t>(outCmdCursor)] =
                cmdOffsets[static_cast<std::size_t>(i)];
            outCmdElements[static_cast<std::size_t>(outCmdCursor)] =
                cmdElements[static_cast<std::size_t>(i)];
            outCmdInstanceCounts[static_cast<std::size_t>(outCmdCursor)] = instanceCount;
            outCmdCursor++;

            const i32 inInstanceOff =
                cmdInstanceStarts[static_cast<std::size_t>(i)] * kSceneCommandInstanceStrideInts;
            const i32 outInstanceOff = outInstanceCursor * kSceneCommandInstanceStrideInts;
            const i32 copyLength = instanceCount * kSceneCommandInstanceStrideInts;
            for (i32 j = 0; j < copyLength; j++) {
                outPackedInstances[static_cast<std::size_t>(outInstanceOff + j)] =
                    cmdPackedInstances[static_cast<std::size_t>(inInstanceOff + j)];
            }
            outInstanceCursor += instanceCount;
        }
    }

    if (outCmdCursor != totalCmdCount || outInstanceCursor != totalInstances) {
        return Status::InvalidArgument;
    }

    return Status::Ok;
}

} // namespace rs
