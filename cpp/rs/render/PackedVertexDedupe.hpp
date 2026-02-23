#pragma once

#include "../core/Allocator.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

Status dedupePackedVerticesAndRemapIndices(
    Vec<u8>* vertices,
    Vec<i32>* indices,
    Allocator& alloc) noexcept;

} // namespace rs
