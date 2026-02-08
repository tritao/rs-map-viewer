#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class HerringboneOperation final : public TextureOperationImpl<HerringboneOperation> {
public:
    HerringboneOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            scaleX_ = (v == 0) ? 1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            scaleY_ = (v == 0) ? 1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            gapQ12_ = static_cast<i32>(v);
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
            const i32 w = textureGenerator.width();

            const i32 denomX = 4096 / scaleX_;
            const i32 denomY = 4096 / scaleY_;

            for (i32 x = 0; x < w; x++) {
                const i32 xQ12 = hg[static_cast<std::size_t>(x)];
                const i32 xTileIndex = javaMulShift(scaleX_, xQ12, 12);
                const i32 yTileIndex = javaMulShift(scaleY_, yQ12, 12);

                const i32 xFracQ12 = javaMul(scaleX_, xQ12 % denomX);
                const i32 yFracQ12 = javaMul(scaleY_, yQ12 % denomY);

                if (yFracQ12 < gapQ12_) {
                    i32 phase = javaSub(xTileIndex, yTileIndex);
                    while (phase < 0) phase += 4;
                    while (phase > 3) phase -= 4;
                    if (phase != 1) {
                        lineOut[static_cast<std::size_t>(x)] = 0;
                        continue;
                    }
                    if (xFracQ12 < gapQ12_) {
                        lineOut[static_cast<std::size_t>(x)] = 0;
                        continue;
                    }
                }
                if (xFracQ12 < gapQ12_) {
                    i32 phase = javaSub(xTileIndex, yTileIndex);
                    while (phase < 0) phase += 4;
                    while (phase > 3) phase -= 4;
                    if (phase > 0) {
                        lineOut[static_cast<std::size_t>(x)] = 0;
                        continue;
                    }
                }
                lineOut[static_cast<std::size_t>(x)] = 4096;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 scaleX_ = 1;
    i32 scaleY_ = 1;
    i32 gapQ12_ = 204;
};

} // namespace rs
