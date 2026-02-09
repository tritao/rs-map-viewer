#pragma once

#include "../../types.hpp"

namespace rs {

// Mirrors src/rs/model/seq/SeqTransformType.ts
enum class SeqTransformType : i32 {
    ORIGIN = 0,
    TRANSLATE = 1,
    ROTATE = 2,
    SCALE = 3,
    ALPHA = 5,
    TYPE_6 = 6,
    LIGHT = 7,
    TYPE_10 = 10,
};

} // namespace rs
