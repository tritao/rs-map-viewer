#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../ProceduralSources.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class TextureSourceOperation final : public TextureOperationImpl<TextureSourceOperation> {
public:
    TextureSourceOperation() noexcept : TextureOperationImpl(0, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId != 0) {
            return Status::Ok;
        }
        u16 v = 0;
        const Status s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return s;
        }
        textureId_ = static_cast<i32>(v);
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        Status s = TextureOperation::initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return s;
        }
        pixels_.pixels = Vec<i32>(alloc);
        pixels_.width = 0;
        pixels_.height = 0;

        if (textureId_ < 0 || !textureGenerator.textureSource) {
            return Status::Ok;
        }

        const i32 srcSize = textureGenerator.textureSource->isSmall(textureId_) ? 64 : 128;
        s = textureGenerator.textureSource->tryLoadTexturePixelsRgb(textureId_, srcSize, &pixels_, alloc);
        if (!ok(s)) {
            // Keep zero output when missing.
            pixels_.pixels.clear();
            pixels_.width = 0;
            pixels_.height = 0;
            return Status::Ok;
        }
        return Status::Ok;
    }

    void clearCaches() noexcept override {
        TextureOperation::clearCaches();
        pixels_.pixels.clear();
        pixels_.width = 0;
        pixels_.height = 0;
    }

    [[nodiscard]] i32 getTextureId() const noexcept override { return textureId_; }

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
            if (pixels_.pixels.size() == 0 || pixels_.width <= 0 || pixels_.height <= 0) {
                for (std::size_t i = 0; i < lineOut.r.size(); i++) {
                    lineOut.r[i] = 0;
                    lineOut.g[i] = 0;
                    lineOut.b[i] = 0;
                }
                *out = lineOut;
                return Status::Ok;
            }

            const i32 dstW = textureGenerator.width();
            const i32 dstH = textureGenerator.height();
            const i32 srcW = pixels_.width;
            const i32 srcH = pixels_.height;

            const i32 srcY = (dstH == srcH) ? line : (srcH * line) / dstH;
            const std::size_t srcRowStart = static_cast<std::size_t>(srcY) * static_cast<std::size_t>(srcW);

            if (dstW == srcW) {
                std::size_t src = srcRowStart;
                for (i32 x = 0; x < dstW; x++) {
                    const i32 value = pixels_.pixels[src++];
                    lineOut.b[static_cast<std::size_t>(x)] = (value & 0xFF) << 4;
                    lineOut.g[static_cast<std::size_t>(x)] = (value & 0xFF00) >> 4;
                    lineOut.r[static_cast<std::size_t>(x)] = (value & 0xFF0000) >> 12;
                }
            } else {
                for (i32 x = 0; x < dstW; x++) {
                    const i32 srcX = (srcW * x) / dstW;
                    const i32 value = pixels_.pixels[srcRowStart + static_cast<std::size_t>(srcX)];
                    lineOut.b[static_cast<std::size_t>(x)] = (value & 0xFF) << 4;
                    lineOut.g[static_cast<std::size_t>(x)] = (value & 0xFF00) >> 4;
                    lineOut.r[static_cast<std::size_t>(x)] = (value & 0xFF0000) >> 12;
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 textureId_ = -1;
    TexturePixels pixels_{};
};

} // namespace rs
