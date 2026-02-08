#pragma once

#include "../types.hpp"

namespace rs {

// Minimal JavaRandom clone used by Jagex cache decode paths.
// Matches TS `util/JavaRandom` + `nextIntJagex` semantics.
class JavaRandom final {
public:
    JavaRandom() = default;
    explicit JavaRandom(u64 seed) noexcept { setSeed(seed); }

    void setSeed(u64 seed) noexcept {
        // (seed ^ 0x5DEECE66D) & ((1<<48)-1)
        seed_ = (seed ^ 0x5DEECE66DULL) & ((1ULL << 48) - 1ULL);
    }

    i32 nextInt() noexcept {
        const u32 v = nextBits(32);
        return static_cast<i32>(v);
    }

private:
    u64 seed_ = 0;

    u32 nextBits(i32 bits) noexcept {
        seed_ = (seed_ * 0x5DEECE66DULL + 0xBULL) & ((1ULL << 48) - 1ULL);
        return static_cast<u32>(seed_ >> (48 - bits));
    }
};

static inline bool isPowerOfTwoI32(i32 v) noexcept {
    return v > 0 && (v & -v) == v;
}

static inline i32 boundJagex(i32 value, i32 bound) noexcept {
    const i32 sign = (value < 0) ? 1 : 0;
    const i32 add = sign ? (bound - 1) : 0;
    // Mirrors JS: (value + (value>>>31)) % bound, where value>>>31 is 1 if negative else 0.
    const i32 mod = (value + sign) % bound;
    return add + mod;
}

static inline i32 nextIntJagex(JavaRandom& random, i32 bound) noexcept {
    if (bound <= 0) {
        return 0;
    }
    if (isPowerOfTwoI32(bound)) {
        const u64 r = static_cast<u32>(random.nextInt());
        return static_cast<i32>((static_cast<u64>(static_cast<u32>(bound)) * r) >> 32);
    }

    const u32 mod = static_cast<u32>((1ULL << 32) % static_cast<u32>(bound));
    const u32 maxU = 0x80000000u - mod;
    const i32 maxValue = static_cast<i32>(maxU);

    i32 rndValue = 0;
    do {
        rndValue = random.nextInt();
    } while (rndValue >= maxValue);

    return boundJagex(rndValue, bound);
}

} // namespace rs

