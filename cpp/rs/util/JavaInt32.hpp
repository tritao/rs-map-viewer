#pragma once

#include <limits>

#include "../types.hpp"

namespace rs {

// Helpers to mirror Java `int` (32-bit signed) arithmetic semantics in C++.
//
// Key points:
// - Java `int` operations wrap modulo 2^32 (two's complement).
// - Shifts mask the shift amount with 31.
// - Division truncates toward zero; INT_MIN / -1 overflows back to INT_MIN in Java.

static inline i32 javaAdd(i32 a, i32 b) noexcept {
    return static_cast<i32>(static_cast<u32>(a) + static_cast<u32>(b));
}

static inline i32 javaSub(i32 a, i32 b) noexcept {
    return static_cast<i32>(static_cast<u32>(a) - static_cast<u32>(b));
}

static inline i32 javaMul(i32 a, i32 b) noexcept {
    return static_cast<i32>(static_cast<u32>(a) * static_cast<u32>(b));
}

static inline i32 javaShl(i32 a, i32 bits) noexcept {
    return static_cast<i32>(static_cast<u32>(a) << (static_cast<u32>(bits) & 31u));
}

static inline i32 javaShr(i32 a, i32 bits) noexcept {
    return static_cast<i32>(a >> (static_cast<u32>(bits) & 31u));
}

static inline u32 javaUshr(i32 a, i32 bits) noexcept {
    return static_cast<u32>(a) >> (static_cast<u32>(bits) & 31u);
}

static inline i32 javaAbs(i32 v) noexcept {
    const i32 minV = std::numeric_limits<i32>::min();
    if (v == minV) {
        // Matches Java: Math.abs(Integer.MIN_VALUE) == Integer.MIN_VALUE.
        return minV;
    }
    return (v < 0) ? -v : v;
}

static inline i32 javaIDiv(i32 a, i32 b) noexcept {
    // Java would throw on division by 0; call sites should guard.
    if (b == 0) {
        return 0;
    }
    const i32 minV = std::numeric_limits<i32>::min();
    if (a == minV && b == -1) {
        return minV;
    }
    return static_cast<i32>(a / b);
}

static inline i32 javaMulShift(i32 a, i32 b, i32 shift) noexcept {
    return javaShr(javaMul(a, b), shift);
}

static inline i32 javaMulQ12(i32 a, i32 b) noexcept {
    return javaMulShift(a, b, 12);
}

static inline i32 javaDivQ12(i32 a, i32 b) noexcept {
    return javaIDiv(javaShl(a, 12), b);
}

} // namespace rs

