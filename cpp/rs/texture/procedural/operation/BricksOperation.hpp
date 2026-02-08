#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../../../util/JavaRandom.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class BricksOperation final : public TextureOperationImpl<BricksOperation> {
public:
    BricksOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            columns_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            rowCount_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            widthJitterQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 3) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            heightJitterQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 4) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            rowStaggerQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 5) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            yOffsetQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 6) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            mortarThicknessQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 7) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            brickValueVariationQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status init() noexcept override {
        // Allocate arrays in initCaches() where we have an allocator.
        // This mirrors TS's behaviour but keeps allocator plumbing consistent.
        halfMortarThicknessQ12_ = javaIDiv(mortarThicknessQ12_, 2);
        xStepQ12_ = (columns_ > 0) ? javaIDiv(4096, columns_) : 0;
        yStepQ12_ = (rowCount_ > 0) ? javaIDiv(4096, rowCount_) : 0;
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        Status s = TextureOperation::initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return s;
        }
        return initTables(alloc);
    }

    void clearCaches() noexcept override {
        TextureOperation::clearCaches();
        // Keep tables; they are stable and expensive to recompute.
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
            if (static_cast<std::size_t>(line) >= vg.size()) {
                *out = Span<i32>(nullptr, 0);
                return Status::OutOfRange;
            }

            i32 rowIndex = 0;
            i32 yCoord = yOffsetQ12_ + vg[static_cast<std::size_t>(line)];
            while (yCoord < 0) yCoord += 4096;
            while (yCoord > 4096) yCoord -= 4096;
            for (; rowIndex < rowCount_; rowIndex++) {
                if (yCoord < yBoundaries_[static_cast<std::size_t>(rowIndex)]) {
                    break;
                }
            }

            const i32 rowStartY = yBoundaries_[static_cast<std::size_t>(rowIndex - 1)];
            const i32 rowEndY = yBoundaries_[static_cast<std::size_t>(rowIndex)];
            const i32 w = textureGenerator.width();

            if (yCoord > halfMortarThicknessQ12_ + rowStartY && yCoord < rowEndY - halfMortarThicknessQ12_) {
                const Span<i32> hg = textureGenerator.horizontalGradient();
                for (i32 pixel = 0; pixel < w; pixel++) {
                    const i32 stagger = ((rowIndex % 2) != 0) ? -rowStaggerQ12_ : rowStaggerQ12_;
                    i32 colIndex = 0;
                    i32 xCoord = javaMulShift(xStepQ12_, stagger, 12) + hg[static_cast<std::size_t>(pixel)];
                    while (xCoord < 0) xCoord += 4096;
                    while (xCoord > 4096) xCoord -= 4096;
                    const i32 rowSlot = rowIndex - 1;
                    for (; colIndex < columns_; colIndex++) {
                        if (xCoord < xBoundary(rowSlot, colIndex)) {
                            break;
                        }
                    }
                    const i32 colStartX = xBoundary(rowSlot, colIndex - 1);
                    const i32 colEndX = xBoundary(rowSlot, colIndex);
                    if (colStartX + halfMortarThicknessQ12_ < xCoord && xCoord < colEndX - halfMortarThicknessQ12_) {
                        lineOut[static_cast<std::size_t>(pixel)] = brickValue(rowSlot, colIndex - 1);
                    } else {
                        lineOut[static_cast<std::size_t>(pixel)] = 0;
                    }
                }
            } else {
                for (i32 pixel = 0; pixel < w; pixel++) {
                    lineOut[static_cast<std::size_t>(pixel)] = 0;
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 columns_ = 4;
    i32 rowCount_ = 8;
    i32 widthJitterQ12_ = 409;
    i32 heightJitterQ12_ = 204;
    i32 rowStaggerQ12_ = 1024;
    i32 yOffsetQ12_ = 0;
    i32 mortarThicknessQ12_ = 81;
    i32 brickValueVariationQ12_ = 1024;

    i32 halfMortarThicknessQ12_ = 0;
    i32 xStepQ12_ = 0;
    i32 yStepQ12_ = 0;

    // Tables (flat arrays):
    // brickValueByRowCol_[row*columns + col]
    Vec<i32> brickValueByRowCol_{};
    // xBoundariesByRow_[row*(columns+1) + boundaryIdx]
    Vec<i32> xBoundariesByRow_{};
    // yBoundaries_[rowIdx]
    Vec<i32> yBoundaries_{};

    [[nodiscard]] inline i32 brickValue(i32 row, i32 col) const noexcept {
        const std::size_t idx =
            static_cast<std::size_t>(row) * static_cast<std::size_t>(columns_) + static_cast<std::size_t>(col);
        return brickValueByRowCol_[idx];
    }

    [[nodiscard]] inline i32 xBoundary(i32 row, i32 boundaryIdx) const noexcept {
        const std::size_t stride = static_cast<std::size_t>(columns_ + 1);
        const std::size_t idx =
            static_cast<std::size_t>(row) * stride + static_cast<std::size_t>(boundaryIdx);
        return xBoundariesByRow_[idx];
    }

    Status initTables(Allocator& alloc) noexcept {
        if (columns_ <= 0 || rowCount_ <= 0) {
            return Status::InvalidArgument;
        }

        // Allocate/reinit only once (initCaches may be called repeatedly).
        const std::size_t brickCount = static_cast<std::size_t>(rowCount_) * static_cast<std::size_t>(columns_);
        const std::size_t xBoundaryCount = static_cast<std::size_t>(rowCount_) * static_cast<std::size_t>(columns_ + 1);
        const std::size_t yBoundaryCount = static_cast<std::size_t>(rowCount_ + 1);

        if (brickValueByRowCol_.size() == brickCount && xBoundariesByRow_.size() == xBoundaryCount && yBoundaries_.size() == yBoundaryCount) {
            return Status::Ok;
        }

        brickValueByRowCol_ = Vec<i32>(alloc);
        xBoundariesByRow_ = Vec<i32>(alloc);
        yBoundaries_ = Vec<i32>(alloc);

        auto rr = brickValueByRowCol_.resize(brickCount);
        if (!rr.isOk()) return rr.status();
        rr = xBoundariesByRow_.resize(xBoundaryCount);
        if (!rr.isOk()) return rr.status();
        rr = yBoundaries_.resize(yBoundaryCount);
        if (!rr.isOk()) return rr.status();

        // Fill tables per TS init().
        JavaRandom random(static_cast<u64>(rowCount_));
        halfMortarThicknessQ12_ = javaIDiv(mortarThicknessQ12_, 2);
        xStepQ12_ = javaIDiv(4096, columns_);
        const i32 halfXStepQ12 = javaIDiv(xStepQ12_, 2);
        yStepQ12_ = javaIDiv(4096, rowCount_);
        const i32 halfYStepQ12 = javaIDiv(yStepQ12_, 2);

        yBoundaries_[0] = 0;

        for (i32 row = 0; row < rowCount_; row++) {
                if (row > 0) {
                    i32 value = yStepQ12_;
                    const i32 randomBase = javaSub(nextIntJagex(random, 4096), 2048);
                    const i32 randomValue = javaMulShift(randomBase, heightJitterQ12_, 12);
                    value = javaAdd(value, javaMulShift(randomValue, halfYStepQ12, 12));
                    yBoundaries_[static_cast<std::size_t>(row)] = value + yBoundaries_[static_cast<std::size_t>(row - 1)];
                }

            // x boundary 0
            xBoundariesByRow_[static_cast<std::size_t>(row) * static_cast<std::size_t>(columns_ + 1)] = 0;

            for (i32 col = 0; col < columns_; col++) {
                if (col > 0) {
                    i32 value = xStepQ12_;
                    const i32 randomBase = javaSub(nextIntJagex(random, 4096), 2048);
                    const i32 randomValue = javaMulShift(randomBase, widthJitterQ12_, 12);
                    value = javaAdd(value, javaMulShift(randomValue, halfXStepQ12, 12));
                    const i32 prev = xBoundary(row, col - 1);
                    const std::size_t idx =
                        static_cast<std::size_t>(row) * static_cast<std::size_t>(columns_ + 1) + static_cast<std::size_t>(col);
                    xBoundariesByRow_[idx] = prev + value;
                }

                const i32 brickV = (brickValueVariationQ12_ > 0) ? (4096 - nextIntJagex(random, brickValueVariationQ12_)) : 4096;
                const std::size_t bIdx =
                    static_cast<std::size_t>(row) * static_cast<std::size_t>(columns_) + static_cast<std::size_t>(col);
                brickValueByRowCol_[bIdx] = brickV;
            }

            // final boundary = 4096
            const std::size_t lastIdx =
                static_cast<std::size_t>(row) * static_cast<std::size_t>(columns_ + 1) + static_cast<std::size_t>(columns_);
            xBoundariesByRow_[lastIdx] = 4096;
        }

        yBoundaries_[static_cast<std::size_t>(rowCount_)] = 4096;
        return Status::Ok;
    }
};

} // namespace rs
