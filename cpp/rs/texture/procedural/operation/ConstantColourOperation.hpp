#pragma once

#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "TextureOperation.hpp"

namespace rs {

class ConstantColourOperation final : public TextureOperationImpl<ConstantColourOperation> {
public:
    ConstantColourOperation() noexcept : TextureOperationImpl(0, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId != 0) {
            return Status::Ok;
        }
        u32 rgb = 0;
        const Status s = reader.readMedium(&rgb);
        if (!ok(s)) {
            return s;
        }
        setConstant(static_cast<i32>(rgb));
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
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                lineOut.r[i] = constantR_;
                lineOut.g[i] = constantG_;
                lineOut.b[i] = constantB_;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    void setConstant(i32 rgb) noexcept {
        constantR_ = ((rgb >> 16) & 0xFF) * 16;
        constantG_ = ((rgb >> 8) & 0xFF) * 16;
        constantB_ = (rgb & 0xFF) * 16;
    }

    i32 constantR_ = 0;
    i32 constantG_ = 0;
    i32 constantB_ = 0;
};

} // namespace rs
