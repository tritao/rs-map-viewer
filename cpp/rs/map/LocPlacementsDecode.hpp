#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

// Mirrors `src/rs/scene/decodeLocPlacements.ts` output shape.
struct LocPlacement final {
    i32 id = -1;
    i32 level = 0;
    i32 localX = 0;
    i32 localY = 0;
    i32 type = 0;
    i32 rotation = 0;
};

Status decodeLocPlacementsFromBytes(Span<const u8> data, Vec<LocPlacement>* out, Allocator& alloc) noexcept;

} // namespace rs

