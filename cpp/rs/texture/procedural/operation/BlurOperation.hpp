#pragma once

#include <cstddef>

#include "../../../core/Allocator.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class BlurOperation final : public TextureOperationImpl<BlurOperation> {
public:
    BlurOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            hExtent_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            vExtent_ = static_cast<i32>(v);
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
            const i32 nPasses = 1 + (vExtent_ + vExtent_);
            const i32 invPasses = javaIDiv(65536, nPasses);
            const i32 nPixels = 1 + hExtent_ + hExtent_;
            const i32 invPixels = javaIDiv(65536, nPixels);

            Allocator& alloc = textureGenerator.allocator();
            Vec<i32> passes(alloc);
            auto rr = passes.resize(static_cast<std::size_t>(nPasses) * static_cast<std::size_t>(textureGenerator.width()));
            if (!rr.isOk()) {
                *out = lineOut;
                return rr.status();
            }

            const i32 width = textureGenerator.width();
            const i32 wMask = textureGenerator.widthMask();
            const i32 hMask = textureGenerator.heightMask();

            i32 passIdx = 0;
            for (i32 pass = line - vExtent_; pass <= line + vExtent_; pass++, passIdx++) {
                Span<i32> input;
                const Status s = getMonochromeInput(textureGenerator, 0, pass & hMask, &input);
                if (!ok(s)) {
                    *out = lineOut;
                    return s;
                }

                i32 sum = 0;
                for (i32 px = -hExtent_; px <= hExtent_; px++) {
                    sum += input[static_cast<std::size_t>(px & wMask)];
                }

                const std::size_t base = static_cast<std::size_t>(passIdx) * static_cast<std::size_t>(width);
                i32 ptr = 0;
                while (ptr < width) {
                    passes[base + static_cast<std::size_t>(ptr)] = javaIDiv(javaMul(sum, invPixels), 65536);
                    sum -= input[static_cast<std::size_t>((ptr - hExtent_) & wMask)];
                    ptr++;
                    sum += input[static_cast<std::size_t>((ptr + hExtent_) & wMask)];
                }
            }

            for (i32 px = 0; px < width; px++) {
                i32 sum = 0;
                for (i32 pass = 0; pass < nPasses; pass++) {
                    sum += passes[static_cast<std::size_t>(pass) * static_cast<std::size_t>(width) + static_cast<std::size_t>(px)];
                }
                lineOut[static_cast<std::size_t>(px)] = javaIDiv(javaMul(sum, invPasses), 65536);
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
            const i32 nPasses = 1 + (vExtent_ + vExtent_);
            const i32 invPasses = javaIDiv(65536, nPasses);
            const i32 nPixels = 1 + hExtent_ + hExtent_;
            const i32 invPixels = javaIDiv(65536, nPixels);

            Allocator& alloc = textureGenerator.allocator();
            const std::size_t width = static_cast<std::size_t>(textureGenerator.width());
            Vec<i32> passes(alloc);
            auto rr = passes.resize(static_cast<std::size_t>(nPasses) * 3 * width);
            if (!rr.isOk()) {
                *out = lineOut;
                return rr.status();
            }

            const i32 w = textureGenerator.width();
            const i32 wMask = textureGenerator.widthMask();
            const i32 hMask = textureGenerator.heightMask();

            i32 passIdx = 0;
            for (i32 pass = line - vExtent_; pass <= line + vExtent_; pass++, passIdx++) {
                ColourLine input{};
                const Status s = getColourInput(textureGenerator, 0, pass & hMask, &input);
                if (!ok(s)) {
                    *out = lineOut;
                    return s;
                }

                i32 sumR = 0;
                i32 sumG = 0;
                i32 sumB = 0;
                for (i32 px = -hExtent_; px <= hExtent_; px++) {
                    const std::size_t ix = static_cast<std::size_t>(px & wMask);
                    sumR += input.r[ix];
                    sumG += input.g[ix];
                    sumB += input.b[ix];
                }

                const std::size_t base = static_cast<std::size_t>(passIdx) * 3 * width;
                i32 ptr = 0;
                while (ptr < w) {
                    const std::size_t p = static_cast<std::size_t>(ptr);
                    passes[base + p] = javaIDiv(javaMul(sumR, invPixels), 65536);
                    passes[base + width + p] = javaIDiv(javaMul(sumG, invPixels), 65536);
                    passes[base + 2 * width + p] = javaIDiv(javaMul(sumB, invPixels), 65536);

                    const std::size_t sub = static_cast<std::size_t>((ptr - hExtent_) & wMask);
                    sumR -= input.r[sub];
                    sumG -= input.g[sub];
                    sumB -= input.b[sub];
                    ptr++;
                    const std::size_t add = static_cast<std::size_t>((ptr + hExtent_) & wMask);
                    sumR += input.r[add];
                    sumG += input.g[add];
                    sumB += input.b[add];
                }
            }

            for (std::size_t px = 0; px < width; px++) {
                i32 sumR = 0;
                i32 sumG = 0;
                i32 sumB = 0;
                for (i32 pass = 0; pass < nPasses; pass++) {
                    const std::size_t base = static_cast<std::size_t>(pass) * 3 * width;
                    sumR += passes[base + px];
                    sumG += passes[base + width + px];
                    sumB += passes[base + 2 * width + px];
                }
                lineOut.r[px] = javaIDiv(javaMul(sumR, invPasses), 65536);
                lineOut.g[px] = javaIDiv(javaMul(sumG, invPasses), 65536);
                lineOut.b[px] = javaIDiv(javaMul(sumB, invPasses), 65536);
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 hExtent_ = 1;
    i32 vExtent_ = 1;
};

} // namespace rs
