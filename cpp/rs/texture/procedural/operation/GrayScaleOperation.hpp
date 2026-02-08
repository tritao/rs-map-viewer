#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class GrayScaleOperation final : public TextureOperationImpl<GrayScaleOperation> {
public:
    GrayScaleOperation() noexcept : TextureOperationImpl(1, true) {}

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
            ColourLine in{};
            const Status s = getColourInput(textureGenerator, 0, line, &in);
            if (!ok(s)) {
                *out = Span<i32>(nullptr, 0);
                return s;
            }
            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const std::size_t xi = static_cast<std::size_t>(x);
                const i32 sum = in.r[xi] + in.g[xi] + in.b[xi];
                lineOut[xi] = sum / 3;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }
};

} // namespace rs

