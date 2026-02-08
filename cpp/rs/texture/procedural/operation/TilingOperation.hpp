#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class TilingOperation final : public TextureOperationImpl<TilingOperation> {
public:
    TilingOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            tileCountH_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            tileCountV_ = static_cast<i32>(v);
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
            const i32 width = textureGenerator.width();
            const i32 height = textureGenerator.height();
            const i32 tileW = (tileCountH_ == 0) ? 0 : javaIDiv(width, tileCountH_);
            const i32 tileH = (tileCountV_ == 0) ? 0 : javaIDiv(height, tileCountV_);

            Span<i32> input;
            if (tileH <= 0) {
                const Status s = getMonochromeInput(textureGenerator, 0, 0, &input);
                if (!ok(s)) return s;
            } else {
                const i32 tY = line % tileH;
                const i32 inputY = javaIDiv(height * tY, tileH);
                const Status s = getMonochromeInput(textureGenerator, 0, inputY, &input);
                if (!ok(s)) return s;
            }

            for (i32 x = 0; x < width; x++) {
                if (tileW <= 0) {
                    lineOut[static_cast<std::size_t>(x)] = input[0];
                } else {
                    const i32 tX = x % tileW;
                    const i32 inputX = javaIDiv(tX * width, tileW);
                    lineOut[static_cast<std::size_t>(x)] = input[static_cast<std::size_t>(inputX)];
                }
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
            const i32 width = textureGenerator.width();
            const i32 height = textureGenerator.height();
            const i32 tileW = (tileCountH_ == 0) ? 0 : javaIDiv(width, tileCountH_);
            const i32 tileH = (tileCountV_ == 0) ? 0 : javaIDiv(height, tileCountV_);

            ColourLine input{};
            if (tileH <= 0) {
                const Status s = getColourInput(textureGenerator, 0, 0, &input);
                if (!ok(s)) return s;
            } else {
                const i32 tY = line % tileH;
                const i32 inputY = javaIDiv(height * tY, tileH);
                const Status s = getColourInput(textureGenerator, 0, inputY, &input);
                if (!ok(s)) return s;
            }

            for (i32 x = 0; x < width; x++) {
                i32 inputX = 0;
                if (tileW > 0) {
                    const i32 tX = x % tileW;
                    inputX = javaIDiv(tX * width, tileW);
                }
                const std::size_t xi = static_cast<std::size_t>(x);
                const std::size_t src = static_cast<std::size_t>(inputX);
                lineOut.r[xi] = input.r[src];
                lineOut.g[xi] = input.g[src];
                lineOut.b[xi] = input.b[src];
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 tileCountH_ = 4;
    i32 tileCountV_ = 4;
};

} // namespace rs
