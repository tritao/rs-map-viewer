#pragma once

#include <cstddef>

#include "../../../core/Allocator.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class RangeOperation final : public TextureOperationImpl<RangeOperation> {
public:
    RangeOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            minOutputQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            maxOutputQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            setIsMonochrome(v == 1);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status init() noexcept override {
        outputRangeQ12_ = maxOutputQ12_ - minOutputQ12_;
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
            if (!ok(s)) return s;
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut[i] = javaAdd(javaMulShift(outputRangeQ12_, input[i], 12), minOutputQ12_);
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
            if (!ok(s)) return s;
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut.r[i] = javaAdd(javaMulShift(outputRangeQ12_, input.r[i], 12), minOutputQ12_);
                lineOut.g[i] = javaAdd(javaMulShift(outputRangeQ12_, input.g[i], 12), minOutputQ12_);
                lineOut.b[i] = javaAdd(javaMulShift(outputRangeQ12_, input.b[i], 12), minOutputQ12_);
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 minOutputQ12_ = 1024;
    i32 maxOutputQ12_ = 3072;
    i32 outputRangeQ12_ = 2048;
};

} // namespace rs
