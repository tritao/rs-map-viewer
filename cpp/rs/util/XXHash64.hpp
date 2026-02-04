#pragma once

#include <cstddef>

#include "../types.hpp"

namespace rs {

[[nodiscard]] u64 xxh64(const void* data, std::size_t len);

} // namespace rs
