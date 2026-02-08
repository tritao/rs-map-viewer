#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../cache/CacheType.hpp"
#include "../../core/Status.hpp"
#include "../../core/Str.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../util/ColorUtil.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct OverlayFloorType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 primaryRgb = 0;

    i32 textureId = -1;
    i32 secondaryTextureId = -1;

    bool hideUnderlay = true;

    i32 secondaryRgb = -1;
    i32 blendRgb = -1;

    i32 primaryHsl = -1;
    i32 blendHsl = -1;

    bool occludes = true;

    i32 hue = 0;
    i32 saturation = 0;
    i32 lightness = 0;

    i32 hueBlend = 0;
    i32 hueMultiplier = 0;

    i32 secondaryHue = 0;
    i32 secondarySaturation = 0;
    i32 secondaryLightness = 0;

    i32 textureSize = 128;
    bool blockShadow = true;
    i32 textureBrightness = 8;

    i32 blendPriority = 8;
    bool blendable = false;

    i32 underwaterColor = 0x122b3d;
    i32 waterOpacity = 16;
    i32 waterBias = 127;

    bool isOverlay = false;
    Str name{};

    OverlayFloorType() = default;
    OverlayFloorType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {
        isOverlay = cacheInfo.game != GameType::Runescape || cacheInfo.revision > 377;
        if (cacheInfo.game == GameType::Runescape) {
            hideUnderlay = false;
        }
    }

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (opcode == 1) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            primaryRgb = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            textureId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 3) {
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision <= 377) {
                isOverlay = true;
                return Status::Ok;
            }
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            textureId = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 5) {
            if (cacheInfo.game != GameType::Runescape) {
                hideUnderlay = false;
            } else {
                occludes = false;
            }
            return Status::Ok;
        }
        if (opcode == 6) {
            const u8 terminator = configStringTerminator(cacheInfo);
            if (!ctx.strings) {
                return skipString(reader, terminator);
            }
            return readArenaString(reader, terminator, *ctx.strings, &name);
        }
        if (opcode == 7) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            if (cacheInfo.game == GameType::Runescape) {
                blendRgb = static_cast<i32>(v);
            } else {
                secondaryRgb = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 8) {
            return Status::Ok;
        }
        if (opcode == 9) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            textureSize = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 10) {
            blockShadow = false;
            return Status::Ok;
        }
        if (opcode == 11) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 667) {
                blendPriority = static_cast<i32>(v);
            } else {
                textureBrightness = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 12) {
            blendable = true;
            return Status::Ok;
        }
        if (opcode == 13) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            underwaterColor = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 14) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            waterOpacity = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 15) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            secondaryTextureId = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 16) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            waterBias = static_cast<i32>(v);
            return Status::Ok;
        }
        return Status::Unsupported;
    }

    void post() noexcept {
        if (secondaryRgb != -1) {
            setHsl(secondaryRgb);
            secondaryHue = hue;
            secondarySaturation = saturation;
            secondaryLightness = lightness;
        }

        if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 667) {
            blendPriority = (blendPriority << 8) | id;
        }

        setHsl(primaryRgb);

        primaryHsl = (primaryRgb == 0xFF00FF) ? -2 : rgbToHsl(primaryRgb);
        if (blendRgb == -1) {
            blendHsl = -1;
        } else if (blendRgb == 0xFF00FF) {
            blendHsl = -2;
        } else {
            blendHsl = rgbToHsl(blendRgb);
        }
    }

    void setHsl(i32 rgb) noexcept {
        const double r = static_cast<double>((rgb >> 16) & 0xFF) / 256.0;
        const double g = static_cast<double>((rgb >> 8) & 0xFF) / 256.0;
        const double b = static_cast<double>(rgb & 0xFF) / 256.0;

        double minRgb = r;
        if (g < r) {
            minRgb = g;
        }
        if (b < minRgb) {
            minRgb = b;
        }

        double maxRgb = r;
        if (g > r) {
            maxRgb = g;
        }
        if (b > maxRgb) {
            maxRgb = b;
        }

        double hueTemp = 0.0;
        double sat = 0.0;
        const double light = (minRgb + maxRgb) / 2.0;
        if (minRgb != maxRgb) {
            if (light < 0.5) {
                sat = (maxRgb - minRgb) / (minRgb + maxRgb);
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
        hue = static_cast<i32>(hueTemp * 256.0);
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

        // Mirrors TS behavior: hueBlend is hue, hueMultiplier matches the classic scaling.
        if (light > 0.5) {
            hueMultiplier = static_cast<i32>(512.0 * (sat * (1.0 - light)));
        } else {
            hueMultiplier = static_cast<i32>(512.0 * (sat * light));
        }
        if (hueMultiplier < 1) {
            hueMultiplier = 1;
        }
        hueBlend = static_cast<i32>(static_cast<double>(hueMultiplier) * hueTemp);
    }
};

} // namespace rs
