#pragma once

#include <cstddef>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "../cache/ColourImageCache.hpp"
#include "../cache/MonochromeImageCache.hpp"
#include "TextureOperation.hpp"

namespace rs {

static inline i32 clampRaster(i32 v, i32 lo, i32 hi) noexcept {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

class Rasterizer final {
public:
    Rasterizer() = default;

    void init(Allocator& alloc, Span<i32> pixels, i32 width, i32 height, i32 widthMask, i32 heightMask) noexcept {
        alloc_ = &alloc;
        pixels_ = pixels;
        width_ = width;
        height_ = height;
        widthMask_ = widthMask;
        heightMask_ = heightMask;
        startX_ = 0;
        startY_ = 0;
    }

    void reset() noexcept {
        alloc_ = nullptr;
        pixels_ = Span<i32>(nullptr, 0);
        width_ = 0;
        height_ = 0;
        widthMask_ = 0;
        heightMask_ = 0;
        startX_ = 0;
        startY_ = 0;
        circleOutline_.clear();
    }

    void releaseMemory() noexcept {
        reset();
        circleOutline_.releaseMemory();
    }

    void setDimensionMasks(i32 widthMask, i32 heightMask) noexcept {
        widthMask_ = widthMask;
        heightMask_ = heightMask;
        startX_ = 0;
        startY_ = 0;
    }

    void rasterLine(i32 x0, i32 x1, i32 y0, i32 y1, i32 color) noexcept {
        const i32 deltaX = x1 - x0;
        const i32 deltaY = y1 - y0;
        if (deltaX == 0) {
            if (deltaY != 0) {
                rasterVerticalLine(x0, y0, y1, color);
            }
            return;
        }
        if (deltaY == 0) {
            rasterHorizontalLine(x0, x1, y0, color);
            return;
        }

        const i32 slopeQ12 = javaIDiv(javaShl(deltaY, 12), deltaX);
        const i32 yIntercept = javaSub(y0, javaMulShift(x0, slopeQ12, 12));

        i32 startX = 0;
        i32 startY = 0;
        if (x0 < startX_) {
            startY = javaAdd(yIntercept, javaMulShift(startX_, slopeQ12, 12));
            startX = startX_;
        } else if (widthMask_ >= x0) {
            startX = x0;
            startY = y0;
        } else {
            startX = widthMask_;
            startY = javaAdd(javaMulShift(widthMask_, slopeQ12, 12), yIntercept);
        }

        i32 endX = 0;
        i32 endY = 0;
        if (x1 < startX_) {
            endX = startX_;
            endY = javaAdd(yIntercept, javaMulShift(startX_, slopeQ12, 12));
        } else if (x1 <= widthMask_) {
            endX = x1;
            endY = y1;
        } else {
            endX = widthMask_;
            endY = javaAdd(javaMulShift(slopeQ12, widthMask_, 12), yIntercept);
        }

        if (startY_ > endY) {
            endX = javaIDiv(javaShl(javaSub(startY_, yIntercept), 12), slopeQ12);
            endY = startY_;
        } else if (heightMask_ < endY) {
            endX = javaIDiv(javaShl(javaSub(heightMask_, yIntercept), 12), slopeQ12);
            endY = heightMask_;
        }

        if (startY_ > startY) {
            startX = javaIDiv(javaShl(javaSub(startY_, yIntercept), 12), slopeQ12);
            startY = startY_;
        } else if (startY > heightMask_) {
            startY = heightMask_;
            startX = javaIDiv(javaShl(javaSub(heightMask_, yIntercept), 12), slopeQ12);
        }

        rasterLine0(startX, endX, startY, endY, color);
    }

    void rasterBezierCurve(i32 x0, i32 y0, i32 x1, i32 y1, i32 x2, i32 y2, i32 x3, i32 y3, i32 outlineColor) noexcept {
        if (startX_ <= x0 && x0 <= widthMask_ &&
            startX_ <= x1 && widthMask_ >= x1 &&
            startX_ <= x2 && widthMask_ >= x2 &&
            startX_ <= x3 && x3 <= widthMask_ &&
            y0 >= startY_ && y0 <= heightMask_ &&
            y1 >= startY_ && heightMask_ >= y1 &&
            y2 >= startY_ && heightMask_ >= y2 &&
            startY_ <= y3 && heightMask_ >= y3) {
            rasterBezierCurve0(x0, y0, x1, y1, x2, y2, x3, y3, outlineColor);
        } else {
            rasterBezierCurveClamped(x0, y0, x1, y1, x2, y2, x3, y3, outlineColor);
        }
    }

    void rasterRectangle(i32 x0, i32 x1, i32 y0, i32 y1, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        if (x0 >= startX_ && x1 <= widthMask_ && startY_ <= y0 && y1 <= heightMask_) {
            rasterRectangle0(x0, x1, y0, y1, fillColor, outlineColor, outlineWidth);
        } else {
            rasterRectangleClamped(x0, x1, y0, y1, fillColor, outlineColor, outlineWidth);
        }
    }

    void rasterRectangleFill(i32 x0, i32 x1, i32 y0, i32 y1, i32 fillColor) noexcept {
        if (startX_ <= x0 && x1 <= widthMask_ && startY_ <= y0 && y1 <= heightMask_) {
            rasterRectangleFill0(x0, x1, y0, y1, fillColor);
        } else {
            rasterRectangleFillClamped(x0, x1, y0, y1, fillColor);
        }
    }

    void rasterRectangleOutline(i32 x0, i32 x1, i32 y0, i32 y1, i32 outlineColor, i32 outlineWidth) noexcept {
        if (x0 >= startX_ && widthMask_ >= x1 && y0 >= startY_ && heightMask_ >= y1) {
            if (outlineWidth == 1) {
                rasterRectangleOutlineWidth1(x0, x1, y0, y1, outlineColor);
            } else {
                rasterRectangleOutline0(x0, x1, y0, y1, outlineColor, outlineWidth);
            }
        } else if (outlineWidth == 1) {
            rasterRectangleOutlineWidth1Clamped(x0, x1, y0, y1, outlineColor);
        } else {
            rasterRectangleOutlineClamped(x0, x1, y0, y1, outlineColor, outlineWidth);
        }
    }

    void rasterEllipse(i32 x, i32 y, i32 sizeX, i32 sizeY, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        if (sizeX == sizeY) {
            rasterCircle(x, y, sizeX, fillColor, outlineColor, outlineWidth);
        } else if (x - sizeX >= startX_ && widthMask_ >= sizeX + x && y - sizeY >= startY_ && sizeY + y <= heightMask_) {
            rasterEllipse0(x, y, sizeX, sizeY, fillColor, outlineColor, outlineWidth);
        } else {
            rasterEllipseClamped(x, y, sizeX, sizeY, fillColor, outlineColor, outlineWidth);
        }
    }

    void rasterEllipseFill(i32 x, i32 y, i32 sizeX, i32 sizeY, i32 fillColor) noexcept {
        if (sizeX == sizeY) {
            rasterCircleFill(x, y, sizeX, fillColor);
        } else if (x - sizeX >= startX_ && widthMask_ >= x + sizeX && y - sizeY >= startY_ && y + sizeY <= heightMask_) {
            rasterEllipseFill0(x, y, sizeX, sizeY, fillColor);
        } else {
            rasterEllipseFillClamped(x, y, sizeX, sizeY, fillColor);
        }
    }

private:
    Allocator* alloc_ = nullptr;
    Span<i32> pixels_{nullptr, 0};
    i32 width_ = 0;
    i32 height_ = 0;

    i32 widthMask_ = 0;
    i32 heightMask_ = 0;
    i32 startX_ = 0;
    i32 startY_ = 0;

    Vec<i32> circleOutline_{};

    inline i32* rowPtr(i32 y) noexcept {
        return pixels_.data() + static_cast<std::size_t>(y) * static_cast<std::size_t>(width_);
    }

    inline void fillRange(i32 y, i32 startX, i32 endX, i32 value) noexcept {
        if (y < 0 || y >= height_) {
            return;
        }
        if (startX < 0) startX = 0;
        if (endX > width_) endX = width_;
        if (endX < startX) {
            const i32 t = startX;
            startX = endX;
            endX = t;
        }
        i32* row = rowPtr(y);
        for (i32 x = startX; x < endX; x++) {
            row[static_cast<std::size_t>(x)] = value;
        }
    }

    inline void setPixel(i32 row, i32 col, i32 value) noexcept {
        if (row < 0 || row >= height_ || col < 0 || col >= width_) {
            return;
        }
        rowPtr(row)[static_cast<std::size_t>(col)] = value;
    }

    void initCircleOutline(i32 size) noexcept {
        if (!alloc_) {
            return;
        }
        if (size < 0) {
            size = 0;
        }
        const std::size_t target = static_cast<std::size_t>(size + 1);
        if (circleOutline_.size() >= target) {
            return;
        }
        circleOutline_ = Vec<i32>(*alloc_);
        auto rr = circleOutline_.resize(target);
        if (!rr.isOk()) {
            circleOutline_.clear();
            return;
        }
        for (std::size_t i = 0; i < circleOutline_.size(); i++) {
            circleOutline_[i] = 0;
        }
    }

    void rasterLine0(i32 x0, i32 x1, i32 y0, i32 y1, i32 color) noexcept {
        i32 deltaX = x1 - x0;
        i32 deltaY = y1 - y0;
        if (deltaX == 0) {
            if (deltaY != 0) {
                rasterVerticalLine0(x0, y0, y1, color);
            }
            return;
        }
        if (deltaY == 0) {
            rasterHorizontalLine0(x0, x1, y0, color);
            return;
        }

        if (deltaX < 0) deltaX = -deltaX;
        if (deltaY < 0) deltaY = -deltaY;
        const bool isSteep = deltaY > deltaX;
        if (isSteep) {
            const i32 t0 = x0;
            x0 = y0;
            y0 = t0;
            const i32 t1 = x1;
            x1 = y1;
            y1 = t1;
        }
        if (x1 < x0) {
            const i32 tx = x0;
            x0 = x1;
            const i32 ty = y0;
            y0 = y1;
            y1 = ty;
            x1 = tx;
        }

        i32 y = y0;
        const i32 dx = x1 - x0;
        i32 absDy = y1 - y0;
        const i32 yStep = (y1 > y0) ? 1 : -1;
        if (absDy < 0) absDy = -absDy;
        i32 error = -(dx >> 1);

        if (isSteep) {
            for (i32 x = x0; x <= x1; x++) {
                error += absDy;
                setPixel(x, y, color);
                if (error > 0) {
                    y += yStep;
                    error -= dx;
                }
            }
        } else {
            for (i32 x = x0; x <= x1; x++) {
                error += absDy;
                setPixel(y, x, color);
                if (error > 0) {
                    y += yStep;
                    error -= dx;
                }
            }
        }
    }

    void rasterVerticalLine(i32 x0, i32 y0, i32 y1, i32 color) noexcept {
        if (startX_ <= x0 && widthMask_ >= x0) {
            y0 = clampRaster(y0, startY_, heightMask_);
            y1 = clampRaster(y1, startY_, heightMask_);
            rasterVerticalLine0(x0, y0, y1, color);
        }
    }

    void rasterVerticalLine0(i32 x0, i32 y0, i32 y1, i32 color) noexcept {
        if (y1 >= y0) {
            for (i32 y = y0; y < y1; y++) {
                setPixel(y, x0, color);
            }
        } else {
            for (i32 y = y1; y < y0; y++) {
                setPixel(y, x0, color);
            }
        }
    }

    void rasterHorizontalLine(i32 x0, i32 x1, i32 y0, i32 color) noexcept {
        if (startY_ <= y0 && y0 <= heightMask_) {
            x0 = clampRaster(x0, startX_, widthMask_);
            x1 = clampRaster(x1, startX_, widthMask_);
            rasterHorizontalLine0(x0, x1, y0, color);
        }
    }

    void rasterHorizontalLine0(i32 x0, i32 x1, i32 y0, i32 color) noexcept {
        if (x1 >= x0) {
            fillRange(y0, x0, x1, color);
        } else {
            fillRange(y0, x1, x0, color);
        }
    }

    void rasterBezierCurve0(i32 x0, i32 y0, i32 x1, i32 y1, i32 x2, i32 y2, i32 x3, i32 y3, i32 outlineColor) noexcept {
        if (x0 == x1 && y0 == y1 && x2 == x3 && y2 == y3) {
            rasterLine0(x0, x3, y0, y3, outlineColor);
            return;
        }
        i32 prevX = x0;
        i32 prevY = y0;
        const i32 threeX0 = x0 * 3;
        const i32 threeY0 = y0 * 3;
        const i32 threeX1 = x1 * 3;
        const i32 threeX2 = x2 * 3;
        const i32 threeY1 = y1 * 3;
        const i32 threeY2 = y2 * 3;
        const i32 coeffX3 = threeX1 + x3 - x0 - threeX2;
        const i32 coeffY3 = threeY1 + y3 - threeY2 - y0;
        const i32 coeffX2 = threeX2 + threeX0 - threeX1 - threeX1;
        const i32 coeffY2 = threeY2 + threeY0 - threeY1 - threeY1;
        const i32 coeffY1 = threeY1 - threeY0;
        const i32 coeffX1 = threeX1 - threeX0;
        for (i32 tQ12 = 128; tQ12 <= 4096; tQ12 += 128) {
            const i32 t2Q12 = javaMulShift(tQ12, tQ12, 12);
            const i32 t3Q12 = javaMulShift(tQ12, t2Q12, 12);
            const i32 xTerm3 = t3Q12 * coeffX3;
            const i32 xTerm2 = t2Q12 * coeffX2;
            const i32 xTerm1 = coeffX1 * tQ12;
            const i32 yTerm2 = coeffY2 * t2Q12;
            const i32 x = ((xTerm1 + xTerm2 + xTerm3) >> 12) + x0;
            const i32 yTerm3 = coeffY3 * t3Q12;
            const i32 yTerm1 = coeffY1 * tQ12;
            const i32 y = ((yTerm1 + yTerm3 + yTerm2) >> 12) + y0;
            rasterLine0(prevX, x, prevY, y, outlineColor);
            prevX = x;
            prevY = y;
        }
    }

    void rasterBezierCurveClamped(i32 x0, i32 y0, i32 x1, i32 y1, i32 x2, i32 y2, i32 x3, i32 y3, i32 outlineColor) noexcept {
        if (x1 == x0 && y1 == y0 && x2 == x3 && y2 == y3) {
            rasterLine(x0, x3, y0, y3, outlineColor);
            return;
        }
        i32 prevX = x0;
        i32 prevY = y0;
        const i32 threeX0 = x0 * 3;
        const i32 threeY0 = y0 * 3;
        const i32 threeX1 = x1 * 3;
        const i32 threeX2 = x2 * 3;
        const i32 threeY1 = y1 * 3;
        const i32 threeY2 = y2 * 3;
        const i32 coeffX3 = x3 + threeX1 - x0 - threeX2;
        const i32 coeffX2 = threeX0 + threeX2 - threeX1 - threeX1;
        const i32 coeffY2 = threeY2 + threeY0 - threeY1 - threeY1;
        const i32 coeffY3 = threeY1 + y3 - y0 - threeY2;
        const i32 coeffX1 = threeX1 - threeX0;
        const i32 coeffY1 = threeY1 - threeY0;
        for (i32 tQ12 = 128; tQ12 <= 4096; tQ12 += 128) {
            const i32 t2Q12 = javaMulShift(tQ12, tQ12, 12);
            const i32 xTerm2 = t2Q12 * coeffX2;
            const i32 t3Q12 = javaMulShift(tQ12, t2Q12, 12);
            const i32 xTerm3 = t3Q12 * coeffX3;
            const i32 yTerm1 = coeffY1 * tQ12;
            const i32 yTerm2 = coeffY2 * t2Q12;
            const i32 yTerm3 = coeffY3 * t3Q12;
            const i32 xTerm1 = coeffX1 * tQ12;
            const i32 x = ((xTerm1 + xTerm2 + xTerm3) >> 12) + x0;
            const i32 y = ((yTerm1 + yTerm3 + yTerm2) >> 12) + y0;
            rasterLine(prevX, x, prevY, y, outlineColor);
            prevY = y;
            prevX = x;
        }
    }

    void rasterRectangle0(i32 x0, i32 x1, i32 y0, i32 y1, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        const i32 innerTopY = y0 + outlineWidth;
        const i32 innerBottomY = y1 - outlineWidth;
        const i32 innerLeftX = x0 + outlineWidth;
        const i32 innerRightX = x1 - outlineWidth;
        for (i32 y = y0; y < innerTopY; y++) {
            fillRange(y, x0, x1, outlineColor);
        }
        for (i32 y = y1; y > innerBottomY; y--) {
            fillRange(y, x0, x1, outlineColor);
        }
        for (i32 y = innerTopY; y <= innerBottomY; y++) {
            fillRange(y, x0, innerLeftX, outlineColor);
            fillRange(y, innerLeftX, innerRightX, fillColor);
            fillRange(y, innerRightX, x1, outlineColor);
        }
    }

    void rasterRectangleClamped(i32 x0, i32 x1, i32 y0, i32 y1, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        const i32 y0Clamped = clampRaster(y0, startY_, heightMask_);
        const i32 y1Clamped = clampRaster(y1, startY_, heightMask_);
        const i32 x0Clamped = clampRaster(x0, startX_, widthMask_);
        const i32 x1Clamped = clampRaster(x1, startX_, widthMask_);
        const i32 innerTopY = clampRaster(y0 + outlineWidth, startY_, heightMask_);
        const i32 innerBottomY = clampRaster(y1 - outlineWidth, startY_, heightMask_);
        for (i32 y = y0Clamped; y < innerTopY; y++) {
            fillRange(y, x0Clamped, x1Clamped, outlineColor);
        }
        for (i32 y = y1Clamped; y > innerBottomY; y--) {
            fillRange(y, x0Clamped, x1Clamped, outlineColor);
        }
        const i32 innerLeftX = clampRaster(x0 + outlineWidth, startX_, widthMask_);
        const i32 innerRightX = clampRaster(x1 - outlineWidth, startX_, widthMask_);
        for (i32 y = innerTopY; y <= innerBottomY; y++) {
            fillRange(y, x0Clamped, innerLeftX, outlineColor);
            fillRange(y, innerLeftX, innerRightX, fillColor);
            fillRange(y, innerRightX, x1Clamped, outlineColor);
        }
    }

    void rasterRectangleFill0(i32 x0, i32 x1, i32 y0, i32 y1, i32 fillColor) noexcept {
        for (i32 y = y0; y <= y1; y++) {
            fillRange(y, x0, x1, fillColor);
        }
    }

    void rasterRectangleFillClamped(i32 x0, i32 x1, i32 y0, i32 y1, i32 fillColor) noexcept {
        const i32 y0Clamped = clampRaster(y0, startY_, heightMask_);
        const i32 y1Clamped = clampRaster(y1, startY_, heightMask_);
        const i32 x0Clamped = clampRaster(x0, startX_, widthMask_);
        const i32 x1Clamped = clampRaster(x1, startX_, widthMask_);
        for (i32 y = y0Clamped; y <= y1Clamped; y++) {
            fillRange(y, x0Clamped, x1Clamped, fillColor);
        }
    }

    void rasterRectangleOutlineWidth1(i32 x0, i32 x1, i32 y0, i32 y1, i32 outlineColor) noexcept {
        fillRange(y0++, x0, x1, outlineColor);
        fillRange(y1--, x0, x1, outlineColor);
        for (i32 y = y0; y <= y1; y++) {
            setPixel(y, x0, outlineColor);
            setPixel(y, x1, outlineColor);
        }
    }

    void rasterRectangleOutline0(i32 x0, i32 x1, i32 y0, i32 y1, i32 outlineColor, i32 outlineWidth) noexcept {
        const i32 innerTopY = outlineWidth + y0;
        const i32 innerBottomY = y1 - outlineWidth;
        const i32 innerLeftX = outlineWidth + x0;
        for (i32 y = y0; y < innerTopY; y++) {
            fillRange(y, x0, x1, outlineColor);
        }
        for (i32 y = y1; y > innerBottomY; y--) {
            fillRange(y, x0, x1, outlineColor);
        }
        const i32 innerRightX = x1 - outlineWidth;
        for (i32 y = innerTopY; y <= innerBottomY; y++) {
            fillRange(y, x0, innerLeftX, outlineColor);
            fillRange(y, innerRightX, x1, outlineColor);
        }
    }

    void rasterRectangleOutlineWidth1Clamped(i32 x0, i32 x1, i32 y0, i32 y1, i32 outlineColor) noexcept {
        if (heightMask_ < y0 || startY_ > y1) {
            return;
        }

        bool shouldDrawLeftEdge = true;
        if (startX_ > x0) {
            x0 = startX_;
            shouldDrawLeftEdge = false;
        } else if (x0 > widthMask_) {
            x0 = widthMask_;
            shouldDrawLeftEdge = false;
        }

        bool shouldDrawRightEdge = true;
        if (x1 < startX_) {
            x1 = startX_;
            shouldDrawRightEdge = false;
        } else if (widthMask_ < x1) {
            x1 = widthMask_;
            shouldDrawRightEdge = false;
        }

        i32 yStart = 0;
        if (startY_ <= y0) {
            yStart = y0 + 1;
            fillRange(y0, x0, x1, outlineColor);
        } else {
            yStart = startY_;
        }

        i32 yEnd = 0;
        if (heightMask_ < y1) {
            yEnd = heightMask_;
        } else {
            yEnd = y1 - 1;
            fillRange(y1, x0, x1, outlineColor);
        }

        if (shouldDrawLeftEdge && shouldDrawRightEdge) {
            for (i32 y = yStart; y <= yEnd; y++) {
                setPixel(y, x0, outlineColor);
                setPixel(y, x1, outlineColor);
            }
        } else if (shouldDrawLeftEdge) {
            for (i32 y = yStart; y <= yEnd; y++) {
                setPixel(y, x0, outlineColor);
            }
        } else if (shouldDrawRightEdge) {
            for (i32 y = yStart; y <= yEnd; y++) {
                setPixel(y, x1, outlineColor);
            }
        }
    }

    void rasterRectangleOutlineClamped(i32 x0, i32 x1, i32 y0, i32 y1, i32 outlineColor, i32 outlineWidth) noexcept {
        const i32 y0Clamped = clampRaster(y0, startY_, heightMask_);
        const i32 y1Clamped = clampRaster(y1, startY_, heightMask_);
        const i32 x0Clamped = clampRaster(x0, startX_, widthMask_);
        const i32 x1Clamped = clampRaster(x1, startX_, widthMask_);
        const i32 innerTopY = clampRaster(outlineWidth + y0, startY_, heightMask_);
        const i32 innerBottomY = clampRaster(y1 - outlineWidth, startY_, heightMask_);
        for (i32 y = y0Clamped; y < innerTopY; y++) {
            fillRange(y, x0Clamped, x1Clamped, outlineColor);
        }
        for (i32 y = y1Clamped; y > innerBottomY; y--) {
            fillRange(y, x0Clamped, x1Clamped, outlineColor);
        }
        const i32 innerLeftX = clampRaster(x0 + outlineWidth, startX_, widthMask_);
        const i32 innerRightX = clampRaster(x1 - outlineWidth, startX_, widthMask_);
        for (i32 y = innerTopY; y <= innerBottomY; y++) {
            fillRange(y, x0Clamped, innerLeftX, outlineColor);
            fillRange(y, innerRightX, x1Clamped, outlineColor);
        }
    }

    void rasterEllipse0(i32 x, i32 y, i32 sizeX, i32 sizeY, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        i32 xOffsetOuter = 0;
        i32 yOffsetOuter = sizeY;
        const i32 innerRadiusX = sizeX - outlineWidth;
        i32 xOffsetInner = 0;
        const i32 innerRadiusY = sizeY - outlineWidth;
        const i32 rx2 = sizeX * sizeX;
        const i32 ry2 = sizeY * sizeY;
        const i32 innerRx2 = innerRadiusX * innerRadiusX;
        const i32 innerRy2 = innerRadiusY * innerRadiusY;
        const i32 twoRy2 = ry2 << 1;
        const i32 twoInnerRy2 = innerRy2 << 1;
        const i32 twoRx2 = rx2 << 1;
        const i32 twoInnerRx2 = innerRx2 << 1;
        const i32 twoRy = sizeY << 1;
        const i32 twoInnerRy = innerRadiusY << 1;
        i32 outerDecisionA = rx2 * (1 - twoRy) + twoRy2;
        i32 outerDecisionB = ry2 - twoRx2 * (twoRy - 1);
        i32 innerDecisionA = twoInnerRy2 + (1 - twoInnerRy) * innerRx2;
        i32 innerDecisionB = innerRy2 - twoInnerRx2 * (twoInnerRy - 1);
        const i32 fourRx2 = rx2 << 2;
        const i32 fourRy2 = ry2 << 2;
        const i32 fourInnerRy2 = innerRy2 << 2;
        const i32 fourInnerRx2 = innerRx2 << 2;
        i32 outerDecisionAInc = twoRy2 * 3;
        i32 outerDecisionBDec = twoRx2 * (twoRy - 3);
        i32 innerDecisionAInc = twoInnerRy2 * 3;
        i32 outerDecisionBInc = fourRy2;
        i32 innerDecisionBDec = (twoInnerRy - 3) * twoInnerRx2;
        i32 innerDecisionBInc = fourInnerRy2;
        i32 outerDecisionAAdjust = (sizeY - 1) * fourRx2;
        i32 innerDecisionAAdjust = fourInnerRx2 * (innerRadiusY - 1);

        fillRange(y, x - sizeX, x - innerRadiusX, outlineColor);
        fillRange(y, x - innerRadiusX, innerRadiusX + x, fillColor);
        fillRange(y, innerRadiusX + x, x + sizeX, outlineColor);

        while (yOffsetOuter > 0) {
            if (outerDecisionA < 0) {
                while (outerDecisionA < 0) {
                    outerDecisionA += outerDecisionAInc;
                    xOffsetOuter++;
                    outerDecisionAInc += fourRy2;
                    outerDecisionB += outerDecisionBInc;
                    outerDecisionBInc += fourRy2;
                }
            }
            if (outerDecisionB < 0) {
                xOffsetOuter++;
                outerDecisionA += outerDecisionAInc;
                outerDecisionAInc += fourRy2;
                outerDecisionB += outerDecisionBInc;
                outerDecisionBInc += fourRy2;
            }
            const bool isWithinInnerY = innerRadiusY >= yOffsetOuter;
            outerDecisionB += -outerDecisionBDec;
            yOffsetOuter--;
            if (isWithinInnerY) {
                if (innerDecisionA < 0) {
                    while (innerDecisionA < 0) {
                        innerDecisionA += innerDecisionAInc;
                        innerDecisionB += innerDecisionBInc;
                        innerDecisionAInc += fourInnerRy2;
                        innerDecisionBInc += fourInnerRy2;
                        xOffsetInner++;
                    }
                }
                if (innerDecisionB < 0) {
                    innerDecisionA += innerDecisionAInc;
                    innerDecisionAInc += fourInnerRy2;
                    innerDecisionB += innerDecisionBInc;
                    innerDecisionBInc += fourInnerRy2;
                    xOffsetInner++;
                }
                innerDecisionB += -innerDecisionBDec;
                innerDecisionBDec -= fourInnerRx2;
                innerDecisionA += -innerDecisionAAdjust;
                innerDecisionAAdjust -= fourInnerRx2;
            }
            outerDecisionA += -outerDecisionAAdjust;
            const i32 yTop = yOffsetOuter + y;
            const i32 yBottom = y - yOffsetOuter;
            outerDecisionAAdjust -= fourRx2;
            outerDecisionBDec -= fourRx2;
            if (yTop >= startY_ && heightMask_ >= yBottom) {
                const i32 outerRightX = xOffsetOuter + x;
                const i32 outerLeftX = x - xOffsetOuter;
                if (isWithinInnerY) {
                    const i32 innerRightX = x + xOffsetInner;
                    const i32 innerLeftX = x - xOffsetInner;
                    fillRange(yBottom, outerLeftX, innerLeftX, outlineColor);
                    fillRange(yBottom, innerLeftX, innerRightX, fillColor);
                    fillRange(yBottom, innerRightX, outerRightX, outlineColor);
                    fillRange(yTop, outerLeftX, innerLeftX, outlineColor);
                    fillRange(yTop, innerLeftX, innerRightX, fillColor);
                    fillRange(yTop, innerRightX, outerRightX, outlineColor);
                } else {
                    fillRange(yBottom, outerLeftX, outerRightX, outlineColor);
                    fillRange(yTop, outerLeftX, outerRightX, outlineColor);
                }
            }
        }
    }

    void rasterEllipseClamped(i32 x, i32 y, i32 sizeX, i32 sizeY, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        i32 xOffsetOuter = 0;
        const i32 innerRadiusY = sizeY - outlineWidth;
        i32 yOffsetOuter = sizeY;
        i32 xOffsetInner = 0;
        const i32 innerRadiusX = sizeX - outlineWidth;
        const i32 rx2 = sizeX * sizeX;
        const i32 ry2 = sizeY * sizeY;
        const i32 innerRx2 = innerRadiusX * innerRadiusX;
        const i32 twoRy2 = ry2 << 1;
        const i32 innerRy2 = innerRadiusY * innerRadiusY;
        const i32 twoRx2 = rx2 << 1;
        const i32 twoInnerRy2 = innerRy2 << 1;
        const i32 twoInnerRx2 = innerRx2 << 1;
        const i32 twoRy = sizeY << 1;
        const i32 twoInnerRy = innerRadiusY << 1;
        i32 outerDecisionA = twoRy2 + (1 - twoRy) * rx2;
        i32 outerDecisionB = ry2 - (twoRy - 1) * twoRx2;
        i32 innerDecisionA = innerRx2 * (1 - twoInnerRy) + twoInnerRy2;
        const i32 fourRx2 = rx2 << 2;
        i32 innerDecisionB = innerRy2 - twoInnerRx2 * (twoInnerRy - 1);
        const i32 fourRy2 = ry2 << 2;
        const i32 fourInnerRx2 = innerRx2 << 2;
        const i32 fourInnerRy2 = innerRy2 << 2;
        i32 outerDecisionAInc = twoRy2 * 3;
        i32 innerDecisionAInc = twoInnerRy2 * 3;
        i32 outerDecisionBDec = twoRx2 * (twoRy - 3);
        i32 outerDecisionBInc = fourRy2;
        i32 innerDecisionBDec = (twoInnerRy - 3) * twoInnerRx2;
        i32 outerDecisionAAdjust = fourRx2 * (sizeY - 1);
        i32 innerDecisionBInc = fourInnerRy2;
        i32 innerDecisionAAdjust = (innerRadiusY - 1) * fourInnerRx2;

        if (y >= startY_ && heightMask_ >= y) {
            const i32 outerLeftX = clampRaster(x - sizeX, startX_, widthMask_);
            const i32 outerRightX = clampRaster(x + sizeX, startX_, widthMask_);
            const i32 innerLeftX = clampRaster(x - innerRadiusX, startX_, widthMask_);
            const i32 innerRightX = clampRaster(x + innerRadiusX, startX_, widthMask_);
            fillRange(y, outerLeftX, innerLeftX, outlineColor);
            fillRange(y, innerLeftX, innerRightX, fillColor);
            fillRange(y, innerRightX, outerRightX, outlineColor);
        }

        while (yOffsetOuter > 0) {
            if (outerDecisionA < 0) {
                while (outerDecisionA < 0) {
                    outerDecisionA += outerDecisionAInc;
                    outerDecisionB += outerDecisionBInc;
                    outerDecisionBInc += fourRy2;
                    outerDecisionAInc += fourRy2;
                    xOffsetOuter++;
                }
            }
            if (outerDecisionB < 0) {
                outerDecisionB += outerDecisionBInc;
                outerDecisionBInc += fourRy2;
                outerDecisionA += outerDecisionAInc;
                xOffsetOuter++;
                outerDecisionAInc += fourRy2;
            }
            const bool isWithinInnerY = innerRadiusY >= yOffsetOuter;
            outerDecisionB += -outerDecisionBDec;
            yOffsetOuter--;
            if (isWithinInnerY) {
                if (innerDecisionA < 0) {
                    while (innerDecisionA < 0) {
                        innerDecisionA += innerDecisionAInc;
                        innerDecisionB += innerDecisionBInc;
                        innerDecisionAInc += fourInnerRy2;
                        innerDecisionBInc += fourInnerRy2;
                        xOffsetInner++;
                    }
                }
                if (innerDecisionB < 0) {
                    innerDecisionB += innerDecisionBInc;
                    innerDecisionBInc += fourInnerRy2;
                    innerDecisionA += innerDecisionAInc;
                    xOffsetInner++;
                    innerDecisionAInc += fourInnerRy2;
                }
                innerDecisionB += -innerDecisionBDec;
                innerDecisionBDec -= fourInnerRx2;
                innerDecisionA += -innerDecisionAAdjust;
                innerDecisionAAdjust -= fourInnerRx2;
            }
            outerDecisionA += -outerDecisionAAdjust;
            const i32 yTop = yOffsetOuter + y;
            const i32 yBottom = y - yOffsetOuter;
            outerDecisionAAdjust -= fourRx2;
            outerDecisionBDec -= fourRx2;
            if (yTop >= startY_ && heightMask_ >= yBottom) {
                const i32 outerRightX = clampRaster(xOffsetOuter + x, startX_, widthMask_);
                const i32 outerLeftX = clampRaster(x - xOffsetOuter, startX_, widthMask_);
                if (isWithinInnerY) {
                    const i32 innerRightX = clampRaster(x + xOffsetInner, startX_, widthMask_);
                    const i32 innerLeftX = clampRaster(x - xOffsetInner, startX_, widthMask_);
                    if (startY_ <= yBottom) {
                        fillRange(yBottom, outerLeftX, innerLeftX, outlineColor);
                        fillRange(yBottom, innerLeftX, innerRightX, fillColor);
                        fillRange(yBottom, innerRightX, outerRightX, outlineColor);
                    }
                    if (heightMask_ >= yTop) {
                        fillRange(yTop, outerLeftX, innerLeftX, outlineColor);
                        fillRange(yTop, innerLeftX, innerRightX, fillColor);
                        fillRange(yTop, innerRightX, outerRightX, outlineColor);
                    }
                } else {
                    if (yBottom >= startY_) {
                        fillRange(yBottom, outerLeftX, outerRightX, outlineColor);
                    }
                    if (heightMask_ >= yTop) {
                        fillRange(yTop, outerLeftX, outerRightX, outlineColor);
                    }
                }
            }
        }
    }

    void rasterCircle(i32 x, i32 y, i32 size, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        if (startX_ <= x - size && size + x <= widthMask_ && y - size >= startY_ && heightMask_ >= size + y) {
            rasterCircle0(x, y, size, fillColor, outlineColor, outlineWidth);
        } else {
            rasterCircleClamped(x, y, size, fillColor, outlineColor, outlineWidth);
        }
    }

    void rasterCircle0(i32 x, i32 y, i32 size, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        initCircleOutline(size);
        i32 xOffset = 0;
        i32 outerError = -size;
        i32 innerRadius = size - outlineWidth;
        i32 yOffset = size;
        i32 innerDelta = -1;
        i32 outerDelta = -1;
        if (innerRadius < 0) innerRadius = 0;
        i32 innerOutlineY = innerRadius;
        const i32 innerLeftX = x - innerRadius;
        fillRange(y, x - size, innerLeftX, outlineColor);
        const i32 innerRightX = innerRadius + x;
        i32 innerError = -innerRadius;
        fillRange(y, innerLeftX, innerRightX, fillColor);
        fillRange(y, innerRightX, x + size, outlineColor);
        while (yOffset > xOffset) {
            outerDelta += 2;
            outerError += outerDelta;
            innerDelta += 2;
            innerError += innerDelta;
            if (innerError >= 0 && innerOutlineY >= 1) {
                if (static_cast<std::size_t>(innerOutlineY) < circleOutline_.size()) {
                    circleOutline_[static_cast<std::size_t>(innerOutlineY)] = xOffset;
                }
                innerOutlineY--;
                innerError -= innerOutlineY << 1;
            }
            xOffset++;
            if (outerError >= 0) {
                yOffset--;
                if (yOffset >= 0) {
                    outerError -= yOffset << 1;
                }
                const i32 yBottom = y - yOffset;
                const i32 yTop = yOffset + y;
                if (yTop >= startY_ && yBottom <= heightMask_) {
                    const i32 rightX = x + xOffset;
                    const i32 leftX = x - xOffset;
                    if (innerOutlineY >= yOffset) {
                        fillRange(yTop, leftX, rightX, outlineColor);
                        fillRange(yBottom, leftX, rightX, outlineColor);
                    } else if (innerOutlineY >= 0) {
                        const i32 innerHalfWidth = circleOutline_[static_cast<std::size_t>(yOffset)];
                        const i32 innerRight = x + innerHalfWidth;
                        const i32 innerLeft = x - innerHalfWidth;
                        fillRange(yTop, leftX, innerLeft, outlineColor);
                        fillRange(yTop, innerLeft, innerRight, fillColor);
                        fillRange(yTop, innerRight, rightX, outlineColor);
                        fillRange(yBottom, leftX, innerLeft, outlineColor);
                        fillRange(yBottom, innerLeft, innerRight, fillColor);
                        fillRange(yBottom, innerRight, rightX, outlineColor);
                    }
                }
            }
            const i32 yBottom = y - xOffset;
            const i32 yTop = y + xOffset;
            if (yTop >= startY_ && yBottom <= heightMask_) {
                const i32 rightX = x + yOffset;
                const i32 leftX = x - yOffset;
                if (yOffset > innerOutlineY) {
                    fillRange(yTop, leftX, rightX, outlineColor);
                    fillRange(yBottom, leftX, rightX, outlineColor);
                } else if (innerOutlineY >= 0) {
                    const i32 innerHalfWidth = (xOffset > innerOutlineY)
                        ? circleOutline_[static_cast<std::size_t>(xOffset)]
                        : innerOutlineY;
                    const i32 innerRight = x + innerHalfWidth;
                    const i32 innerLeft = x - innerHalfWidth;
                    fillRange(yTop, leftX, innerLeft, outlineColor);
                    fillRange(yTop, innerLeft, innerRight, fillColor);
                    fillRange(yTop, innerRight, rightX, outlineColor);
                    fillRange(yBottom, leftX, innerLeft, outlineColor);
                    fillRange(yBottom, innerLeft, innerRight, fillColor);
                    fillRange(yBottom, innerRight, rightX, outlineColor);
                }
            }
        }
    }

    void rasterCircleClamped(i32 x, i32 y, i32 size, i32 fillColor, i32 outlineColor, i32 outlineWidth) noexcept {
        initCircleOutline(size);
        i32 xOffset = 0;
        i32 outerError = -size;
        i32 innerRadius = size - outlineWidth;
        i32 yOffset = size;
        i32 innerDelta = -1;
        i32 outerDelta = -1;
        if (innerRadius < 0) innerRadius = 0;
        i32 innerOutlineY = innerRadius;
        i32 rightX = clampRaster(x + size, startX_, widthMask_);
        i32 leftX = clampRaster(x - size, startX_, widthMask_);
        const i32 innerLeftX = clampRaster(x - innerRadius, startX_, widthMask_);
        const i32 innerRightX = clampRaster(x + innerRadius, startX_, widthMask_);
        i32 innerError = -innerRadius;
        if (y >= startY_ && heightMask_ >= y) {
            fillRange(y, leftX, innerLeftX, outlineColor);
            fillRange(y, innerLeftX, innerRightX, fillColor);
            fillRange(y, innerRightX, rightX, outlineColor);
        }
        while (yOffset > xOffset) {
            outerDelta += 2;
            outerError += outerDelta;
            innerDelta += 2;
            innerError += innerDelta;
            if (innerError >= 0 && innerOutlineY >= 1) {
                if (static_cast<std::size_t>(innerOutlineY) < circleOutline_.size()) {
                    circleOutline_[static_cast<std::size_t>(innerOutlineY)] = xOffset;
                }
                innerOutlineY--;
                innerError -= innerOutlineY << 1;
            }
            xOffset++;
            if (outerError >= 0) {
                yOffset--;
                outerError -= yOffset << 1;
                const i32 yBottom = y - yOffset;
                const i32 yTop = yOffset + y;
                if (yTop >= startY_ && heightMask_ >= yBottom) {
                    rightX = clampRaster(x + xOffset, startX_, widthMask_);
                    leftX = clampRaster(x - xOffset, startX_, widthMask_);
                    if (innerOutlineY >= yOffset) {
                        if (yTop <= heightMask_) fillRange(yTop, leftX, rightX, outlineColor);
                        if (startY_ <= yBottom) fillRange(yBottom, leftX, rightX, outlineColor);
                    } else if (innerOutlineY >= 0) {
                        const i32 innerHalfWidth = circleOutline_[static_cast<std::size_t>(yOffset)];
                        const i32 innerRight = clampRaster(x + innerHalfWidth, startX_, widthMask_);
                        const i32 innerLeft = clampRaster(x - innerHalfWidth, startX_, widthMask_);
                        if (yTop <= heightMask_) {
                            fillRange(yTop, leftX, innerLeft, outlineColor);
                            fillRange(yTop, innerLeft, innerRight, fillColor);
                            fillRange(yTop, innerRight, rightX, outlineColor);
                        }
                        if (startY_ <= yBottom) {
                            fillRange(yBottom, leftX, innerLeft, outlineColor);
                            fillRange(yBottom, innerLeft, innerRight, fillColor);
                            fillRange(yBottom, innerRight, rightX, outlineColor);
                        }
                    }
                }
            }

            const i32 yBottom = y - xOffset;
            const i32 yTop = y + xOffset;
            if (startY_ <= yTop && yBottom <= heightMask_) {
                rightX = clampRaster(x + yOffset, startX_, widthMask_);
                leftX = clampRaster(x - yOffset, startX_, widthMask_);
                if (yOffset > innerOutlineY) {
                    if (yTop <= heightMask_) fillRange(yTop, leftX, rightX, outlineColor);
                    if (startY_ <= yBottom) fillRange(yBottom, leftX, rightX, outlineColor);
                } else if (innerOutlineY >= 0) {
                    const i32 innerHalfWidth = (xOffset > innerOutlineY)
                        ? circleOutline_[static_cast<std::size_t>(xOffset)]
                        : innerOutlineY;
                    const i32 innerRight = clampRaster(x + innerHalfWidth, startX_, widthMask_);
                    const i32 innerLeft = clampRaster(x - innerHalfWidth, startX_, widthMask_);
                    if (yTop <= heightMask_) {
                        fillRange(yTop, leftX, innerLeft, outlineColor);
                        fillRange(yTop, innerLeft, innerRight, fillColor);
                        fillRange(yTop, innerRight, rightX, outlineColor);
                    }
                    if (startY_ <= yBottom) {
                        fillRange(yBottom, leftX, innerLeft, outlineColor);
                        fillRange(yBottom, innerLeft, innerRight, fillColor);
                        fillRange(yBottom, innerRight, rightX, outlineColor);
                    }
                }
            }
        }
    }

    void rasterCircleFill(i32 x, i32 y, i32 size, i32 fillColor) noexcept {
        if (x - size >= startX_ && widthMask_ >= x + size && y - size >= startY_ && y + size <= heightMask_) {
            rasterCircleFill0(x, y, size, fillColor);
        } else {
            rasterCircleFillClamped(x, y, size, fillColor);
        }
    }

    void rasterCircleFill0(i32 x, i32 y, i32 size, i32 fillColor) noexcept {
        fillRange(y, x - size, size + x, fillColor);
        i32 xOffset = 0;
        i32 yOffset = size;
        i32 error = -size;
        i32 delta = -1;
        while (yOffset > xOffset) {
            delta += 2;
            xOffset++;
            error += delta;
            if (error >= 0) {
                yOffset--;
                error -= yOffset << 1;
                const i32 yUpper = y - yOffset;
                const i32 yLower = y + yOffset;
                const i32 leftX = x - xOffset;
                const i32 rightX = x + xOffset;
                fillRange(yLower, leftX, rightX, fillColor);
                fillRange(yUpper, leftX, rightX, fillColor);
            }
            const i32 rightX = x + yOffset;
            const i32 leftX = x - yOffset;
            fillRange(y + xOffset, leftX, rightX, fillColor);
            fillRange(y - xOffset, leftX, rightX, fillColor);
        }
    }

    void rasterCircleFillClamped(i32 x, i32 y, i32 size, i32 fillColor) noexcept {
        i32 xOffset = 0;
        i32 yOffset = size;
        i32 delta = -1;
        i32 error = -size;
        i32 rightX = clampRaster(size + x, startX_, widthMask_);
        i32 leftX = clampRaster(x - size, startX_, widthMask_);
        fillRange(y, leftX, rightX, fillColor);
        while (yOffset > xOffset) {
            delta += 2;
            error += delta;
            if (error > 0) {
                yOffset--;
                error -= yOffset << 1;
                const i32 yBottom = y - yOffset;
                const i32 yTop = yOffset + y;
                if (yTop >= startY_ && yBottom <= heightMask_) {
                    rightX = clampRaster(x + xOffset, startX_, widthMask_);
                    leftX = clampRaster(x - xOffset, startX_, widthMask_);
                    if (heightMask_ >= yTop) {
                        fillRange(yTop, leftX, rightX, fillColor);
                    }
                    if (startY_ <= yBottom) {
                        fillRange(yBottom, leftX, rightX, fillColor);
                    }
                }
            }
            xOffset++;
            const i32 yBottom = y - xOffset;
            const i32 yTop = xOffset + y;
            if (startY_ <= yTop && yBottom <= heightMask_) {
                rightX = clampRaster(x + yOffset, startX_, widthMask_);
                leftX = clampRaster(x - yOffset, startX_, widthMask_);
                if (yTop <= heightMask_) {
                    fillRange(yTop, leftX, rightX, fillColor);
                }
                if (startY_ <= yBottom) {
                    fillRange(yBottom, leftX, rightX, fillColor);
                }
            }
        }
    }

    void rasterEllipseFill0(i32 x, i32 y, i32 sizeX, i32 sizeY, i32 fillColor) noexcept {
        i32 yOffset = sizeY;
        i32 xOffset = 0;
        const i32 ry2 = sizeY * sizeY;
        const i32 rx2 = sizeX * sizeX;
        const i32 twoRx2 = rx2 << 1;
        const i32 twoRy2 = ry2 << 1;
        const i32 twoRy = sizeY << 1;
        i32 decisionB = ry2 - twoRx2 * (twoRy - 1);
        i32 decisionA = (1 - twoRy) * rx2 + twoRy2;
        const i32 fourRx2 = rx2 << 2;
        const i32 fourRy2 = ry2 << 2;
        i32 decisionAInc = twoRy2 * 3;
        i32 decisionBInc = fourRy2;
        i32 decisionBDec = (twoRy - 3) * twoRx2;
        fillRange(y, x - sizeX, x + sizeX, fillColor);
        i32 decisionAAdjust = (sizeY - 1) * fourRx2;
        while (yOffset > 0) {
            if (decisionA < 0) {
                while (decisionA < 0) {
                    decisionA += decisionAInc;
                    decisionB += decisionBInc;
                    decisionBInc += fourRy2;
                    decisionAInc += fourRy2;
                    xOffset++;
                }
            }
            yOffset--;
            if (decisionB < 0) {
                decisionB += decisionBInc;
                decisionBInc += fourRy2;
                decisionA += decisionAInc;
                xOffset++;
                decisionAInc += fourRy2;
            }
            decisionA += -decisionAAdjust;
            const i32 yBottom = y - yOffset;
            const i32 rightX = x + xOffset;
            decisionAAdjust -= fourRx2;
            const i32 yTop = yOffset + y;
            decisionB += -decisionBDec;
            decisionBDec -= fourRx2;
            const i32 leftX = x - xOffset;
            fillRange(yBottom, leftX, rightX, fillColor);
            fillRange(yTop, leftX, rightX, fillColor);
        }
    }

    void rasterEllipseFillClamped(i32 x, i32 y, i32 sizeX, i32 sizeY, i32 fillColor) noexcept {
        i32 yOffset = sizeY;
        i32 xOffset = 0;
        const i32 ry2 = sizeY * sizeY;
        const i32 rx2 = sizeX * sizeX;
        const i32 twoRx2 = rx2 << 1;
        const i32 twoRy2 = ry2 << 1;
        const i32 twoRy = sizeY << 1;
        i32 decisionB = ry2 - (twoRy - 1) * twoRx2;
        i32 decisionA = (1 - twoRy) * rx2 + twoRy2;
        const i32 fourRx2 = rx2 << 2;
        const i32 fourRy2 = ry2 << 2;
        i32 decisionAInc = twoRy2 * 3;
        i32 decisionBInc = fourRy2;
        i32 decisionBDec = ((sizeY << 1) - 3) * twoRx2;
        if (y >= startY_ && heightMask_ >= y) {
            const i32 rightX = clampRaster(x + sizeX, startX_, widthMask_);
            const i32 leftX = clampRaster(x - sizeX, startX_, widthMask_);
            fillRange(y, leftX, rightX, fillColor);
        }
        i32 decisionAAdjust = fourRx2 * (sizeY - 1);
        while (yOffset > 0) {
            if (decisionA < 0) {
                while (decisionA < 0) {
                    decisionA += decisionAInc;
                    decisionB += decisionBInc;
                    decisionBInc += fourRy2;
                    decisionAInc += fourRy2;
                    xOffset++;
                }
            }
            yOffset--;
            if (decisionB < 0) {
                decisionB += decisionBInc;
                decisionBInc += fourRy2;
                decisionA += decisionAInc;
                xOffset++;
                decisionAInc += fourRy2;
            }
            decisionA += -decisionAAdjust;
            const i32 yBottom = y - yOffset;
            decisionB += -decisionBDec;
            decisionAAdjust -= fourRx2;
            const i32 yTop = yOffset + y;
            decisionBDec -= fourRx2;
            if (yTop >= startY_ && heightMask_ >= yBottom) {
                const i32 rightX = clampRaster(xOffset + x, startX_, widthMask_);
                const i32 leftX = clampRaster(x - xOffset, startX_, widthMask_);
                if (startY_ <= yBottom) {
                    fillRange(yBottom, leftX, rightX, fillColor);
                }
                if (yTop <= heightMask_) {
                    fillRange(yTop, leftX, rightX, fillColor);
                }
            }
        }
    }
};

enum class RasterShapeType : u8 {
    Line = 0,
    Bezier = 1,
    Rectangle = 2,
    Ellipse = 3,
};

struct RasterShape final {
    RasterShapeType type = RasterShapeType::Line;

    i32 fillColor = -1;
    i32 outlineColor = -1;
    i32 outlineWidth = 0;

    i16 x0 = 0;
    i16 y0 = 0;
    i16 x1 = 0;
    i16 y1 = 0;
    i16 x2 = 0;
    i16 y2 = 0;
    i16 x3 = 0;
    i16 y3 = 0;
};

class ShapeRasterizerOperation final : public TextureOperationImpl<ShapeRasterizerOperation> {
public:
    ShapeRasterizerOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        if (fieldId == 0) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) return s;
            const i32 count = static_cast<i32>(countU8);
            shapes_ = Vec<RasterShape>(alloc);
            auto rr = shapes_.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) return rr.status();

