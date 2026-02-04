#pragma once

#include <cstddef>

#include "../types.hpp"

namespace rs {

[[nodiscard]] inline u16 readU16BE(const u8* p) {
    return static_cast<u16>((static_cast<u16>(p[0]) << 8) | static_cast<u16>(p[1]));
}

[[nodiscard]] inline u32 readU24BE(const u8* p) {
    return (static_cast<u32>(p[0]) << 16) | (static_cast<u32>(p[1]) << 8) | static_cast<u32>(p[2]);
}

[[nodiscard]] inline u32 readU32BE(const u8* p) {
    return (static_cast<u32>(p[0]) << 24) | (static_cast<u32>(p[1]) << 16) | (static_cast<u32>(p[2]) << 8) |
           static_cast<u32>(p[3]);
}

[[nodiscard]] inline i32 readI32BE(const u8* p) {
    return static_cast<i32>(readU32BE(p));
}

inline void writeU16BE(u8* p, u16 v) {
    p[0] = static_cast<u8>((v >> 8) & 0xFFu);
    p[1] = static_cast<u8>(v & 0xFFu);
}

inline void writeU24BE(u8* p, u32 v) {
    p[0] = static_cast<u8>((v >> 16) & 0xFFu);
    p[1] = static_cast<u8>((v >> 8) & 0xFFu);
    p[2] = static_cast<u8>(v & 0xFFu);
}

inline void writeU32BE(u8* p, u32 v) {
    p[0] = static_cast<u8>((v >> 24) & 0xFFu);
    p[1] = static_cast<u8>((v >> 16) & 0xFFu);
    p[2] = static_cast<u8>((v >> 8) & 0xFFu);
    p[3] = static_cast<u8>(v & 0xFFu);
}

} // namespace rs

