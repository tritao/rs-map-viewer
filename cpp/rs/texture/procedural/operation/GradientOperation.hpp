#pragma once

#include <cstddef>

#include "../../../core/Allocator.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class GradientOperation final : public TextureOperationImpl<GradientOperation> {
public:
    GradientOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        if (fieldId != 0) {
            return Status::Ok;
        }
        u8 presetId = 0;
        Status s = reader.readUnsignedByte(&presetId);
        if (!ok(s)) {
            return s;
        }

        if (presetId == 0) {
            u8 stopCountU8 = 0;
            s = reader.readUnsignedByte(&stopCountU8);
            if (!ok(s)) {
                return s;
            }
            const i32 stopCount = static_cast<i32>(stopCountU8);
            if (stopCount <= 0) {
                stops_.clear();
                return Status::Ok;
            }
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(static_cast<std::size_t>(stopCount));
            if (!rr.isOk()) {
                return rr.status();
            }
            for (i32 i = 0; i < stopCount; i++) {
                u16 pos = 0;
                u8 r = 0;
                u8 g = 0;
                u8 b = 0;
                s = reader.readUnsignedShort(&pos);
                if (!ok(s)) return s;
                s = reader.readUnsignedByte(&r);
                if (!ok(s)) return s;
                s = reader.readUnsignedByte(&g);
                if (!ok(s)) return s;
                s = reader.readUnsignedByte(&b);
                if (!ok(s)) return s;
                stops_[static_cast<std::size_t>(i)] = Stop{static_cast<i32>(pos), static_cast<i32>(r) << 4, static_cast<i32>(g) << 4, static_cast<i32>(b) << 4};
            }
            return Status::Ok;
        }

        presetId_ = static_cast<i32>(presetId);
        return setGradientPreset(presetId_, alloc);
    }

    Status init() noexcept override {
        if (stops_.size() == 0) {
            // Default preset: black -> white.
            for (i32 i = 0; i < 257; i++) {
                const i32 c = (i > 255) ? 255 : i;
                rgbLookup_[static_cast<std::size_t>(i)] = (c << 16) | (c << 8) | c;
            }
            return Status::Ok;
        }
        buildLookupTable();
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
            Span<i32> input;
            Status s = getMonochromeInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                i32 idx = input[i] >> 4;
                if (idx < 0) idx = 0;
                if (idx > 256) idx = 256;
                const i32 rgb = rgbLookup_[static_cast<std::size_t>(idx)];
                lineOut.r[i] = (rgb & 0xFF0000) >> 12;
                lineOut.g[i] = (rgb & 0xFF00) >> 4;
                lineOut.b[i] = (rgb & 0xFF) << 4;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    struct Stop final {
        i32 posQ12 = 0;
        i32 rQ12 = 0;
        i32 gQ12 = 0;
        i32 bQ12 = 0;
    };

    i32 presetId_ = 0;
    Vec<Stop> stops_{};
    i32 rgbLookup_[257]{};

    static inline i32 clampI32(i32 v, i32 lo, i32 hi) noexcept {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }

    void buildLookupTable() noexcept {
        if (stops_.size() == 0) {
            return;
        }

        const i32 stopCount = static_cast<i32>(stops_.size());
        for (i32 i = 0; i < 257; i++) {
            const i32 posQ12 = i << 4;
            i32 stopIndex = 0;
            for (std::size_t si = 0; si < stops_.size(); si++) {
                if (stops_[si].posQ12 > posQ12) {
                    break;
                }
                stopIndex++;
            }

            i32 r = 0;
            i32 g = 0;
            i32 b = 0;

            if (stopIndex < stopCount) {
                const Stop stopN = stops_[static_cast<std::size_t>(stopIndex)];
                if (stopIndex > 0) {
                    const Stop stopP = stops_[static_cast<std::size_t>(stopIndex - 1)];
                    const i32 denom = stopN.posQ12 - stopP.posQ12;
                    const i32 nMod = denom != 0 ? javaIDiv(javaShl(posQ12 - stopP.posQ12, 12), denom) : 0;
                    const i32 pMod = javaSub(4096, nMod);
                    r = javaShr(javaAdd(javaMul(stopP.rQ12, pMod), javaMul(stopN.rQ12, nMod)), 12);
                    g = javaShr(javaAdd(javaMul(stopP.gQ12, pMod), javaMul(stopN.gQ12, nMod)), 12);
                    b = javaShr(javaAdd(javaMul(stopN.bQ12, nMod), javaMul(stopP.bQ12, pMod)), 12);
                } else {
                    r = stopN.rQ12;
                    g = stopN.gQ12;
                    b = stopN.bQ12;
                }
            } else {
                const Stop stop = stops_[stops_.size() - 1];
                r = stop.rQ12;
                g = stop.gQ12;
                b = stop.bQ12;
            }

            r >>= 4;
            g >>= 4;
            b >>= 4;
            r = clampI32(r, 0, 255);
            g = clampI32(g, 0, 255);
            b = clampI32(b, 0, 255);
            rgbLookup_[static_cast<std::size_t>(i)] = r * 0x10000 + g * 0x100 + b;
        }
    }

    Status setGradientPreset(i32 preset, Allocator& alloc) noexcept {
        presetId_ = preset;
        // Fill `stops_` with Q12 values (posQ12, rQ12, gQ12, bQ12).
        // Mirrors `GradientOperation.setGradientPreset` in TS.
        switch (preset) {
        case 1: {
            stops_.clear();
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(2);
            if (!rr.isOk()) return rr.status();
            stops_[0] = Stop{0, 0, 0, 0};
            stops_[1] = Stop{4096, 4096, 4096, 4096};
            return Status::Ok;
        }
        case 2: {
            stops_.clear();
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(8);
            if (!rr.isOk()) return rr.status();
            stops_[0] = Stop{0, 2650, 2602, 2361};
            stops_[1] = Stop{2867, 2313, 1799, 1558};
            stops_[2] = Stop{3072, 2618, 1734, 1413};
            stops_[3] = Stop{3276, 2296, 1220, 947};
            stops_[4] = Stop{3481, 2072, 963, 722};
            stops_[5] = Stop{3686, 2730, 2152, 1766};
            stops_[6] = Stop{3891, 2232, 1060, 915};
            stops_[7] = Stop{4096, 1686, 1413, 1140};
            return Status::Ok;
        }
        case 3: {
            stops_.clear();
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(7);
            if (!rr.isOk()) return rr.status();
            stops_[0] = Stop{0, 0, 0, 4096};
            stops_[1] = Stop{663, 0, 4096, 4096};
            stops_[2] = Stop{1363, 0, 4096, 0};
            stops_[3] = Stop{2048, 4096, 4096, 0};
            stops_[4] = Stop{2727, 4096, 0, 0};
            stops_[5] = Stop{3411, 4096, 0, 4096};
            stops_[6] = Stop{4096, 0, 0, 4096};
            return Status::Ok;
        }
        case 4: {
            stops_.clear();
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(6);
            if (!rr.isOk()) return rr.status();
            stops_[0] = Stop{0, 0, 0, 0};
            stops_[1] = Stop{1843, 0, 0, 1493};
            stops_[2] = Stop{2457, 0, 0, 2939};
            stops_[3] = Stop{2781, 0, 1124, 3565};
            stops_[4] = Stop{3481, 546, 3084, 4031};
            stops_[5] = Stop{4096, 4096, 4096, 4096};
            return Status::Ok;
        }
        case 5: {
            stops_.clear();
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(16);
            if (!rr.isOk()) return rr.status();
            stops_[0] = Stop{0, 80, 192, 321};
            stops_[1] = Stop{155, 321, 449, 562};
            stops_[2] = Stop{389, 578, 690, 803};
            stops_[3] = Stop{671, 947, 995, 1140};
            stops_[4] = Stop{897, 1285, 1397, 1509};
            stops_[5] = Stop{1175, 1525, 1429, 1413};
            stops_[6] = Stop{1368, 1734, 1461, 1333};
            stops_[7] = Stop{1507, 1413, 1525, 1702};
            stops_[8] = Stop{1736, 1108, 1590, 2056};
            stops_[9] = Stop{2088, 1766, 2056, 2666};
            stops_[10] = Stop{2355, 2409, 2586, 3276};
            stops_[11] = Stop{2691, 3116, 3148, 3228};
            stops_[12] = Stop{3031, 3806, 3710, 3196};
            stops_[13] = Stop{3522, 3437, 3421, 3019};
            stops_[14] = Stop{3727, 3116, 3148, 3228};
            stops_[15] = Stop{4096, 2377, 2505, 2746};
            return Status::Ok;
        }
        case 6: {
            stops_.clear();
            stops_ = Vec<Stop>(alloc);
            auto rr = stops_.resize(4);
            if (!rr.isOk()) return rr.status();
            stops_[0] = Stop{2048, 0, 4096, 0};
            stops_[1] = Stop{2867, 4096, 4096, 0};
            stops_[2] = Stop{3276, 4096, 4096, 0};
            stops_[3] = Stop{4096, 4096, 0, 0};
            return Status::Ok;
        }
        default:
            // Invalid preset => empty.
            stops_.clear();
            return Status::BadFormat;
        }
    }
};

} // namespace rs
