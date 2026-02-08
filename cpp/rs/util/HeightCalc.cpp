#include "HeightCalc.hpp"

#include <cmath>
#include <cstddef>

#include "../util/JavaInt32.hpp"

namespace rs {

Span<const i32> HeightCalc::cosine65536() noexcept {
    // Mirrors TS `MathConstants.COSINE` (2048 entries, Q16).
    struct Tables final {
        i32 cosine[2048]{};
        Tables() noexcept {
            constexpr double tau = 6.28318530717958647692;
            constexpr double step = tau / 2048.0;
            for (i32 i = 0; i < 2048; i++) {
                const double v = std::cos(static_cast<double>(i) * step);
                cosine[static_cast<std::size_t>(i)] = static_cast<i32>(65536.0 * v);
            }
        }
    };
    static const Tables t{};
    return Span<const i32>(t.cosine, 2048);
}

static inline i32 interpolate(i32 a, i32 b, i32 t, i32 freq) noexcept {
    const Span<const i32> cosine = HeightCalc::cosine65536();
    const i32 cosineIndex = javaIDiv(javaMul(t, 1024), freq);
    const i32 weightB = javaShr(javaSub(65536, cosine[static_cast<std::size_t>(cosineIndex)]), 1);
    const i32 partB = javaShr(javaMul(weightB, b), 16);
    const i32 partA = javaShr(javaMul(javaSub(65536, weightB), a), 16);
    return javaAdd(partB, partA);
}

static inline i32 noise(i32 x, i32 y) noexcept {
    i32 n = javaAdd(javaMul(y, 57), x);
    n = static_cast<i32>((static_cast<u32>(n) << 13u) ^ static_cast<u32>(n));
    const i32 nSq = javaMul(n, n);
    const i32 inner = javaAdd(javaMul(nSq, 15731), 789221);
    const i32 n2 = javaAdd(javaMul(n, inner), 1376312589);
    const u32 masked = static_cast<u32>(n2) & 0x7fffffffu;
    return static_cast<i32>((masked >> 19u) & 0xffu);
}

static inline i32 smoothedNoise1(i32 x, i32 y) noexcept {
    const i32 corners =
        noise(x - 1, y - 1) + noise(x + 1, y - 1) + noise(x - 1, y + 1) + noise(x + 1, y + 1);
    const i32 sides = noise(x - 1, y) + noise(x + 1, y) + noise(x, y - 1) + noise(x, y + 1);
    const i32 center = noise(x, y);
    return javaAdd(javaAdd(javaIDiv(center, 4), javaIDiv(sides, 8)), javaIDiv(corners, 16));
}

static inline i32 interpolateNoise(i32 x, i32 y, i32 freq) noexcept {
    const i32 freqMask = freq - 1;
    const i32 intX = javaIDiv(x, freq);
    const i32 fracX = x & freqMask;
    const i32 intY = javaIDiv(y, freq);
    const i32 fracY = y & freqMask;
    const i32 v1 = smoothedNoise1(intX, intY);
    const i32 v2 = smoothedNoise1(intX + 1, intY);
    const i32 v3 = smoothedNoise1(intX, intY + 1);
    const i32 v4 = smoothedNoise1(intX + 1, intY + 1);
    const i32 i1 = interpolate(v1, v2, fracX, freq);
    const i32 i2 = interpolate(v3, v4, fracX, freq);
    return interpolate(i1, i2, fracY, freq);
}

i32 HeightCalc::generateHeight(i32 x, i32 y) noexcept {
    const i32 a = javaSub(interpolateNoise(javaAdd(x, 45365), javaAdd(y, 91923), 4), 128);
    const i32 b = javaShr(javaSub(interpolateNoise(javaAdd(x, 10294), javaAdd(y, 37821), 2), 128), 1);
    const i32 c = javaShr(javaSub(interpolateNoise(x, y, 1), 128), 2);
    i32 n = javaAdd(javaAdd(a, b), c);

    const double nScaled = 0.3 * static_cast<double>(n);
    n = static_cast<i32>(nScaled) + 35;

    if (n < 10) {
        n = 10;
    } else if (n > 60) {
        n = 60;
    }
    return n;
}

} // namespace rs

