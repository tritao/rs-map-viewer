#pragma once

#include <cmath>

#include "../types.hpp"

namespace rs {

inline i32 brightenRgb(i32 rgb, float brightness) noexcept {
    float r = static_cast<float>((rgb >> 16) & 0xFF) / 256.0f;
    float g = static_cast<float>((rgb >> 8) & 0xFF) / 256.0f;
    float b = static_cast<float>(rgb & 0xFF) / 256.0f;

    r = std::pow(r, brightness);
    g = std::pow(g, brightness);
    b = std::pow(b, brightness);

    const i32 newR = static_cast<i32>(r * 256.0f);
    const i32 newG = static_cast<i32>(g * 256.0f);
    const i32 newB = static_cast<i32>(b * 256.0f);

    return (newR * 0x10000 + newG * 0x100 + newB);
}

inline i32 packHsl(i32 hue, i32 saturation, i32 lightness) noexcept {
    // Mirrors `src/rs/util/ColorUtil.ts`.
    if (lightness > 179) saturation = static_cast<i32>(saturation / 2);
    if (lightness > 192) saturation = static_cast<i32>(saturation / 2);
    if (lightness > 217) saturation = static_cast<i32>(saturation / 2);
    if (lightness > 243) saturation = static_cast<i32>(saturation / 2);

    const i32 sat = static_cast<i32>(saturation / 32);
    const i32 huePart = static_cast<i32>(hue / 4);
    const i32 lightPart = static_cast<i32>(lightness / 2);
    return (sat << 7) + (huePart << 10) + lightPart;
}

inline i32 rgbToHsl(i32 rgb) noexcept {
    const float r = static_cast<float>((rgb >> 16) & 255) / 256.0f;
    const float g = static_cast<float>((rgb >> 8) & 255) / 256.0f;
    const float b = static_cast<float>(rgb & 255) / 256.0f;

    float minRgb = r;
    if (g < minRgb) minRgb = g;
    if (b < minRgb) minRgb = b;

    float maxRgb = r;
    if (g > maxRgb) maxRgb = g;
    if (b > maxRgb) maxRgb = b;

    float hueTemp = 0.0f;
    float sat = 0.0f;
    const float light = (minRgb + maxRgb) / 2.0f;
    if (minRgb != maxRgb) {
        if (light < 0.5f) {
            sat = (maxRgb - minRgb) / (minRgb + maxRgb);
        } else {
            sat = (maxRgb - minRgb) / (2.0f - maxRgb - minRgb);
        }

        if (maxRgb == r) {
            hueTemp = (g - b) / (maxRgb - minRgb);
        } else if (maxRgb == g) {
            hueTemp = 2.0f + (b - r) / (maxRgb - minRgb);
        } else {
            hueTemp = 4.0f + (r - g) / (maxRgb - minRgb);
        }
    }

    hueTemp /= 6.0f;

    const i32 hue = static_cast<i32>(hueTemp * 256.0f);
    i32 saturation = static_cast<i32>(sat * 256.0f);
    i32 lightness = static_cast<i32>(light * 256.0f);

    if (saturation < 0) saturation = 0;
    else if (saturation > 255) saturation = 255;

    if (lightness < 0) lightness = 0;
    else if (lightness > 255) lightness = 255;

    return packHsl(hue, saturation, lightness);
}

} // namespace rs
