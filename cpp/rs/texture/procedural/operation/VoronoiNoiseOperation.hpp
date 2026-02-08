#pragma once

#include <cmath>
#include <cstddef>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../../../util/JavaRandom.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

enum class VoronoiOutputMode : u8 {
    Nearest = 0,
    SecondNearest = 1,
    SecondMinusNearest = 2,
    ThirdNearest = 3,
    FourthNearest = 4,
};

class VoronoiNoiseOperation final : public TextureOperationImpl<VoronoiNoiseOperation> {
public:
    VoronoiNoiseOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            repeatX_ = static_cast<i32>(v);
            repeatY_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            seed_ = static_cast<i32>(v);
            offsetsReady_ = false;
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            featurePointJitterQ12_ = static_cast<i32>(v);
            offsetsReady_ = false;
            return Status::Ok;
        }
        if (fieldId == 3) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            outputMode_ = static_cast<VoronoiOutputMode>(v);
            return Status::Ok;
        }
        if (fieldId == 4) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            distanceMetric_ = static_cast<i32>(v);
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
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        Status s = TextureOperation::initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return s;
        }
        s = textureGenerator.getPermutations(seed_, &permutations_);
        if (!ok(s)) {
            return s;
        }
        return ensureFeaturePointOffsets(alloc);
    }

    void clearCaches() noexcept override {
        TextureOperation::clearCaches();
        permutations_ = Span<const i8>(nullptr, 0);
        // Keep decoded feature offsets.
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
            const i32 yCoordQ12 = 2048 + repeatY_ * textureGenerator.verticalGradient()[static_cast<std::size_t>(line)];
            const i32 cellY = yCoordQ12 >> 12;
            const i32 cellYNext = cellY + 1;

            const Span<const i32> hGrad = static_cast<const TextureGenerator&>(textureGenerator).horizontalGradient();
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());

            for (std::size_t pixel = 0; pixel < w; pixel++) {
                i32 nearest = 2147483647;
                i32 secondNearest = 2147483647;
                i32 thirdNearest = 2147483647;
                i32 fourthNearest = 2147483647;

                const i32 xCoordQ12 = repeatX_ * hGrad[pixel] + 2048;
                const i32 cellX = xCoordQ12 >> 12;
                const i32 cellXNext = cellX + 1;

                for (i32 yNeighbor = cellY - 1; yNeighbor <= cellYNext; yNeighbor++) {
                    const i32 yWrap = (yNeighbor >= repeatY_) ? (yNeighbor - repeatY_) : yNeighbor;
                    const u32 yPermIdx = static_cast<u32>(yWrap) & 0xFFu;
                    const u32 yPerm = static_cast<u32>(permutations_[static_cast<std::size_t>(yPermIdx)]) & 0xFFu;

                    for (i32 xNeighbor = cellX - 1; xNeighbor <= cellXNext; xNeighbor++) {
                        const i32 xWrap = (xNeighbor >= repeatX_) ? (xNeighbor - repeatX_) : xNeighbor;
                        const u32 xIdx = (static_cast<u32>(xWrap) + yPerm) & 0xFFu;
                        const u32 p = static_cast<u32>(permutations_[static_cast<std::size_t>(xIdx)]) & 0xFFu;
                        std::size_t featureIndex = static_cast<std::size_t>(p * 2u);

                        i32 dxQ12 = xCoordQ12 - (static_cast<i32>(featurePointOffsetsQ12_[featureIndex++]) + (xNeighbor << 12));
                        i32 dyQ12 = yCoordQ12 - (static_cast<i32>(featurePointOffsetsQ12_[featureIndex]) + (yNeighbor << 12));

                        const i32 distQ12 = computeDistanceQ12(dxQ12, dyQ12);

                        if (distQ12 < nearest) {
                            fourthNearest = thirdNearest;
                            thirdNearest = secondNearest;
                            secondNearest = nearest;
                            nearest = distQ12;
                        } else if (distQ12 < secondNearest) {
                            fourthNearest = thirdNearest;
                            thirdNearest = secondNearest;
                            secondNearest = distQ12;
                        } else if (distQ12 < thirdNearest) {
                            fourthNearest = thirdNearest;
                            thirdNearest = distQ12;
                        } else if (distQ12 < fourthNearest) {
                            fourthNearest = distQ12;
                        }
                    }
                }

                switch (outputMode_) {
                case VoronoiOutputMode::Nearest:
                    lineOut[pixel] = nearest;
                    break;
                case VoronoiOutputMode::SecondNearest:
                    lineOut[pixel] = secondNearest;
                    break;
                case VoronoiOutputMode::SecondMinusNearest:
                    lineOut[pixel] = secondNearest - nearest;
                    break;
                case VoronoiOutputMode::ThirdNearest:
                    lineOut[pixel] = thirdNearest;
                    break;
                case VoronoiOutputMode::FourthNearest:
                    lineOut[pixel] = fourthNearest;
                    break;
                default:
                    lineOut[pixel] = secondNearest - nearest;
                    break;
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 seed_ = 0;
    i32 featurePointJitterQ12_ = 2048;
    VoronoiOutputMode outputMode_ = VoronoiOutputMode::SecondMinusNearest;
    i32 distanceMetric_ = 1;
    i32 repeatX_ = 5;
    i32 repeatY_ = 5;

    Span<const i8> permutations_{nullptr, 0};
    Vec<i16> featurePointOffsetsQ12_{};
    bool offsetsReady_ = false;

    Status ensureFeaturePointOffsets(Allocator& alloc) noexcept {
        if (offsetsReady_) {
            return Status::Ok;
        }
        featurePointOffsetsQ12_ = Vec<i16>(alloc);
        auto rr = featurePointOffsetsQ12_.resize(512);
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < 512; i++) {
            featurePointOffsetsQ12_[i] = 0;
        }
        if (featurePointJitterQ12_ > 0) {
            JavaRandom random(static_cast<u64>(seed_));
            for (std::size_t i = 0; i < 512; i++) {
                featurePointOffsetsQ12_[i] = static_cast<i16>(nextIntJagex(random, featurePointJitterQ12_));
            }
        }
        offsetsReady_ = true;
        return Status::Ok;
    }

    i32 computeDistanceQ12(i32 dxQ12, i32 dyQ12) const noexcept {
        switch (distanceMetric_) {
        case 1: {
            const i64 dx = static_cast<i64>(dxQ12);
            const i64 dy = static_cast<i64>(dyQ12);
            return static_cast<i32>(((dx * dx) + (dy * dy)) >> 12);
        }
        case 2: {
            const i32 ax = (dxQ12 < 0) ? -dxQ12 : dxQ12;
            const i32 ay = (dyQ12 < 0) ? -dyQ12 : dyQ12;
            return ax + ay;
        }
        case 3: {
            const i32 ax = (dxQ12 < 0) ? -dxQ12 : dxQ12;
            const i32 ay = (dyQ12 < 0) ? -dyQ12 : dyQ12;
            return (ax > ay) ? ax : ay;
        }
        case 4: {
            const float ax = static_cast<float>((dxQ12 < 0) ? -dxQ12 : dxQ12) / 4096.0f;
            const float ay = static_cast<float>((dyQ12 < 0) ? -dyQ12 : dyQ12) / 4096.0f;
            const i32 sx = static_cast<i32>(std::sqrt(ax) * 4096.0f);
            const i32 sy = static_cast<i32>(std::sqrt(ay) * 4096.0f);
            const i32 sum = javaAdd(sx, sy);
            return javaMulShift(sum, sum, 12);
        }
        case 5: {
            const i64 dx = static_cast<i64>(dxQ12);
            const i64 dy = static_cast<i64>(dyQ12);
            const i64 v = (dx * dx) + (dy * dy);
            const float f = static_cast<float>(v) / 16777216.0f;
            const float r = std::sqrt(std::sqrt(f)) * 4096.0f;
            return static_cast<i32>(r);
        }
        default: {
            const i64 dx = static_cast<i64>(dxQ12);
            const i64 dy = static_cast<i64>(dyQ12);
            const i64 v = (dx * dx) + (dy * dy);
            const float f = static_cast<float>(v) / 16777216.0f;
            const float r = std::sqrt(f) * 4096.0f;
            return static_cast<i32>(r);
        }
        }
    }
};

} // namespace rs
