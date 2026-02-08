#pragma once

#include <cmath>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class MonochromeEdgeDetectorOperation final : public TextureOperationImpl<MonochromeEdgeDetectorOperation> {
public:
    MonochromeEdgeDetectorOperation() noexcept : TextureOperationImpl(1, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            strengthQ12_ = static_cast<i32>(v);
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
            const i32 heightMask = textureGenerator.heightMask();
            const i32 widthMask = textureGenerator.widthMask();
            const i32 prevLine = (line - 1) & heightMask;
            const i32 nextLine = (line + 1) & heightMask;

            Span<i32> prevInput;
            Span<i32> input;
            Span<i32> nextInput;

            Status s = getMonochromeInput(textureGenerator, 0, prevLine, &prevInput);
            if (!ok(s)) return s;
            s = getMonochromeInput(textureGenerator, 0, line, &input);
            if (!ok(s)) return s;
            s = getMonochromeInput(textureGenerator, 0, nextLine, &nextInput);
            if (!ok(s)) return s;

            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const std::size_t xi = static_cast<std::size_t>(x);
                const i32 dyScaled = javaMul(strengthQ12_, static_cast<i32>(nextInput[xi] - prevInput[xi]));
                const i32 xPlus = (x + 1) & widthMask;
                const i32 xMinus = (x - 1) & widthMask;
                const i32 dxScaled = javaMul(
                    strengthQ12_,
                    static_cast<i32>(
                        input[static_cast<std::size_t>(xPlus)] - input[static_cast<std::size_t>(xMinus)]));

                const i32 dxQ12 = dxScaled >> 12;
                const i32 dyQ12 = dyScaled >> 12;
                const i32 dySquaredQ12 = javaMulShift(dyQ12, dyQ12, 12);
                const i32 dxSquaredQ12 = javaMulShift(dxQ12, dxQ12, 12);

                const double normalF = static_cast<double>(dySquaredQ12 + dxSquaredQ12 + 4096) / 4096.0;
                const i32 normalizerQ12 = static_cast<i32>(std::sqrt(normalF) * 4096.0);
                const i32 invNormalizerQ24 = (normalizerQ12 == 0) ? 0 : javaIDiv(16777216, normalizerQ12);
                lineOut[xi] = 4096 - invNormalizerQ24;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 strengthQ12_ = 4096;
};

} // namespace rs
