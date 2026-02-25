#pragma once

#include "../core/Allocator.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "RuntimeCommandStreamPlan.hpp"

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
    Allocator& alloc = defaultAllocator()) noexcept;

} // namespace rs
