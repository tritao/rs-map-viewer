#pragma once

#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "TextureOperation.hpp"

namespace rs {

class ConstantMonochromeOperation final : public TextureOperationImpl<ConstantMonochromeOperation> {
public:
    ConstantMonochromeOperation() noexcept : TextureOperationImpl(0, true) {}

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
        constant_ = javaIDiv(javaShl(static_cast<i32>(v), 12), 255);
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
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut[i] = constant_;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 constant_ = 4096;
};

} // namespace rs
