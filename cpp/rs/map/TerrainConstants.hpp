#pragma once

#include "../types.hpp"

namespace rs {

struct TerrainConstants final {
    static constexpr i32 MAX_LEVELS = 4;
    static constexpr i32 MAP_SQUARE_SIZE = 64;

    static constexpr i32 UNITS_LEVEL_HEIGHT = 240;
    static constexpr i32 UNITS_TILE_HEIGHT_BASIS = 8;
};

} // namespace rs

