#pragma once

#include <cstddef>
#include <string>

#include "../types.hpp"

namespace rs {

[[nodiscard]] u64 xxh64(const void* data, std::size_t len);
[[nodiscard]] std::string h64Hex(u64 v);

} // namespace rs

