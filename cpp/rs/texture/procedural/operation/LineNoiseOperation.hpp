#pragma once

#include <cstddef>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../../../util/JavaRandom.hpp"
#include "../TextureGenerator.hpp"
#include "../cache/MonochromeImageCache.hpp"
#include "TextureOperation.hpp"

namespace rs {

class LineNoiseOperation final : public TextureOperationImpl<LineNoiseOperation> {
public:
    LineNoiseOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            seed_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            lineCount_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            lineLength_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 3) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            angleCenterQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 4) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            angleRangeQ12_ = static_cast<i32>(v);
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
            Span<i32> all;
            Status s = monochromeCache().getAll(&all);
            if (!ok(s)) {
                // Needs full-cache mode.
                return s;
            }
            render(textureGenerator, all);
            // Mark all lines initialized so subsequent gets are not dirty.
            monochromeCache().markAllUsed();
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 seed_ = 0;
    i32 lineCount_ = 2000;
    i32 lineLength_ = 16;
    i32 angleCenterQ12_ = 0;
    i32 angleRangeQ12_ = 4096;

    void render(TextureGenerator& textureGenerator, Span<i32> allPixels) noexcept {
        const i32 width = textureGenerator.width();
        const i32 height = textureGenerator.height();
        const i32 widthMask = textureGenerator.widthMask();
        const i32 heightMask = textureGenerator.heightMask();

        const std::size_t w = static_cast<std::size_t>(width);
        const std::size_t h = static_cast<std::size_t>(height);
        if (allPixels.size() < w * h) {
            return;
        }

        const Span<const i32> sine = textureGenerator.sineTableQ12();
        const Span<const i32> cosine = textureGenerator.cosineTableQ12();

        const i32 halfAngleRangeQ12 = angleRangeQ12_ >> 1;
        JavaRandom rng(static_cast<u64>(seed_));

        for (i32 lineIndex = 0; lineIndex < lineCount_; lineIndex++) {
            const i32 angleQ12 =
                (angleRangeQ12_ > 0)
                    ? (angleCenterQ12_ - halfAngleRangeQ12 + nextIntJagex(rng, angleRangeQ12_))
                    : angleCenterQ12_;
            const i32 angleTableIndex = (angleQ12 >> 4) & 0xFF;

            i32 startX = nextIntJagex(rng, width);
            i32 startY = nextIntJagex(rng, height);
            i32 endX = javaAdd(javaMulShift(cosine[static_cast<std::size_t>(angleTableIndex)], lineLength_, 12), startX);
            i32 endY = javaAdd(javaMulShift(sine[static_cast<std::size_t>(angleTableIndex)], lineLength_, 12), startY);

            i32 absDeltaX = endX - startX;
            i32 absDeltaY = endY - startY;
            if (absDeltaX == 0 && absDeltaY == 0) {
                continue;
            }
            if (absDeltaX < 0) absDeltaX = -absDeltaX;
            if (absDeltaY < 0) absDeltaY = -absDeltaY;

            const bool isSteep = absDeltaX < absDeltaY;
            if (isSteep) {
                const i32 startXPrev = startX;
                const i32 endXPrev = endX;
                startX = startY;
                startY = startXPrev;
                endX = endY;
                endY = endXPrev;
            }
            if (startX > endX) {
                const i32 startXPrev = startX;
                const i32 startYPrev = startY;
                startX = endX;
                startY = endY;
                endX = startXPrev;
                endY = startYPrev;
            }

            const i32 deltaX = endX - startX;
            i32 deltaY = endY - startY;
            i32 y = startY;
            const i32 yStep = (endY <= startY) ? -1 : 1;
            if (deltaY < 0) {
                deltaY = -deltaY;
            }
            i32 error = javaIDiv(-deltaX, 2);
            const i32 valueStep = (deltaX == 0) ? 0 : javaIDiv(2048, deltaX);
            const i32 intensityJitter = 1024 - (nextIntJagex(rng, 4096) >> 2);
            const i32 intensityBase = 1024 + intensityJitter;

            for (i32 x = startX; x < endX; x++) {
                error += deltaY;
                const i32 valueQ12 = valueStep * (x - startX) + intensityBase;
                const i32 yMasked = y & heightMask;
                if (error > 0) {
                    y += yStep;
                    error -= deltaX;
                }
                const i32 xMasked = x & widthMask;

                if (!isSteep) {
                    // Mirrors TS: pixelsByColumn[xMasked][yMasked]
                    const std::size_t idx = static_cast<std::size_t>(xMasked) * w + static_cast<std::size_t>(yMasked);
                    if (idx < allPixels.size()) {
                        allPixels[idx] = valueQ12;
                    }
                } else {
                    // Mirrors TS: pixelsByColumn[yMasked][xMasked]
                    const std::size_t idx = static_cast<std::size_t>(yMasked) * w + static_cast<std::size_t>(xMasked);
                    if (idx < allPixels.size()) {
                        allPixels[idx] = valueQ12;
                    }
                }
            }
        }
    }
};

} // namespace rs
