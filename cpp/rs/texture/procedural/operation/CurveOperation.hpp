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

class CurveOperation final : public TextureOperationImpl<CurveOperation> {
public:
    CurveOperation() noexcept : TextureOperationImpl(1, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        if (fieldId != 0) {
            return Status::Ok;
        }

        u8 mode = 0;
        u8 pointCountU8 = 0;
        Status s = reader.readUnsignedByte(&mode);
        if (!ok(s)) {
            return s;
        }
        s = reader.readUnsignedByte(&pointCountU8);
        if (!ok(s)) {
            return s;
        }
        interpolationMode_ = mode;

        const i32 pointCount = static_cast<i32>(pointCountU8);
        if (pointCount <= 0) {
            controlPoints_.clear();
            return Status::Ok;
        }

        controlPoints_ = Vec<ControlPoint>(alloc);
        auto rr = controlPoints_.resize(static_cast<std::size_t>(pointCount));
        if (!rr.isOk()) {
            return rr.status();
        }

        for (i32 i = 0; i < pointCount; i++) {
            u16 x = 0;
            u16 y = 0;
            s = reader.readUnsignedShort(&x);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&y);
            if (!ok(s)) {
                return s;
            }
            controlPoints_[static_cast<std::size_t>(i)] = ControlPoint{static_cast<i32>(x), static_cast<i32>(y)};
        }

