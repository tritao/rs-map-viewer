#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

static inline i32 clampOp(i32 v, i32 lo, i32 hi) noexcept {
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}

class ClampOperation final : public TextureOperationImpl<ClampOperation> {
public:
    ClampOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            min_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            max_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
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
            Span<i32> input;
            Status s = getMonochromeInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut[i] = clampOp(input[i], min_, max_);
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
            Status s = getColourInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut.r[i] = clampOp(input.r[i], min_, max_);
                lineOut.g[i] = clampOp(input.g[i], min_, max_);
                lineOut.b[i] = clampOp(input.b[i], min_, max_);
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 min_ = 0;
    i32 max_ = 4096;
};

} // namespace rs
