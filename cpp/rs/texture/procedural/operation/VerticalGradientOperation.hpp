#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class VerticalGradientOperation final : public TextureOperationImpl<VerticalGradientOperation> {
public:
    VerticalGradientOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)fieldId;
        (void)reader;
        (void)alloc;
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
            const Span<i32> vg = textureGenerator.verticalGradient();
            if (static_cast<std::size_t>(line) >= vg.size()) {
                *out = Span<i32>(nullptr, 0);
                return Status::OutOfRange;
            }
            const i32 v = vg[static_cast<std::size_t>(line)];
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut[i] = v;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }
};

} // namespace rs
