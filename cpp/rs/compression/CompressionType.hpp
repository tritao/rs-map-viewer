#pragma once

#include "../types.hpp"

namespace rs {

enum class CompressionType : u8 {
    None = 0,
    Bzip2 = 1,
    Gzip = 2,
};

} // namespace rs