            for (i32 i = 0; i < count; i++) {
                u8 typeU8 = 0;
                s = reader.readUnsignedByte(&typeU8);
                if (!ok(s)) return s;
                RasterShape shape{};
                shape.type = static_cast<RasterShapeType>(typeU8);

                if (shape.type == RasterShapeType::Line) {
                    s = reader.readShort(&shape.x0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.x1); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y1); if (!ok(s)) return s;
                    u32 color = 0;
                    s = reader.readMedium(&color); if (!ok(s)) return s;
                    u8 w = 0;
                    s = reader.readUnsignedByte(&w); if (!ok(s)) return s;
                    shape.fillColor = -1;
                    shape.outlineColor = static_cast<i32>(color);
                    shape.outlineWidth = static_cast<i32>(w);
                } else if (shape.type == RasterShapeType::Bezier) {
                    s = reader.readShort(&shape.x0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.x1); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y1); if (!ok(s)) return s;
                    s = reader.readShort(&shape.x2); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y2); if (!ok(s)) return s;
                    s = reader.readShort(&shape.x3); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y3); if (!ok(s)) return s;
                    u32 color = 0;
                    s = reader.readMedium(&color); if (!ok(s)) return s;
                    u8 w = 0;
                    s = reader.readUnsignedByte(&w); if (!ok(s)) return s;
                    shape.fillColor = -1;
                    shape.outlineColor = static_cast<i32>(color);
                    shape.outlineWidth = static_cast<i32>(w);
                } else if (shape.type == RasterShapeType::Rectangle) {
                    s = reader.readShort(&shape.x0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.x1); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y1); if (!ok(s)) return s;
                    u32 fill = 0;
                    u32 outline = 0;
                    s = reader.readMedium(&fill); if (!ok(s)) return s;
                    s = reader.readMedium(&outline); if (!ok(s)) return s;
                    u8 w = 0;
                    s = reader.readUnsignedByte(&w); if (!ok(s)) return s;
                    shape.fillColor = static_cast<i32>(fill);
                    shape.outlineColor = static_cast<i32>(outline);
                    shape.outlineWidth = static_cast<i32>(w);
                } else if (shape.type == RasterShapeType::Ellipse) {
                    // x, y, sizeX, sizeY
                    s = reader.readShort(&shape.x0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y0); if (!ok(s)) return s;
                    s = reader.readShort(&shape.x1); if (!ok(s)) return s;
                    s = reader.readShort(&shape.y1); if (!ok(s)) return s;
                    u32 fill = 0;
                    u32 outline = 0;
                    s = reader.readMedium(&fill); if (!ok(s)) return s;
                    s = reader.readMedium(&outline); if (!ok(s)) return s;
                    u8 w = 0;
                    s = reader.readUnsignedByte(&w); if (!ok(s)) return s;
                    shape.fillColor = static_cast<i32>(fill);
                    shape.outlineColor = static_cast<i32>(outline);
                    shape.outlineWidth = static_cast<i32>(w);
                } else {
                    // Unknown shape type: ignore by leaving defaults.
                }

                shapes_[static_cast<std::size_t>(i)] = shape;
            }
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            setIsMonochrome(v == 1);
            return Status::Ok;
        }
        (void)alloc;
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        (void)textureGenerator;
        opAlloc_ = &alloc;

        // Whole-image op: force full-cache mode regardless of file's cacheSlotCount.
        if (isMonochrome()) {
            Status s = monochromeCache().init(height, height, width, alloc);
            if (!ok(s)) {
                return s;
            }
            scratchRgb_.clear();
            return Status::Ok;
        }

        Status s = colourCache().init(height, height, width, alloc);
        if (!ok(s)) {
            return s;
        }

        // Scratch buffer used for colour output (row-major RGB ints).
        scratchRgb_ = Vec<i32>(alloc);
        auto rr = scratchRgb_.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < scratchRgb_.size(); i++) {
            scratchRgb_[i] = 0;
        }
        return Status::Ok;
    }

    void clearCaches() noexcept override {
        // Keep capacity by default for reuse across renders; use TextureOperation::releaseCaches()
        // at higher-level lifecycle boundaries if you want to trim memory.
        TextureOperation::clearCaches();
        scratchRgb_.clear();
        rasterizer_.reset();
        opAlloc_ = nullptr;
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
            Span<i32> all;
            const Status s = monochromeCache().getAll(&all);
            if (!ok(s)) {
                return s;
            }
            Allocator& a = opAlloc_ ? *opAlloc_ : textureGenerator.allocator();
            rasterizer_.init(a, all, textureGenerator.width(), textureGenerator.height(), textureGenerator.widthMask(), textureGenerator.heightMask());
            renderWithRasterizer(textureGenerator);
        }
        *out = lineOut;
        return Status::Ok;
    }

    Status getColourOutput(TextureGenerator& textureGenerator, i32 line, ColourLine* out) noexcept override {
        if (!out) {
            return Status::InvalidArgument;
        }
        ColourLine lineOut = colourCache().get(line);
        if (lineOut.r.size() == 0) {
            *out = lineOut;
            return Status::OutOfRange;
        }
        if (colourCache().dirty()) {
            Status s = renderIntoScratch(textureGenerator);
            if (!ok(s)) {
                return s;
            }

            Span<i32> allPlanes;
            s = colourCache().getAll(&allPlanes);
            if (!ok(s)) {
                return s;
            }

            const std::size_t planeSize = static_cast<std::size_t>(textureGenerator.width()) * static_cast<std::size_t>(textureGenerator.height());
            i32* rPlane = allPlanes.data();
            i32* gPlane = allPlanes.data() + planeSize;
            i32* bPlane = allPlanes.data() + 2 * planeSize;

            for (std::size_t idx = 0; idx < planeSize; idx++) {
                const i32 rgb = scratchRgb_[idx];
                rPlane[idx] = (rgb >> 12) & 0xFF0;
                gPlane[idx] = (rgb >> 4) & 0xFF0;
                bPlane[idx] = (rgb & 0xFF) << 4;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    Vec<RasterShape> shapes_{};
    Rasterizer rasterizer_{};
    Vec<i32> scratchRgb_{};
    Allocator* opAlloc_ = nullptr;

    Status renderIntoScratch(TextureGenerator& textureGenerator) noexcept {
        const i32 w = textureGenerator.width();
        const i32 h = textureGenerator.height();
        const std::size_t count = static_cast<std::size_t>(w) * static_cast<std::size_t>(h);
        if (scratchRgb_.size() < count) {
            return Status::OutOfRange;
        }
        for (std::size_t i = 0; i < count; i++) {
            scratchRgb_[i] = 0;
        }
        Allocator& a = opAlloc_ ? *opAlloc_ : textureGenerator.allocator();
        rasterizer_.init(a, scratchRgb_.span(), w, h, textureGenerator.widthMask(), textureGenerator.heightMask());
        renderWithRasterizer(textureGenerator);
        return Status::Ok;
    }

    void renderWithRasterizer(TextureGenerator& textureGenerator) noexcept {
        const i32 width = textureGenerator.width();
        const i32 height = textureGenerator.height();

        rasterizer_.setDimensionMasks(textureGenerator.widthMask(), textureGenerator.heightMask());

        if (shapes_.size() == 0) {
            return;
        }

        for (std::size_t i = 0; i < shapes_.size(); i++) {
            const RasterShape& shape = shapes_[i];
            const i32 fillColor = shape.fillColor;
            const i32 outlineColor = shape.outlineColor;

            switch (shape.type) {
            case RasterShapeType::Line: {
                if (outlineColor < 0) {
                    break;
                }
                const i32 x0 = javaMulShift(static_cast<i32>(shape.x0), width, 12);
                const i32 x1 = javaMulShift(static_cast<i32>(shape.x1), width, 12);
                const i32 y0 = javaMulShift(static_cast<i32>(shape.y0), height, 12);
                const i32 y1 = javaMulShift(static_cast<i32>(shape.y1), height, 12);
                rasterizer_.rasterLine(x0, x1, y0, y1, outlineColor);
                break;
            }
            case RasterShapeType::Bezier: {
                if (outlineColor < 0) {
                    break;
                }
                const i32 x0 = javaMulShift(width, static_cast<i32>(shape.x0), 12);
                const i32 y0 = javaMulShift(height, static_cast<i32>(shape.y0), 12);
                const i32 x1 = javaMulShift(width, static_cast<i32>(shape.x1), 12);
                const i32 y1 = javaMulShift(height, static_cast<i32>(shape.y1), 12);
                const i32 x2 = javaMulShift(width, static_cast<i32>(shape.x2), 12);
                const i32 y2 = javaMulShift(height, static_cast<i32>(shape.y2), 12);
                const i32 x3 = javaMulShift(width, static_cast<i32>(shape.x3), 12);
                const i32 y3 = javaMulShift(height, static_cast<i32>(shape.y3), 12);
                rasterizer_.rasterBezierCurve(x0, y0, x1, y1, x2, y2, x3, y3, outlineColor);
                break;
            }
            case RasterShapeType::Rectangle: {
                const i32 x0 = javaMulShift(static_cast<i32>(shape.x0), width, 12);
                const i32 x1 = javaMulShift(static_cast<i32>(shape.x1), width, 12);
                const i32 y0 = javaMulShift(static_cast<i32>(shape.y0), height, 12);
                const i32 y1 = javaMulShift(static_cast<i32>(shape.y1), height, 12);

                if (fillColor >= 0) {
                    if (outlineColor >= 0) {
                        rasterizer_.rasterRectangle(x0, x1, y0, y1, fillColor, outlineColor, shape.outlineWidth);
                    } else {
                        rasterizer_.rasterRectangleFill(x0, x1, y0, y1, fillColor);
                    }
                } else if (outlineColor >= 0) {
                    rasterizer_.rasterRectangleOutline(x0, x1, y0, y1, outlineColor, shape.outlineWidth);
                }
                break;
            }
            case RasterShapeType::Ellipse: {
                const i32 x = javaMulShift(static_cast<i32>(shape.x0), width, 12);
                const i32 y = javaMulShift(static_cast<i32>(shape.y0), height, 12);
                const i32 sizeX = javaMulShift(static_cast<i32>(shape.x1), width, 12);
                const i32 sizeY = javaMulShift(static_cast<i32>(shape.y1), height, 12);
                if (fillColor >= 0) {
                    if (outlineColor >= 0) {
                        rasterizer_.rasterEllipse(x, y, sizeX, sizeY, fillColor, outlineColor, shape.outlineWidth);
                    } else {
                        rasterizer_.rasterEllipseFill(x, y, sizeX, sizeY, fillColor);
                    }
                } else if (outlineColor >= 0) {
                    // TS has no ellipse outline-only path; ignore.
                }
                break;
            }
            default:
                break;
            }
        }
    }

    void fillColourLineFromScratch(TextureGenerator& textureGenerator, i32 line, ColourLine lineOut) noexcept {
        const i32 w = textureGenerator.width();
        const std::size_t base = static_cast<std::size_t>(line) * static_cast<std::size_t>(w);
        for (i32 x = 0; x < w; x++) {
            const i32 rgb = scratchRgb_[base + static_cast<std::size_t>(x)];
            lineOut.r[static_cast<std::size_t>(x)] = (rgb >> 12) & 0xFF0;
            lineOut.g[static_cast<std::size_t>(x)] = (rgb >> 4) & 0xFF0;
            lineOut.b[static_cast<std::size_t>(x)] = (rgb & 0xFF) << 4;
        }
    }
};

} // namespace rs
