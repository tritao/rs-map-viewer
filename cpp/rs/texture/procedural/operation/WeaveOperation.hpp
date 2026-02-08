#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class WeaveOperation final : public TextureOperationImpl<WeaveOperation> {
public:
    WeaveOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            strandHalfThicknessQ12_ = static_cast<i32>(v);
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
            const Span<i32> vg = textureGenerator.verticalGradient();
            const Span<i32> hg = textureGenerator.horizontalGradient();
            if (static_cast<std::size_t>(line) >= vg.size()) {
                *out = Span<i32>(nullptr, 0);
                return Status::OutOfRange;
            }
            const i32 yQ12 = vg[static_cast<std::size_t>(line)];
            const i32 denomQ12 = 2048 - strandHalfThicknessQ12_;
            const i32 w = textureGenerator.width();

            for (i32 x = 0; x < w; x++) {
                const i32 xQ12 = hg[static_cast<std::size_t>(x)];
                if (xQ12 > strandHalfThicknessQ12_ &&
                    4096 - strandHalfThicknessQ12_ > xQ12 &&
                    yQ12 > 2048 - strandHalfThicknessQ12_ &&
                    yQ12 < strandHalfThicknessQ12_ + 2048) {
                    const i32 d = javaAbs(2048 - xQ12);
                    const i32 dist = javaIDiv(javaShl(d, 12), denomQ12);
                    lineOut[static_cast<std::size_t>(x)] = 4096 - dist;
                } else if (2048 - strandHalfThicknessQ12_ < xQ12 && 2048 + strandHalfThicknessQ12_ > xQ12) {
                    const i32 d = javaSub(javaAbs(yQ12 - 2048), strandHalfThicknessQ12_);
                    const i32 dist = javaIDiv(javaShl(d, 12), denomQ12);
                    lineOut[static_cast<std::size_t>(x)] = dist;
                } else if (strandHalfThicknessQ12_ > yQ12 || yQ12 > 4096 - strandHalfThicknessQ12_) {
                    const i32 d = javaSub(javaAbs(xQ12 - 2048), strandHalfThicknessQ12_);
                    const i32 dist = javaIDiv(javaShl(d, 12), denomQ12);
                    lineOut[static_cast<std::size_t>(x)] = dist;
                } else if (xQ12 < strandHalfThicknessQ12_ || 4096 - strandHalfThicknessQ12_ < xQ12) {
                    const i32 d = javaAbs(2048 - yQ12);
                    const i32 dist = javaIDiv(javaShl(d, 12), denomQ12);
                    lineOut[static_cast<std::size_t>(x)] = 4096 - dist;
                } else {
                    lineOut[static_cast<std::size_t>(x)] = 0;
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 strandHalfThicknessQ12_ = 585;
};

} // namespace rs
