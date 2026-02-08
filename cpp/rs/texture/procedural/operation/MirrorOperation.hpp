#pragma once

#include <cstddef>

#include "../../../core/Allocator.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class MirrorOperation final : public TextureOperationImpl<MirrorOperation> {
public:
    MirrorOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            invertHorizontal_ = (v == 1);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            invertVertical_ = (v == 1);
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
            const i32 srcLine = invertVertical_ ? (textureGenerator.heightMask() - line) : line;
            Span<i32> input;
            Status s = getMonochromeInput(textureGenerator, 0, srcLine, &input);
            if (!ok(s)) return s;

            const i32 w = textureGenerator.width();
            const i32 wMask = textureGenerator.widthMask();
            if (invertHorizontal_) {
                for (i32 px = 0; px < w; px++) {
                    lineOut[static_cast<std::size_t>(px)] = input[static_cast<std::size_t>(wMask - px)];
                }
            } else {
                for (i32 px = 0; px < w; px++) {
                    lineOut[static_cast<std::size_t>(px)] = input[static_cast<std::size_t>(px)];
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
            const i32 srcLine = invertVertical_ ? (textureGenerator.heightMask() - line) : line;
            ColourLine input{};
            Status s = getColourInput(textureGenerator, 0, srcLine, &input);
            if (!ok(s)) return s;

            const i32 w = textureGenerator.width();
            const i32 wMask = textureGenerator.widthMask();
            if (invertHorizontal_) {
                for (i32 px = 0; px < w; px++) {
                    const std::size_t src = static_cast<std::size_t>(wMask - px);
                    lineOut.r[static_cast<std::size_t>(px)] = input.r[src];
                    lineOut.g[static_cast<std::size_t>(px)] = input.g[src];
                    lineOut.b[static_cast<std::size_t>(px)] = input.b[src];
                }
            } else {
                for (i32 px = 0; px < w; px++) {
                    const std::size_t i = static_cast<std::size_t>(px);
                    lineOut.r[i] = input.r[i];
                    lineOut.g[i] = input.g[i];
                    lineOut.b[i] = input.b[i];
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    bool invertHorizontal_ = true;
    bool invertVertical_ = true;
};

} // namespace rs
