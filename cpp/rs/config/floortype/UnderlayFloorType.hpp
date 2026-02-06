#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"

namespace rs {

struct UnderlayFloorType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 rgbColor = 0;

    i32 hue = 0;
    i32 saturation = 0;
    i32 lightness = 0;
    i32 hueMultiplier = 0;

    bool isOverlay = false;

    i32 textureId = -1;
    i32 textureSize = 128;
    bool blockShadow = true;

    UnderlayFloorType() = default;
    UnderlayFloorType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept {
        if (opcode == 1) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            rgbColor = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            textureId = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 3) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            textureSize = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 4) {
            blockShadow = false;
            return Status::Ok;
        }
        if (opcode == 5) {
            // noop (kept for parity with TS)
            return Status::Ok;
        }
        return Status::Unsupported;
    }

    void post() noexcept {
        setHsl(rgbColor);
    }

    void setHsl(i32 rgb) noexcept {
        const double r = static_cast<double>((rgb >> 16) & 0xFF) / 256.0;
        const double g = static_cast<double>((rgb >> 8) & 0xFF) / 256.0;
        const double b = static_cast<double>(rgb & 0xFF) / 256.0;

        double minRgb = r;
        if (g < minRgb) {
            minRgb = g;
        }
        if (b < minRgb) {
            minRgb = b;
        }

        double maxRgb = r;
        if (g > maxRgb) {
            maxRgb = g;
        }
        if (b > maxRgb) {
            maxRgb = b;
        }

        double hueTemp = 0.0;
        double sat = 0.0;
        const double light = (maxRgb + minRgb) / 2.0;

        if (maxRgb != minRgb) {
            if (light < 0.5) {
                sat = (maxRgb - minRgb) / (maxRgb + minRgb);
            } else {
                sat = (maxRgb - minRgb) / (2.0 - maxRgb - minRgb);
            }

            if (maxRgb == r) {
                hueTemp = (g - b) / (maxRgb - minRgb);
            } else if (maxRgb == g) {
                hueTemp = 2.0 + (b - r) / (maxRgb - minRgb);
            } else {
                hueTemp = 4.0 + (r - g) / (maxRgb - minRgb);
            }
        }

        hueTemp /= 6.0;

        saturation = static_cast<i32>(sat * 256.0);
        lightness = static_cast<i32>(light * 256.0);
        if (saturation < 0) {
            saturation = 0;
        } else if (saturation > 255) {
            saturation = 255;
        }
        if (lightness < 0) {
            lightness = 0;
        } else if (lightness > 255) {
            lightness = 255;
        }

        if (light > 0.5) {
            hueMultiplier = static_cast<i32>(512.0 * (sat * (1.0 - light)));
        } else {
            hueMultiplier = static_cast<i32>(512.0 * (sat * light));
        }
        if (hueMultiplier < 1) {
            hueMultiplier = 1;
        }
        hue = static_cast<i32>(static_cast<double>(hueMultiplier) * hueTemp);
    }
};

} // namespace rs

