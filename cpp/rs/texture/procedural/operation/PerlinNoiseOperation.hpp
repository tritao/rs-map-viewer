#pragma once

#include <cstddef>
#include <cmath>

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

class PerlinNoiseOperation final : public TextureOperationImpl<PerlinNoiseOperation> {
public:
    PerlinNoiseOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            unsignedOutput_ = (v == 1);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            octaveCount_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            i16 v = 0;
            Status s = reader.readShort(&v);
            if (!ok(s)) return s;
            persistenceQ12_ = static_cast<i32>(v);
            if (persistenceQ12_ < 0) {
                amplitudeByOctaveQ12_ = Vec<i16>(alloc);
                auto rr = amplitudeByOctaveQ12_.resize(static_cast<std::size_t>(octaveCount_));
                if (!rr.isOk()) return rr.status();
                for (i32 i = 0; i < octaveCount_; i++) {
                    i16 a = 0;
                    s = reader.readShort(&a);
                    if (!ok(s)) return s;
                    amplitudeByOctaveQ12_[static_cast<std::size_t>(i)] = a;
                }
            }
            return Status::Ok;
        }
        if (fieldId == 3) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            repeatX_ = static_cast<i32>(v);
            repeatY_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 4) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            seed_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 5) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            repeatX_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 6) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            repeatY_ = static_cast<i32>(v);
            return Status::Ok;
        }
        (void)alloc;
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        Status s = TextureOperation::initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return s;
        }
        s = ensureNoiseInput(alloc);
        if (!ok(s)) {
            return s;
        }
        s = textureGenerator.getPermutations(seed_, &permutations_);
        if (!ok(s)) {
            return s;
        }
        return Status::Ok;
    }

    void clearCaches() noexcept override {
        TextureOperation::clearCaches();
        // Keep decoded arrays; clear only per-render references.
        permutations_ = Span<const i8>(nullptr, 0);
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
            renderNoiseLine(textureGenerator, line, lineOut);
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    bool unsignedOutput_ = true;
    i32 octaveCount_ = 4;
    i32 persistenceQ12_ = 1638;
    i32 seed_ = 0;
    i32 repeatX_ = 4;
    i32 repeatY_ = 4;

    Vec<i16> amplitudeByOctaveQ12_{};
    Vec<i16> frequencyByOctave_{};
    bool noiseInputReady_ = false;

    Span<const i8> permutations_{nullptr, 0};

    static Span<const i32> fadeTableQ12() noexcept {
        static i32 table[4096];
        static bool ready = false;
        if (!ready) {
            for (i32 i = 0; i < 4096; i++) {
                const i32 iiQ12 = javaMulShift(i, i, 12);
                const i32 nCubedQ12 = javaMulShift(iiQ12, i, 12);
                const i32 sixNMinus15Q12 = javaSub(javaMul(i, 6), 61440);
                const i32 innerQ12 = javaAdd(40960, javaMulShift(i, sixNMinus15Q12, 12));
                table[i] = javaMulShift(nCubedQ12, innerQ12, 12);
            }
            ready = true;
        }
        return Span<const i32>(table, 4096);
    }

    Status ensureNoiseInput(Allocator& alloc) noexcept {
        if (noiseInputReady_) {
            return Status::Ok;
        }
        if (octaveCount_ <= 0 || octaveCount_ > 64) {
            return Status::BadFormat;
        }

        if (persistenceQ12_ > 0) {
            amplitudeByOctaveQ12_ = Vec<i16>(alloc);
            frequencyByOctave_ = Vec<i16>(alloc);

            auto rr = amplitudeByOctaveQ12_.resize(static_cast<std::size_t>(octaveCount_));
            if (!rr.isOk()) return rr.status();
            rr = frequencyByOctave_.resize(static_cast<std::size_t>(octaveCount_));
            if (!rr.isOk()) return rr.status();

            const float pF = static_cast<float>(static_cast<double>(persistenceQ12_) / 4096.0);
            const double p = static_cast<double>(pF);
            for (i32 i = 0; i < octaveCount_; i++) {
                const double a = std::pow(p, static_cast<double>(i)) * 4096.0;
                amplitudeByOctaveQ12_[static_cast<std::size_t>(i)] = static_cast<i16>(static_cast<i32>(a));
                frequencyByOctave_[static_cast<std::size_t>(i)] = static_cast<i16>(1 << i);
            }
        } else {
            // Explicit amplitudes are encoded when persistenceQ12_ < 0.
            if (amplitudeByOctaveQ12_.size() != static_cast<std::size_t>(octaveCount_)) {
                return Status::BadFormat;
            }
            frequencyByOctave_ = Vec<i16>(alloc);
            auto rr = frequencyByOctave_.resize(static_cast<std::size_t>(octaveCount_));
            if (!rr.isOk()) return rr.status();
            for (i32 i = 0; i < octaveCount_; i++) {
                frequencyByOctave_[static_cast<std::size_t>(i)] = static_cast<i16>(1 << i);
            }
        }

        // Trim trailing near-zero amplitudes (mirrors TS).
        for (i32 i = octaveCount_ - 1; i >= 1; i--) {
            const i16 v = amplitudeByOctaveQ12_[static_cast<std::size_t>(i)];
            if (v > 8 || v < -8) {
                break;
            }
            octaveCount_--;
        }

        noiseInputReady_ = true;
        return Status::Ok;
    }

    static inline i32 sampleNoise2D(
        Span<const i8> permutations,
        i32 xCoord,
        i32 xWrap,
        i32 permY0,
        i32 permY1,
        i32 yFrac,
        i32 fadeY) noexcept {
        const Span<const i32> fade = fadeTableQ12();

        i32 xCell = xCoord >> 12;
        i32 xCellNext = xCell + 1;
        xCoord &= 0xFFF;
        if (xCellNext >= xWrap) {
            xCellNext = 0;
        }
        xCell &= 0xFF;
        xCellNext &= 0xFF;

        const i32 yFracMinusOne = yFrac - 4096;
        const i32 xFracMinusOne = xCoord - 4096;

        i32 gradIndex = static_cast<u8>(permutations[static_cast<std::size_t>(permY0 + xCell)]) & 0x3;
        const i32 fadeX = fade[static_cast<std::size_t>(xCoord)];

        i32 dot00 = 0;
        if (gradIndex > 1) {
            dot00 = gradIndex == 2 ? (-yFrac + xCoord) : (-yFrac + -xCoord);
        } else {
            dot00 = gradIndex == 0 ? (yFrac + xCoord) : (-xCoord + yFrac);
        }

        gradIndex = static_cast<u8>(permutations[static_cast<std::size_t>(permY0 + xCellNext)]) & 0x3;
        i32 dot01 = 0;
        if (gradIndex <= 1) {
            dot01 = gradIndex == 0 ? (yFrac + xFracMinusOne) : (yFrac - xFracMinusOne);
        } else {
            dot01 = gradIndex == 2 ? (xFracMinusOne - yFrac) : (-xFracMinusOne + -yFrac);
        }

        const i32 interpTop = javaAdd(javaMulShift(fadeX, javaSub(dot01, dot00), 12), dot00);

        gradIndex = static_cast<u8>(permutations[static_cast<std::size_t>(permY1 + xCell)]) & 0x3;
        if (gradIndex <= 1) {
            dot00 = gradIndex != 0 ? (yFracMinusOne - xCoord) : (xCoord + yFracMinusOne);
        } else {
            dot00 = gradIndex != 2 ? (-yFracMinusOne + -xCoord) : (xCoord - yFracMinusOne);
        }

        gradIndex = static_cast<u8>(permutations[static_cast<std::size_t>(xCellNext + permY1)]) & 0x3;
        if (gradIndex <= 1) {
            dot01 = gradIndex == 0 ? (xFracMinusOne + yFracMinusOne) : (yFracMinusOne - xFracMinusOne);
        } else {
            dot01 = gradIndex == 2 ? (-yFracMinusOne + xFracMinusOne) : (-yFracMinusOne + -xFracMinusOne);
        }

        const i32 interpBottom = javaAdd(dot00, javaMulShift(fadeX, javaSub(dot01, dot00), 12));
        return javaAdd(interpTop, javaMulShift(fadeY, javaSub(interpBottom, interpTop), 12));
    }

    void renderNoiseLine(TextureGenerator& textureGenerator, i32 line, Span<i32> output) noexcept {
        if (permutations_.size() < 512) {
            for (std::size_t i = 0; i < output.size(); i++) {
                output[i] = 0;
            }
            return;
        }

        const Span<const i32> fade = fadeTableQ12();
        const i32 vGrad = javaMul(repeatY_, textureGenerator.verticalGradient()[static_cast<std::size_t>(line)]);

        const i32 width = textureGenerator.width();

        if (octaveCount_ == 1) {
            const i32 amplitude = amplitudeByOctaveQ12_[0];
            const i32 freq12 = static_cast<i32>(frequencyByOctave_[0]) << 12;
            const i32 xWrap = javaMulShift(freq12, repeatX_, 12);
            const i32 yWrap = javaMulShift(freq12, repeatY_, 12);
            i32 yCoord = javaMulShift(freq12, vGrad, 12);
            const i32 permIndex0 = yCoord >> 12;
            i32 permIndex1 = permIndex0 + 1;
            if (yWrap <= permIndex1) {
                permIndex1 = 0;
            }
            yCoord &= 0xFFF;
            const i32 fadeY = fade[static_cast<std::size_t>(yCoord)];
            const i32 perm0 = static_cast<u8>(permutations_[static_cast<std::size_t>(permIndex0 & 0xFF)]);
            const i32 perm1 = static_cast<u8>(permutations_[static_cast<std::size_t>(permIndex1 & 0xFF)]);

            if (unsignedOutput_) {
                for (i32 pixel = 0; pixel < width; pixel++) {
                    const i32 hGrad = javaMul(repeatX_, textureGenerator.horizontalGradient()[static_cast<std::size_t>(pixel)]);
                    i32 v = sampleNoise2D(permutations_, javaMulShift(freq12, hGrad, 12), xWrap, perm0, perm1, yCoord, fadeY);
                    v = javaMulShift(amplitude, v, 12);
                    output[static_cast<std::size_t>(pixel)] = (v >> 1) + 2048;
                }
            } else {
                for (i32 pixel = 0; pixel < width; pixel++) {
                    const i32 hGrad = javaMul(repeatX_, textureGenerator.horizontalGradient()[static_cast<std::size_t>(pixel)]);
                    const i32 v = sampleNoise2D(permutations_, javaMulShift(freq12, hGrad, 12), xWrap, perm0, perm1, yCoord, fadeY);
                    output[static_cast<std::size_t>(pixel)] = javaMulShift(v, amplitude, 12);
                }
            }
            return;
        }

        i32 amplitude0 = amplitudeByOctaveQ12_[0];
        if (amplitude0 > 8 || amplitude0 < -8) {
            const i32 freq12 = static_cast<i32>(frequencyByOctave_[0]) << 12;
            i32 yCoord = javaMulShift(freq12, vGrad, 12);
            const i32 xWrap = javaMulShift(freq12, repeatX_, 12);
            const i32 yWrap = javaMulShift(freq12, repeatY_, 12);
            const i32 yCell = yCoord >> 12;
            i32 yCellNext = yCell + 1;
            yCoord &= 0xFFF;
            if (yWrap <= yCellNext) {
                yCellNext = 0;
            }
            const i32 permY0 = static_cast<u8>(permutations_[static_cast<std::size_t>(yCell & 0xFF)]);
            const i32 permY1 = static_cast<u8>(permutations_[static_cast<std::size_t>(yCellNext & 0xFF)]);
            const i32 fadeY = fade[static_cast<std::size_t>(yCoord)];
            for (i32 pixel = 0; pixel < width; pixel++) {
                const i32 xBase = javaMul(repeatX_, textureGenerator.horizontalGradient()[static_cast<std::size_t>(pixel)]);
                const i32 v = sampleNoise2D(permutations_, javaMulShift(xBase, freq12, 12), xWrap, permY0, permY1, yCoord, fadeY);
                output[static_cast<std::size_t>(pixel)] = javaMulShift(amplitude0, v, 12);
            }
        }

        for (i32 octave = 1; octave < octaveCount_; octave++) {
            const i32 amplitude = amplitudeByOctaveQ12_[static_cast<std::size_t>(octave)];
            if (amplitude <= 8 && amplitude >= -8) {
                continue;
            }
            const i32 freq12 = static_cast<i32>(frequencyByOctave_[static_cast<std::size_t>(octave)]) << 12;
            const i32 yWrap = javaMulShift(repeatY_, freq12, 12);
            const i32 xWrap = javaMulShift(repeatX_, freq12, 12);
            i32 yCoord = javaMulShift(vGrad, freq12, 12);
            const i32 yCell = yCoord >> 12;
            i32 yCellNext = yCell + 1;
            yCoord &= 0xFFF;
            if (yWrap <= yCellNext) {
                yCellNext = 0;
            }
            const i32 permY1 = static_cast<u8>(permutations_[static_cast<std::size_t>(yCellNext & 0xFF)]);
            const i32 permY0 = static_cast<u8>(permutations_[static_cast<std::size_t>(yCell & 0xFF)]);
            const i32 fadeY = fade[static_cast<std::size_t>(yCoord)];

            if (unsignedOutput_ && (octaveCount_ - 1) == octave) {
                for (i32 pixel = 0; pixel < width; pixel++) {
                    const i32 xBase = javaMul(textureGenerator.horizontalGradient()[static_cast<std::size_t>(pixel)], repeatX_);
                    i32 v = sampleNoise2D(permutations_, javaMulShift(freq12, xBase, 12), xWrap, permY0, permY1, yCoord, fadeY);
                    v = javaAdd(output[static_cast<std::size_t>(pixel)], javaMulShift(v, amplitude, 12));
                    output[static_cast<std::size_t>(pixel)] = 2048 + (v >> 1);
                }
            } else {
                for (i32 pixel = 0; pixel < width; pixel++) {
                    const i32 xBase = javaMul(textureGenerator.horizontalGradient()[static_cast<std::size_t>(pixel)], repeatX_);
                    const i32 v = sampleNoise2D(permutations_, javaMulShift(freq12, xBase, 12), xWrap, permY0, permY1, yCoord, fadeY);
                    output[static_cast<std::size_t>(pixel)] = javaAdd(output[static_cast<std::size_t>(pixel)], javaMulShift(amplitude, v, 12));
                }
            }
        }
    }
};

} // namespace rs
