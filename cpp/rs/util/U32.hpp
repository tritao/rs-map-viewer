#pragma once

#include <cstdint>

#include "../types.hpp"

namespace rs {

[[nodiscard]] inline u32 toU32(std::uint64_t v) { return static_cast<u32>(v & 0xFFFFFFFFu); }
[[nodiscard]] inline i32 toI32(std::uint64_t v) { return static_cast<i32>(static_cast<u32>(v & 0xFFFFFFFFu)); }

[[nodiscard]] inline u32 addU32(u32 a, u32 b) { return static_cast<u32>(a + b); }
[[nodiscard]] inline u32 subU32(u32 a, u32 b) { return static_cast<u32>(a - b); }
[[nodiscard]] inline u32 mulU32(u32 a, u32 b) { return static_cast<u32>(a * b); }

} // namespace rs

