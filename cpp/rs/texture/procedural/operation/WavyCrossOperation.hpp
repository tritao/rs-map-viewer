#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class WavyCrossOperation final : public TextureOperationImpl<WavyCrossOperation> {
public:
    WavyCrossOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) return readU16(reader, &band0OffsetX_);
        if (fieldId == 1) return readU16(reader, &band0OffsetY_);
        if (fieldId == 2) return readU16(reader, &band1OffsetX_);
        if (fieldId == 3) return readU16(reader, &band1OffsetY_);
        if (fieldId == 4) return readU16(reader, &phaseScaleQ12_);
        if (fieldId == 5) return readU16(reader, &widthScaleQ12_);
        if (fieldId == 6) return readU16(reader, &widthNormalizationQ12_);
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

            const i32 yCenteredQ12 = vg[static_cast<std::size_t>(line)] - 2048;
            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const i32 xCenteredQ12 = hg[static_cast<std::size_t>(x)] - 2048;

                i32 band0X = xCenteredQ12 + band0OffsetX_;
                band0X = (band0X >= -2048) ? band0X : (band0X + 4096);
                i32 band0Y = yCenteredQ12 + band0OffsetY_;
                band0X = (band0X <= 2048) ? band0X : (band0X - 4096); // mirrors TS ordering/typo placement
                band0Y = (band0Y >= -2048) ? band0Y : (band0Y + 4096);
                band0Y = (band0Y <= 2048) ? band0Y : (band0Y - 4096);

                i32 band1X = xCenteredQ12 + band1OffsetX_;
                i32 band1Y = yCenteredQ12 + band1OffsetY_;
                band1X = (band1X >= -2048) ? band1X : (band1X + 4096);
                band1X = (band1X <= 2048) ? band1X : (band1X - 4096);
                band1Y = (band1Y >= -2048) ? band1Y : (band1Y + 4096);
                band1Y = (band1Y <= 2048) ? band1Y : (band1Y - 4096);

                const bool inBand =
                    isInWavyAntiDiagonalBand(textureGenerator, band0X, band0Y) ||
                    isInWavyDiagonalBand(textureGenerator, band1X, band1Y);
                lineOut[static_cast<std::size_t>(x)] = inBand ? 4096 : 0;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 band0OffsetX_ = 2048;
    i32 band0OffsetY_ = 0;
    i32 band1OffsetX_ = 0;
    i32 band1OffsetY_ = 2048;

    i32 phaseScaleQ12_ = 12288;
    i32 widthScaleQ12_ = 4096;
    i32 widthNormalizationQ12_ = 8192;

    static Status readU16(Uint8ArrayReader& reader, i32* out) noexcept {
        if (!out) return Status::InvalidArgument;
        u16 v = 0;
        const Status s = reader.readUnsignedShort(&v);
        if (!ok(s)) return s;
        *out = static_cast<i32>(v);
        return Status::Ok;
    }

    bool isInWavyAntiDiagonalBand(TextureGenerator& textureGenerator, i32 x, i32 y) const noexcept {
        const i32 phase = javaMulShift(javaSub(y, x), phaseScaleQ12_, 12);
        const Span<const i32> cosine = textureGenerator.cosineTableQ12();
        i32 halfWidth = cosine[static_cast<std::size_t>((javaMulShift(phase, 255, 12)) & 0xFF)];
        halfWidth = javaIDiv(javaShl(halfWidth, 12), phaseScaleQ12_);
        halfWidth = javaIDiv(javaShl(halfWidth, 12), widthNormalizationQ12_);
        halfWidth = javaMulShift(widthScaleQ12_, halfWidth, 12);
        const i32 sum = x + y;
        return halfWidth > sum && -halfWidth < sum;
    }

    bool isInWavyDiagonalBand(TextureGenerator& textureGenerator, i32 x, i32 y) const noexcept {
        const i32 phase = javaMulShift(javaAdd(y, x), phaseScaleQ12_, 12);
        const Span<const i32> cosine = textureGenerator.cosineTableQ12();
        i32 halfWidth = cosine[static_cast<std::size_t>((javaMulShift(phase, 255, 12)) & 0xFF)];
        halfWidth = javaIDiv(javaShl(halfWidth, 12), phaseScaleQ12_);
        halfWidth = javaIDiv(javaShl(halfWidth, 12), widthNormalizationQ12_);
        halfWidth = javaMulShift(halfWidth, widthScaleQ12_, 12);
        const i32 diff = y - x;
        return halfWidth > diff && diff > -halfWidth;
    }
};

} // namespace rs
