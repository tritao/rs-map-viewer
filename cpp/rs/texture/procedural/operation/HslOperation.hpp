#pragma once

#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class HslOperation final : public TextureOperationImpl<HslOperation> {
public:
    HslOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            i16 v = 0;
            const Status s = reader.readShort(&v);
            if (!ok(s)) {
                return s;
            }
            deltaHue_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            deltaSaturationQ12_ = (static_cast<i32>(v) << 12) / 100;
            return Status::Ok;
        }
        if (fieldId == 2) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            deltaLightnessQ12_ = (static_cast<i32>(v) << 12) / 100;
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status getColourOutput(TextureGenerator& textureGenerator, i32 line, ColourLine* out) noexcept override {
        if (!out) {
            return Status::InvalidArgument;
        }
        ColourLine lineOut = colourCache().get(line);
        if (lineOut.r.size() == 0) {
            *out = lineOut;
            return Status::OutOfRange;
        }
        if (colourCache().dirty()) {
            ColourLine input{};
            Status s = getColourInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }

            const std::size_t w = lineOut.r.size();
            for (std::size_t i = 0; i < w; i++) {
                const i32 r = input.r[i];
                const i32 g = input.g[i];
                const i32 b = input.b[i];

                i32 hue = 0;
                i32 saturation = 0;
                i32 lightness = 0;
                toHslQ12(r, g, b, &hue, &saturation, &lightness);

                hue += deltaHue_;
                saturation += deltaSaturationQ12_;
                lightness += deltaLightnessQ12_;

                while (hue < 0) {
                    hue += 4096;
                }
                while (hue > 4096) {
                    hue -= 4096;
                }
                if (saturation < 0) {
                    saturation = 0;
                }
                if (saturation > 4096) {
                    saturation = 4096;
                }
                if (lightness < 0) {
                    lightness = 0;
                }
                if (lightness > 4096) {
                    lightness = 4096;
                }

                // Java/TS behaviour: if hue==4096 then hueSector==6 and the operation does not
                // update RGB (reuses previous pixel's values).
                i32 outR = rgbR_;
                i32 outG = rgbG_;
                i32 outB = rgbB_;
                const bool updated = toRgbQ12MaybeUpdate(hue, saturation, lightness, &outR, &outG, &outB);
                if (updated) {
                    rgbR_ = outR;
                    rgbG_ = outG;
                    rgbB_ = outB;
                }
                lineOut.r[i] = rgbR_;
                lineOut.g[i] = rgbG_;
                lineOut.b[i] = rgbB_;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 deltaHue_ = 0;
    i32 deltaSaturationQ12_ = 0;
    i32 deltaLightnessQ12_ = 0;
    i32 rgbR_ = 0;
    i32 rgbG_ = 0;
    i32 rgbB_ = 0;

    static inline i32 max3(i32 a, i32 b, i32 c) noexcept {
        const i32 ab = (a > b) ? a : b;
        return (ab > c) ? ab : c;
    }

    static inline i32 min3(i32 a, i32 b, i32 c) noexcept {
        const i32 ab = (a < b) ? a : b;
        return (ab < c) ? ab : c;
    }

    static void toHslQ12(i32 r, i32 g, i32 b, i32* outHue, i32* outSat, i32* outLight) noexcept {
        if (!outHue || !outSat || !outLight) {
            return;
        }
        const i32 maxValue = max3(r, g, b);
        const i32 minValue = min3(r, g, b);
        const i32 delta = maxValue - minValue;

        const i32 lightness = (maxValue + minValue) / 2;
        i32 hue = 0;
        i32 saturation = 0;

        if (delta > 0) {
            const i32 invR = ((maxValue - r) << 12) / delta;
            const i32 invG = ((maxValue - g) << 12) / delta;
            const i32 invB = ((maxValue - b) << 12) / delta;

            if (r == maxValue) {
                hue = (g == minValue) ? (invB + 0x5000) : (4096 - invG);
            } else if (g == maxValue) {
                hue = (b == minValue) ? (invR + 4096) : (0x3000 - invB);
            } else {
                hue = (minValue == r) ? (invG + 0x3000) : (0x5000 - invR);
            }
            hue /= 6;
        } else {
            hue = 0;
        }

        if (lightness > 0 && lightness < 4096) {
            const i32 denom = (lightness > 2048) ? (8192 - lightness * 2) : (lightness * 2);
            saturation = (delta << 12) / denom;
        } else {
            saturation = 0;
        }

        *outHue = hue;
        *outSat = saturation;
        *outLight = lightness;
    }

    static bool toRgbQ12MaybeUpdate(
        i32 hue, i32 saturation, i32 lightness, i32* outR, i32* outG, i32* outB) noexcept {
        if (!outR || !outG || !outB) {
            return false;
        }
        const i32 q =
            (lightness > 2048)
                ? javaSub(javaAdd(saturation, lightness), javaMulShift(saturation, lightness, 12))
                : javaMulShift(lightness, javaAdd(4096, saturation), 12);

        if (q <= 0) {
            *outR = lightness;
            *outG = lightness;
            *outB = lightness;
            return true;
        }

        const i32 p = lightness - q + lightness;
        const i32 qMinusPOverQQ12 = ((q - p) << 12) / q;

        const i32 hue6Q12 = hue * 6;
        const i32 hueSector = hue6Q12 >> 12;
        const i32 hueFracQ12 = hue6Q12 - (hueSector << 12);
        if (hueSector < 0 || hueSector > 5) {
            return false;
        }

        i32 deltaQ12 = q;
        deltaQ12 = javaMulShift(deltaQ12, qMinusPOverQQ12, 12);
        deltaQ12 = javaMulShift(hueFracQ12, deltaQ12, 12);

        const i32 pPlusDelta = javaAdd(p, deltaQ12);
        const i32 qMinusDelta = javaSub(q, deltaQ12);

        switch (hueSector) {
        case 0:
            *outR = q;
            *outG = pPlusDelta;
            *outB = p;
            return true;
        case 1:
            *outR = qMinusDelta;
            *outG = q;
            *outB = p;
            return true;
        case 2:
            *outR = p;
            *outG = q;
            *outB = pPlusDelta;
            return true;
        case 3:
            *outR = p;
            *outG = qMinusDelta;
            *outB = q;
            return true;
        case 4:
            *outR = pPlusDelta;
            *outG = p;
            *outB = q;
            return true;
        default:
            *outR = q;
            *outG = p;
            *outB = qMinusDelta;
            return true;
        }
    }
};

} // namespace rs
