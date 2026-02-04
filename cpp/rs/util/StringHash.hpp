#pragma once

#include <cstddef>

#include "../types.hpp"
#include "U32.hpp"

namespace rs {

// DJB2-style hash used by RuneScape cache naming (variant with initial hash = 0).
// 32-bit signed wrap semantics.
inline i32 hashDjb2(const char* s) noexcept {
    if (!s) {
        return 0;
    }
    u32 h = 0;
    for (const unsigned char* p = reinterpret_cast<const unsigned char*>(s); *p != 0; ++p) {
        h = toU32(static_cast<u64>(h) * 31u + static_cast<u32>(*p));
    }
    return toI32(h);
}

inline i32 hashDjb2(const char* s, std::size_t len) noexcept {
    if (!s) {
        return 0;
    }
    u32 h = 0;
    const unsigned char* p = reinterpret_cast<const unsigned char*>(s);
    for (std::size_t i = 0; i < len; i++) {
        h = toU32(static_cast<u64>(h) * 31u + static_cast<u32>(p[i]));
    }
    return toI32(h);
}

} // namespace rs
