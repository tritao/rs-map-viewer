#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class RangeThresholdOperation final : public TextureOperationImpl<RangeThresholdOperation> {
public:
    RangeThresholdOperation() noexcept : TextureOperationImpl(1, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            minValue_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            maxValue_ = static_cast<i32>(v);
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
            Span<i32> in;
            Status s = getMonochromeInput(textureGenerator, 0, line, &in);
            if (!ok(s)) {
                *out = Span<i32>(nullptr, 0);
                return s;
            }
            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const i32 v = in[static_cast<std::size_t>(x)];
                lineOut[static_cast<std::size_t>(x)] = (v >= minValue_ && v <= maxValue_) ? 4096 : 0;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 minValue_ = 0;
    i32 maxValue_ = 4096;
};

} // namespace rs