        return Status::Ok;
    }

    Status init() noexcept override {
        // TS default: if missing, use identity curve.
        if (controlPoints_.size() == 0) {
            buildIdentityLookupTable();
            return Status::Ok;
        }
        if (controlPoints_.size() < 2) {
            return Status::BadFormat;
        }

        if (interpolationMode_ == 2) {
            computeExtrapolatedEndpoints();
        }
        buildLookupTable();
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
            Span<i32> input;
            Status s = getMonochromeInput(textureGenerator, 0, line, &input);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                i32 v = javaIDiv(input[i], 16);
                if (v < 0) {
                    v = 0;
                }
                if (v > 256) {
                    v = 256;
                }
                lineOut[i] = static_cast<i32>(lookupTable_[static_cast<std::size_t>(v)]);
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    struct ControlPoint final {
        i32 x = 0;
        i32 y = 0;
    };

    u8 interpolationMode_ = 0; // 0 linear, 1 cosine, 2 cubic
    Vec<ControlPoint> controlPoints_{};

    ControlPoint extrapolatedStart_{};
    ControlPoint extrapolatedEnd_{};

    i16 lookupTable_[257]{};

    void buildIdentityLookupTable() noexcept {
        for (i32 i = 0; i < 257; i++) {
            // Identity: output = inputQ12 (index*16).
            lookupTable_[static_cast<std::size_t>(i)] = static_cast<i16>(i * 16);
        }
    }

    void computeExtrapolatedEndpoints() noexcept {
        const ControlPoint first = controlPoints_[0];
        const ControlPoint second = controlPoints_[1];
        const ControlPoint secondLast = controlPoints_[controlPoints_.size() - 2];
        const ControlPoint last = controlPoints_[controlPoints_.size() - 1];

        extrapolatedStart_.x = first.x + first.x - second.x;
        extrapolatedStart_.y = first.y - second.y + first.y;

        extrapolatedEnd_.x = secondLast.x - last.x + secondLast.x;
        extrapolatedEnd_.y = secondLast.y - last.y + secondLast.y;
    }

    ControlPoint getControlPoint(i32 index) const noexcept {
        if (index < 0) {
            return extrapolatedStart_;
        }
        const std::size_t idx = static_cast<std::size_t>(index);
        if (idx >= controlPoints_.size()) {
            return extrapolatedEnd_;
        }
        return controlPoints_[idx];
    }

    static inline i32 clampI32(i32 v, i32 lo, i32 hi) noexcept {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }

    void buildLookupTable() noexcept {
        if (interpolationMode_ == 2) {
            // Cubic.
            for (i32 index = 0; index < 257; index++) {
                const i32 inputQ12 = index * 16;
                i32 segmentIndex = 1;
                for (; segmentIndex < static_cast<i32>(controlPoints_.size()) - 1; segmentIndex++) {
                    if (controlPoints_[static_cast<std::size_t>(segmentIndex)].x > inputQ12) {
                        break;
                    }
                }
                const ControlPoint prev = controlPoints_[static_cast<std::size_t>(segmentIndex - 1)];
                const ControlPoint next = controlPoints_[static_cast<std::size_t>(segmentIndex)];
                const i32 yPrevPrev = getControlPoint(segmentIndex - 2).y;
                const i32 yPrev = prev.y;
                const i32 yNext = next.y;
                const i32 yNextNext = getControlPoint(segmentIndex + 1).y;

                const i32 denom = next.x - prev.x;
                const i32 tQ12 = denom != 0 ? javaIDiv(javaShl(inputQ12 - prev.x, 12), denom) : 0;
                const i32 tSquaredQ12 = javaMulShift(tQ12, tQ12, 12);

                const i32 coefA = yPrev - yPrevPrev + (yNextNext - yNext);
                const i32 coefB = yPrevPrev - yPrev - coefA;
                const i32 coefC = yNext - yPrevPrev;
                const i32 coefD = yPrev;

                const i32 tTimesA_Q12 = javaMulShift(tQ12, coefA, 12);
                const i32 cubicTerm = javaMulShift(tSquaredQ12, tTimesA_Q12, 12);
                const i32 quadraticTerm = javaMulShift(tSquaredQ12, coefB, 12);
                const i32 linearTerm = javaMulShift(tQ12, coefC, 12);

                i32 out = javaAdd(javaAdd(javaAdd(linearTerm, cubicTerm), quadraticTerm), coefD);
                out = clampI32(out, -32767, 32767);
                lookupTable_[static_cast<std::size_t>(index)] = static_cast<i16>(out);
            }
            return;
        }

        if (interpolationMode_ == 1) {
            // Cosine.
            TextureGenerator tmp;
            const Span<const i32> cosine = tmp.cosineTableQ12();

            for (i32 index = 0; index < 257; index++) {
                const i32 inputQ12 = index * 16;
                i32 segmentIndex = 1;
                for (; segmentIndex < static_cast<i32>(controlPoints_.size()) - 1; segmentIndex++) {
                    if (controlPoints_[static_cast<std::size_t>(segmentIndex)].x > inputQ12) {
                        break;
                    }
                }
                const ControlPoint prev = controlPoints_[static_cast<std::size_t>(segmentIndex - 1)];
                const ControlPoint next = controlPoints_[static_cast<std::size_t>(segmentIndex)];

                const i32 denom = next.x - prev.x;
                const i32 tQ12 = denom != 0 ? javaIDiv(javaShl(inputQ12 - prev.x, 12), denom) : 0;

                const i32 tableIdx = javaIDiv((tQ12 & 8187), 32);
                const i32 nextWeightQ12 =
                    javaIDiv(4096 - cosine[static_cast<std::size_t>(tableIdx)], 2);
                const i32 prevWeightQ12 = 4096 - nextWeightQ12;

                i32 out = javaIDiv(prevWeightQ12 * prev.y + next.y * nextWeightQ12, 4096);
                out = clampI32(out, -32767, 32767);
                lookupTable_[static_cast<std::size_t>(index)] = static_cast<i16>(out);
            }
            return;
        }

        // Linear.
        for (i32 index = 0; index < 257; index++) {
            const i32 inputQ12 = index * 16;
            i32 segmentIndex = 1;
            for (; segmentIndex < static_cast<i32>(controlPoints_.size()) - 1; segmentIndex++) {
                if (controlPoints_[static_cast<std::size_t>(segmentIndex)].x > inputQ12) {
                    break;
                }
            }
            const ControlPoint prev = controlPoints_[static_cast<std::size_t>(segmentIndex - 1)];
            const ControlPoint next = controlPoints_[static_cast<std::size_t>(segmentIndex)];

            const i32 denom = next.x - prev.x;
            const i32 nextWeightQ12 = denom != 0 ? javaIDiv(javaShl(inputQ12 - prev.x, 12), denom) : 0;
            const i32 prevWeightQ12 = 4096 - nextWeightQ12;

            i32 out = javaIDiv(prevWeightQ12 * prev.y + next.y * nextWeightQ12, 4096);
            out = clampI32(out, -32767, 32767);
            lookupTable_[static_cast<std::size_t>(index)] = static_cast<i16>(out);
        }
    }
};

} // namespace rs
