#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../ProceduralSources.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class SpriteSourceOperation final : public TextureOperationImpl<SpriteSourceOperation> {
public:
    SpriteSourceOperation() noexcept : TextureOperationImpl(0, false) {}

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
        spriteId_ = static_cast<i32>(v);
        return Status::Ok;
    }

    [[nodiscard]] i32 getSpriteId() const noexcept override { return spriteId_; }

    void clearCaches() noexcept override {
        TextureOperation::clearCaches();
        pixels_.pixels.clear();
        pixels_.width = 0;
        pixels_.height = 0;
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
            if (!ensureSpriteLoaded(textureGenerator) || pixels_.pixels.size() == 0 || pixels_.width <= 0 || pixels_.height <= 0) {
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

            const i32 srcY = (dstH == srcH) ? line : (line * srcH) / dstH;
            const std::size_t base = static_cast<std::size_t>(srcW) * static_cast<std::size_t>(srcY);

            if (dstW == srcW) {
                std::size_t off = base;
                for (i32 x = 0; x < dstW; x++) {
                    const i32 value = pixels_.pixels[off++];
                    lineOut.b[static_cast<std::size_t>(x)] = (value << 4) & 0xFF0;
                    lineOut.g[static_cast<std::size_t>(x)] = (value & 0xFF00) >> 4;
                    lineOut.r[static_cast<std::size_t>(x)] = (value >> 12) & 0xFF0;
                }
            } else {
                for (i32 x = 0; x < dstW; x++) {
                    const i32 srcX = (srcW * x) / dstW;
                    const i32 value = pixels_.pixels[base + static_cast<std::size_t>(srcX)];
                    lineOut.b[static_cast<std::size_t>(x)] = (value << 4) & 0xFF0;
                    lineOut.g[static_cast<std::size_t>(x)] = (value & 0xFF00) >> 4;
                    lineOut.r[static_cast<std::size_t>(x)] = (value >> 12) & 0xFF0;
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 spriteId_ = -1;
    SpritePixels pixels_{};

    bool ensureSpriteLoaded(TextureGenerator& textureGenerator) noexcept {
        if (pixels_.pixels.size() > 0) {
            return true;
        }
        if (spriteId_ < 0) {
            return false;
        }
        if (!textureGenerator.spriteSource) {
            return false;
        }
        Allocator& alloc = textureGenerator.allocator();
        pixels_.pixels = Vec<i32>(alloc);
        const Status s = textureGenerator.spriteSource->tryLoadSpritePixelsArgb(spriteId_, &pixels_, alloc);
        if (!ok(s)) {
            pixels_.pixels.clear();
            pixels_.width = 0;
            pixels_.height = 0;
            return false;
        }
        return true;
    }
};

} // namespace rs
