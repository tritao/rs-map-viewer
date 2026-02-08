#pragma once

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "TerrainSquare.hpp"

namespace rs {

// Port of `src/rs/scene/decodeTerrainSquare.ts` (decode-only, no scene/collision side effects).
Status decodeTerrainSquareFromBytesInto(
    TerrainSquare& out,
    Span<const u8> data,
    bool newTerrainFormat,
    i32 worldTileX0,
    i32 worldTileY0
) noexcept;

} // namespace rs

