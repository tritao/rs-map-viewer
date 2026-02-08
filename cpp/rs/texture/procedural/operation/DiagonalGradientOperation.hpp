#pragma once

#include <cmath>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

enum class DiagonalGradientDistanceMode : u8 {
    DiagonalDifference = 0,
    RadialDistance = 1,
};

enum class DiagonalGradientWaveformMode : u8 {
    Sine = 0,
    Sawtooth = 1,
    Triangle = 2,
};

class DiagonalGradientOperation final : public TextureOperationImpl<DiagonalGradientOperation> {
public:
    DiagonalGradientOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            distanceMode_ = static_cast<DiagonalGradientDistanceMode>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            waveformMode_ = static_cast<DiagonalGradientWaveformMode>(v);
            return Status::Ok;
        }
        if (fieldId == 3) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            frequency_ = static_cast<i32>(v);
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
            const i32 yCenteredHalfQ12 = (yQ12 - 2048) >> 1;
            const Span<const i32> sine = textureGenerator.sineTableQ12();

            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const i32 xQ12 = hg[static_cast<std::size_t>(x)];
                const i32 xCenteredHalfQ12 = (xQ12 - 2048) >> 1;
                i32 phaseQ12 = 0;
                if (distanceMode_ == DiagonalGradientDistanceMode::DiagonalDifference) {
                    phaseQ12 = javaMul(javaSub(xQ12, yQ12), frequency_);
                } else {
                    const i32 radiusSqQ12 = javaShr(
                        javaAdd(javaMul(yCenteredHalfQ12, yCenteredHalfQ12), javaMul(xCenteredHalfQ12, xCenteredHalfQ12)), 12);
                    const double r = std::sqrt(static_cast<double>(radiusSqQ12) / 4096.0);
                    phaseQ12 = static_cast<i32>(4096.0 * r);
                    phaseQ12 = static_cast<i32>(static_cast<double>(frequency_) * static_cast<double>(phaseQ12) * 3.141592653589793);
                }
                phaseQ12 -= phaseQ12 & ~0xFFF;
                if (waveformMode_ == DiagonalGradientWaveformMode::Sine) {
                    phaseQ12 = javaShr(javaAdd(sine[static_cast<std::size_t>((phaseQ12 >> 4) & 0xFF)], 4096), 1);
                } else if (waveformMode_ == DiagonalGradientWaveformMode::Triangle) {
                    phaseQ12 -= 2048;
                    if (phaseQ12 < 0) {
                        phaseQ12 = -phaseQ12;
                    }
                    phaseQ12 = (2048 - phaseQ12) << 1;
                }
                lineOut[static_cast<std::size_t>(x)] = phaseQ12;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    DiagonalGradientDistanceMode distanceMode_ = DiagonalGradientDistanceMode::DiagonalDifference;
    DiagonalGradientWaveformMode waveformMode_ = DiagonalGradientWaveformMode::Sine;
    i32 frequency_ = 1;
};

} // namespace rs
