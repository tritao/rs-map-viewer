#pragma once

#include <cmath>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class KaleidoscopeOperation final : public TextureOperationImpl<KaleidoscopeOperation> {
public:
    KaleidoscopeOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            setIsMonochrome(v == 1);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status getMonochromeOutput(TextureGenerator& textureGenerator, i32 line, Span<i32>* out) noexcept override {
        if (!out) {
            return Status::InvalidArgument;
        }
        Span<i32> lineOut = monochromeCache().get(line);
        if (lineOut.size() == 0) {
            *out = lineOut;
            return Status::OutOfRange;
        }
        if (monochromeCache().dirty()) {
            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                calcPos(textureGenerator, x, line);
                Span<i32> in;
                const Status s = getMonochromeInput(textureGenerator, 0, y0_, &in);
                if (!ok(s) || static_cast<std::size_t>(x0_) >= in.size()) {
                    lineOut[static_cast<std::size_t>(x)] = 0;
                } else {
                    lineOut[static_cast<std::size_t>(x)] = in[static_cast<std::size_t>(x0_)];
                }
            }
        }
        *out = lineOut;
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
            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                calcPos(textureGenerator, x, line);
                ColourLine in{};
                const Status s = getColourInput(textureGenerator, 0, y0_, &in);
                if (!ok(s) || static_cast<std::size_t>(x0_) >= in.r.size()) {
                    lineOut.r[static_cast<std::size_t>(x)] = 0;
                    lineOut.g[static_cast<std::size_t>(x)] = 0;
                    lineOut.b[static_cast<std::size_t>(x)] = 0;
                } else {
                    const std::size_t xi = static_cast<std::size_t>(x0_);
                    lineOut.r[static_cast<std::size_t>(x)] = in.r[xi];
                    lineOut.g[static_cast<std::size_t>(x)] = in.g[xi];
                    lineOut.b[static_cast<std::size_t>(x)] = in.b[xi];
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 x0_ = 0;
    i32 y0_ = 0;

    void calcPos(TextureGenerator& textureGenerator, i32 x, i32 y) noexcept {
        const i32 w = textureGenerator.width();
        const i32 h = textureGenerator.height();
        const i32 wMask = textureGenerator.widthMask();
        const i32 hMask = textureGenerator.heightMask();

        // TS indexes gradients as horizontalGradient[y] and verticalGradient[x] (swapped).
        const i32 hGrad = textureGenerator.horizontalGradient()[static_cast<std::size_t>(y & wMask)];
        const i32 vGrad = textureGenerator.verticalGradient()[static_cast<std::size_t>(x & hMask)];

        // TS uses `Math.fround(Math.atan2(...))` (float32 rounding) then compares against double literals.
        const float angleF = std::atan2(
            static_cast<float>(hGrad - 2048),
            static_cast<float>(vGrad - 2048));
        const double angle = static_cast<double>(angleF);

        if (angle >= -3.141592653589793 && angle <= -2.356194490192345) {
            x0_ = x;
            y0_ = y;
        } else if (angle <= -1.5707963267948966 && angle >= -2.356194490192345) {
            y0_ = x;
            x0_ = y;
        } else if (angle <= -0.7853981633974483 && angle >= -1.5707963267948966) {
            x0_ = w - y;
            y0_ = x;
        } else if (angle <= 0.0 && angle >= -0.7853981633974483) {
            y0_ = h - y;
            x0_ = x;
        } else if (angle >= 0.0 && angle <= 0.7853981633974483) {
            x0_ = w - x;
            y0_ = h - y;
        } else if (angle >= 0.7853981633974483 && angle <= 1.5707963267948966) {
            x0_ = w - y;
            y0_ = h - x;
        } else if (angle >= 1.5707963267948966 && angle <= 2.356194490192345) {
            x0_ = y;
            y0_ = h - x;
        } else if (angle >= 2.356194490192345 && angle <= 3.141592653589793) {
            y0_ = y;
            x0_ = w - x;
        }

        x0_ &= wMask;
        y0_ &= hMask;
    }
};

} // namespace rs
