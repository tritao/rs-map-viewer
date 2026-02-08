#pragma once

#include "../core/Allocator.hpp"
#include "../core/Status.hpp"
#include "../core/Span.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

// Mirrors `src/rs/scene/decodeNpcSpawns.ts` output shape.
struct NpcSpawn final {
    i32 id = -1;
    i32 x = 0;
    i32 y = 0;
    i32 level = 0;
};

// `tileRenderFlagsLevel1` is x-major, flattened: index = x * flagsWidth + y.
// This matches TS where flags are `Uint8Array[]` columns.
Status decodeNpcSpawnsFromBytes(
    Span<const u8> tileRenderFlagsLevel1,
    i32 flagsWidth,
    i32 borderSize,
    i32 mapX,
    i32 mapY,
    Span<const u8> data,
    Vec<NpcSpawn>* out,
    Allocator& alloc) noexcept;

} // namespace rs

