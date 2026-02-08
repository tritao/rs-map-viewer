#pragma once

#include <cmath>

#include "../types.hpp"

namespace rs {

// JS ToInt32 semantics (as used by bitwise ops like `|0`, `&`, and by Int32Array stores).
static inline i32 jsToInt32(double x) noexcept {
    if (!std::isfinite(x) || x == 0.0) {
        return 0;
    }
    const double two32 = 4294967296.0; // 2^32
    double t = std::trunc(x);
    double r = std::fmod(t, two32);
    if (r < 0.0) {
        r += two32;
    }
    if (r >= 2147483648.0) { // 2^31
        r -= two32;
    }
    return static_cast<i32>(r);
}

// Fast path for integer intermediates.
static inline i32 jsToInt32(i64 v) noexcept {
    const u64 u = static_cast<u64>(static_cast<u32>(v));
    if (u >= 0x80000000ull) {
        return static_cast<i32>(static_cast<i64>(u) - 0x100000000ll);
    }
    return static_cast<i32>(u);
}

} // namespace rs

