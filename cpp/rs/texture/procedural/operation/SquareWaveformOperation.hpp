#pragma once

#include <cstddef>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

enum class SquareWaveDirectionMode : u8 {
    Vertical = 0,
    Horizontal = 1,
    DiagonalSum = 2,
    DiagonalDifference = 3,
};

class SquareWaveformOperation final : public TextureOperationImpl<SquareWaveformOperation> {
public:
    SquareWaveformOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            periodCount_ = static_cast<i32>(v);
            tablesReady_ = false;
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            dutyCycleQ12_ = static_cast<i32>(v);
            tablesReady_ = false;
            return Status::Ok;
        }
        if (fieldId == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            directionMode_ = static_cast<SquareWaveDirectionMode>(v);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        Status s = TextureOperation::initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return s;
        }
        return ensureTables(alloc);
    }

    void clearCaches() noexcept override {
        TextureOperation::clearCaches();
        // Keep decoded tables; they depend only on decoded parameters.
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
            const i32 verticalGradient = textureGenerator.verticalGradient()[static_cast<std::size_t>(line)];
            const i32 width = textureGenerator.width();

            if (directionMode_ == SquareWaveDirectionMode::Vertical) {
                i32 outputValueQ12 = 0;
                for (i32 periodIndex = 0; periodIndex < periodCount_; periodIndex++) {
                    const i32 segStart = segmentStartQ12_[static_cast<std::size_t>(periodIndex)];
                    const i32 segEnd = segmentStartQ12_[static_cast<std::size_t>(periodIndex + 1)];
                    if (verticalGradient >= segStart && verticalGradient < segEnd) {
                        const i32 pulseEnd = pulseEndQ12_[static_cast<std::size_t>(periodIndex)];
                        if (verticalGradient < pulseEnd) {
                            outputValueQ12 = 4096;
                        }
                        break;
                    }
                }
                for (i32 x = 0; x < width; x++) {
                    lineOut[static_cast<std::size_t>(x)] = outputValueQ12;
                }
            } else {
                const Span<const i32> hGrad = static_cast<const TextureGenerator&>(textureGenerator).horizontalGradient();
                for (i32 pixel = 0; pixel < width; pixel++) {
                    i32 phaseQ12 = 0;
                    i32 outputValueQ12 = 0;
                    const i32 horizontalGradient = hGrad[static_cast<std::size_t>(pixel)];
                    switch (directionMode_) {
                    case SquareWaveDirectionMode::DiagonalDifference:
                        phaseQ12 = ((horizontalGradient - verticalGradient) >> 1) + 2048;
                        break;
                    case SquareWaveDirectionMode::DiagonalSum:
                        phaseQ12 = ((horizontalGradient - (4096 - verticalGradient)) >> 1) + 2048;
                        break;
                    case SquareWaveDirectionMode::Horizontal:
                        phaseQ12 = horizontalGradient;
                        break;
                    default:
                        phaseQ12 = verticalGradient;
                        break;
                    }

                    for (i32 periodIndex = 0; periodIndex < periodCount_; periodIndex++) {
                        const i32 segStart = segmentStartQ12_[static_cast<std::size_t>(periodIndex)];
                        const i32 segEnd = segmentStartQ12_[static_cast<std::size_t>(periodIndex + 1)];
                        if (phaseQ12 >= segStart && phaseQ12 < segEnd) {
                            const i32 pulseEnd = pulseEndQ12_[static_cast<std::size_t>(periodIndex)];
                            if (phaseQ12 < pulseEnd) {
                                outputValueQ12 = 4096;
                            }
                            break;
                        }
                    }

                    lineOut[static_cast<std::size_t>(pixel)] = outputValueQ12;
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 periodCount_ = 10;
    i32 dutyCycleQ12_ = 2048;
    SquareWaveDirectionMode directionMode_ = SquareWaveDirectionMode::Vertical;

    Vec<i32> pulseEndQ12_{};
    Vec<i32> segmentStartQ12_{};
    bool tablesReady_ = false;

    Status ensureTables(Allocator& alloc) noexcept {
        if (tablesReady_) {
            return Status::Ok;
        }
        if (periodCount_ <= 0 || periodCount_ > 255) {
            return Status::BadFormat;
        }

        pulseEndQ12_ = Vec<i32>(alloc);
        segmentStartQ12_ = Vec<i32>(alloc);

        const std::size_t n = static_cast<std::size_t>(periodCount_ + 1);
        auto rr = pulseEndQ12_.resize(n);
        if (!rr.isOk()) return rr.status();
        rr = segmentStartQ12_.resize(n);
        if (!rr.isOk()) return rr.status();

        i32 segmentStart = 0;
        const i32 segmentSizeQ12 = javaIDiv(4096, periodCount_);
        const i32 pulseWidthQ12 = javaMulShift(segmentSizeQ12, dutyCycleQ12_, 12);
        for (i32 periodIndex = 0; periodIndex < periodCount_; periodIndex++) {
            segmentStartQ12_[static_cast<std::size_t>(periodIndex)] = segmentStart;
            pulseEndQ12_[static_cast<std::size_t>(periodIndex)] = javaAdd(segmentStart, pulseWidthQ12);
            segmentStart = javaAdd(segmentStart, segmentSizeQ12);
        }
        segmentStartQ12_[static_cast<std::size_t>(periodCount_)] = 4096;
        pulseEndQ12_[static_cast<std::size_t>(periodCount_)] = javaAdd(pulseEndQ12_[0], 4096);

        tablesReady_ = true;
        return Status::Ok;
    }
};

} // namespace rs
