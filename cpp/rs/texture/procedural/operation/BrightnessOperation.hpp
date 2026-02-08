#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class BrightnessOperation final : public TextureOperationImpl<BrightnessOperation> {
public:
    BrightnessOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            maxValue_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            blueFactor_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            greenFactor_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 3) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            redFactor_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 4) {
            u32 rgb = 0;
            const Status s = reader.readMedium(&rgb);
            if (!ok(s)) return s;
            colorDeltaR_ = static_cast<i32>((rgb & 0xFF0000u) << 4);
            colorDeltaG_ = static_cast<i32>((rgb >> 4) & 0xFF0u);
            // Mirrors TS bug: `(rgb >> 12) & 0x0` => always 0.
            colorDeltaB_ = static_cast<i32>((rgb >> 12) & 0x0u);
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
            ColourLine in{};
            const Status s = getColourInput(textureGenerator, 0, line, &in);
            if (!ok(s)) return s;

            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const std::size_t xi = static_cast<std::size_t>(x);
                const i32 r = in.r[xi];
                i32 absR = r - colorDeltaR_;
                if (absR < 0) absR = -absR;
                if (absR <= maxValue_) {
                    const i32 g = in.g[xi];
                    i32 absG = g - colorDeltaG_;
                    if (absG < 0) absG = -absG;
                    if (absG <= maxValue_) {
                        const i32 b = in.b[xi];
                        i32 absB = b - colorDeltaB_;
                        if (absB < 0) absB = -absB;
                        if (absB <= maxValue_) {
                            lineOut.r[xi] = javaMulShift(r, redFactor_, 12);
                            lineOut.g[xi] = javaMulShift(g, greenFactor_, 12);
                            lineOut.b[xi] = javaMulShift(b, blueFactor_, 12);
                        } else {
                            lineOut.r[xi] = r;
                            lineOut.g[xi] = g;
                            lineOut.b[xi] = b;
                        }
                    } else {
                        lineOut.r[xi] = r;
                        lineOut.g[xi] = g;
                        lineOut.b[xi] = in.b[xi];
                    }
                } else {
                    lineOut.r[xi] = r;
                    lineOut.g[xi] = in.g[xi];
                    lineOut.b[xi] = in.b[xi];
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 maxValue_ = 409;
    i32 redFactor_ = 4096;
    i32 greenFactor_ = 4096;
    i32 blueFactor_ = 4096;
    i32 colorDeltaR_ = 0;
    i32 colorDeltaG_ = 0;
    i32 colorDeltaB_ = 0;
};

} // namespace rs
