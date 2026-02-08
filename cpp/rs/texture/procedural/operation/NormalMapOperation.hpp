#pragma once

#include <cmath>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class NormalMapOperation final : public TextureOperationImpl<NormalMapOperation> {
public:
    NormalMapOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            strengthQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            unsignedOutput_ = (v == 1);
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
            const i32 hMask = textureGenerator.heightMask();
            const i32 wMask = textureGenerator.widthMask();

            Span<i32> prevHeightRow;
            Span<i32> heightRow;
            Span<i32> nextHeightRow;
            Status s = getMonochromeInput(textureGenerator, 0, (line - 1) & hMask, &prevHeightRow);
            if (!ok(s)) return s;
            s = getMonochromeInput(textureGenerator, 0, line, &heightRow);
            if (!ok(s)) return s;
            s = getMonochromeInput(textureGenerator, 0, (line + 1) & hMask, &nextHeightRow);
            if (!ok(s)) return s;

            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const std::size_t xi = static_cast<std::size_t>(x);
                const i32 dyScaled = javaMul(strengthQ12_, static_cast<i32>(nextHeightRow[xi] - prevHeightRow[xi]));
                const i32 xPlus = (x + 1) & wMask;
                const i32 xMinus = (x - 1) & wMask;
                const i32 dxScaled = javaMul(
                    strengthQ12_,
                    static_cast<i32>(
                        heightRow[static_cast<std::size_t>(xPlus)] - heightRow[static_cast<std::size_t>(xMinus)]));

                const i32 dyQ12 = dyScaled >> 12;
                const i32 dxQ12 = dxScaled >> 12;
                const i32 dySquaredQ12 = javaMulShift(dyQ12, dyQ12, 12);
                const i32 dxSquaredQ12 = javaMulShift(dxQ12, dxQ12, 12);
                const i32 normalizerQ12 =
                    static_cast<i32>(std::sqrt(static_cast<double>(dySquaredQ12 + dxSquaredQ12 + 4096) / 4096.0) * 4096.0);

                i32 red = 0;
                i32 green = 0;
                i32 blue = 0;
                if (normalizerQ12 != 0) {
                    red = javaIDiv(dxScaled, normalizerQ12);
                    green = javaIDiv(dyScaled, normalizerQ12);
                    blue = javaIDiv(16777216, normalizerQ12);
                }
                if (unsignedOutput_) {
                    red = (red >> 1) + 2048;
                    green = (green >> 1) + 2048;
                    blue = (blue >> 1) + 2048;
                }
                lineOut.r[xi] = red;
                lineOut.g[xi] = green;
                lineOut.b[xi] = blue;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 strengthQ12_ = 4096;
    bool unsignedOutput_ = true;
};

} // namespace rs
