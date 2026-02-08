#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class HorizontalGradientOperation final : public TextureOperationImpl<HorizontalGradientOperation> {
public:
    HorizontalGradientOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)fieldId;
        (void)reader;
        (void)alloc;
        return Status::Ok;
    }

    Status getMonochromeOutput(TextureGenerator& textureGenerator, i32 line, Span<i32>* out) noexcept override {
        (void)line;
        if (!out) {
            return Status::InvalidArgument;
        }
        // TS returns `textureGenerator.horizontalGradient` directly (no caching).
        *out = textureGenerator.horizontalGradient();
        return Status::Ok;
    }
};

} // namespace rs
