#pragma once

#include <cstddef>
#include <cmath>

#include "../../../core/Allocator.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class EmbossOperation final : public TextureOperationImpl<EmbossOperation> {
public:
    EmbossOperation() noexcept : TextureOperationImpl(1, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            strengthQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            lightAzimuthQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            lightElevationQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status init() noexcept override {
        // Mirrors TS: use float32 angles, but evaluate trig in double.
        const float elevF = static_cast<float>(static_cast<double>(lightElevationQ12_) / 4096.0);
        const float azF = static_cast<float>(static_cast<double>(lightAzimuthQ12_) / 4096.0);

        const double cosElev = std::cos(static_cast<double>(elevF));
        const double sinAz = std::sin(static_cast<double>(azF));
        const double cosAz = std::cos(static_cast<double>(azF));
        const double sinElev = std::sin(static_cast<double>(elevF));

        lightDirQ12_[0] = static_cast<i32>(4096.0 * (cosElev * sinAz));
        lightDirQ12_[1] = static_cast<i32>(4096.0 * (cosElev * cosAz));
        lightDirQ12_[2] = static_cast<i32>(4096.0 * sinElev);

        const i32 xSqQ12 = javaMulShift(lightDirQ12_[0], lightDirQ12_[0], 12);
        const i32 ySqQ12 = javaMulShift(lightDirQ12_[1], lightDirQ12_[1], 12);
        const i32 zSqQ12 = javaMulShift(lightDirQ12_[2], lightDirQ12_[2], 12);
        // TS computes `magnitudeQ12 = i32(Math.sqrt(magnitudeSqQ12 / 4096) * 4096)`, i.e.:
        // - no 32-bit wrapping on the sum
        // - float division by 4096 before sqrt
        const i64 magnitudeSqQ12 = static_cast<i64>(xSqQ12) + static_cast<i64>(ySqQ12) + static_cast<i64>(zSqQ12);
        const double magnitudeQ12f = std::sqrt(static_cast<double>(magnitudeSqQ12) / 4096.0) * 4096.0;
        const i32 magnitudeQ12 = static_cast<i32>(magnitudeQ12f);
        if (magnitudeQ12 != 0) {
            lightDirQ12_[0] = javaIDiv(javaShl(lightDirQ12_[0], 12), magnitudeQ12);
            lightDirQ12_[1] = javaIDiv(javaShl(lightDirQ12_[1], 12), magnitudeQ12);
            lightDirQ12_[2] = javaIDiv(javaShl(lightDirQ12_[2], 12), magnitudeQ12);
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
            const i32 widthMult = javaMulShift(strengthQ12_, textureGenerator.widthTimes32(), 12);
            Span<i32> prevLine;
            Span<i32> currLine;
            Span<i32> nextLine;
            Status s = getMonochromeInput(textureGenerator, 0, (line - 1) & textureGenerator.heightMask(), &prevLine);
            if (!ok(s)) return s;
            s = getMonochromeInput(textureGenerator, 0, line, &currLine);
            if (!ok(s)) return s;
            s = getMonochromeInput(textureGenerator, 0, (line + 1) & textureGenerator.heightMask(), &nextLine);
            if (!ok(s)) return s;

            const Span<const i8> inv = textureGenerator.inverseSquareRootTable();
            const i32 w = textureGenerator.width();
            const i32 wMask = textureGenerator.widthMask();

            for (i32 pixel = 0; pixel < w; pixel++) {
                const i32 prevPixel = currLine[static_cast<std::size_t>((pixel - 1) & wMask)];
                const i32 nextPixel = currLine[static_cast<std::size_t>((pixel + 1) & wMask)];

                const i32 deltaY = javaSub(nextLine[static_cast<std::size_t>(pixel)], prevLine[static_cast<std::size_t>(pixel)]);
                const i32 deltaX = javaSub(prevPixel, nextPixel);
                const i32 gradY = javaMulShift(widthMult, deltaY, 12);
                const i32 gradX = javaMulShift(widthMult, deltaX, 12);

                i32 gradXAbs = gradX >> 4;
                i32 gradYAbs = gradY >> 4;
                if (gradXAbs < 0) gradXAbs = -gradXAbs;
                if (gradYAbs < 0) gradYAbs = -gradYAbs;
                if (gradXAbs > 255) gradXAbs = 255;
                if (gradYAbs > 255) gradYAbs = 255;

                const i32 invIdx = gradXAbs + (((gradYAbs + 1) * gradYAbs) >> 1);
                const u32 invMagnitude = (invIdx >= 0 && static_cast<std::size_t>(invIdx) < inv.size())
                    ? static_cast<u8>(inv[static_cast<std::size_t>(invIdx)])
                    : 0u;

                const i32 normalXQ12 = javaShr(javaMul(static_cast<i32>(invMagnitude), gradX), 8);
                const i32 normalYQ12 = javaShr(javaMul(static_cast<i32>(invMagnitude), gradY), 8);
                const i32 normalZQ12 = javaShr(javaMul(static_cast<i32>(invMagnitude), 4096), 8);

                const i32 lightDotXQ12 = javaMulShift(lightDirQ12_[0], normalXQ12, 12);
                const i32 lightDotYQ12 = javaMulShift(lightDirQ12_[1], normalYQ12, 12);
                const i32 lightDotZQ12 = javaMulShift(lightDirQ12_[2], normalZQ12, 12);

                lineOut[static_cast<std::size_t>(pixel)] = javaAdd(javaAdd(lightDotXQ12, lightDotYQ12), lightDotZQ12);
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 strengthQ12_ = 4096;
    i32 lightAzimuthQ12_ = 3216;
    i32 lightElevationQ12_ = 3216;
    i32 lightDirQ12_[3]{0, 0, 0};
};

} // namespace rs
