#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class InvertOperation final : public TextureOperationImpl<InvertOperation> {
public:
    InvertOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId != 0) {
            return Status::Ok;
        }
        u8 v = 0;
        const Status s = reader.readUnsignedByte(&v);
        if (!ok(s)) {
            return s;
        }
        setIsMonochrome(v == 1);
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
            Span<i32> input;
            const Status s = getMonochromeInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut[i] = 4096 - input[i];
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
            ColourLine input{};
            const Status s = getColourInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut.r[i] = 4096 - input.r[i];
                lineOut.g[i] = 4096 - input.g[i];
                lineOut.b[i] = 4096 - input.b[i];
            }
        }
        *out = lineOut;
        return Status::Ok;
    }
};

} // namespace rs
