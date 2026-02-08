#pragma once

#include <cstddef>

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../../../util/JavaRandom.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

enum class CornerBlendMode : u8 {
    Multiply = 0,
    Min = 1,
};

class IrregularBricksOperation final : public TextureOperationImpl<IrregularBricksOperation> {
public:
    IrregularBricksOperation() noexcept : TextureOperationImpl(0, true) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            seed_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            minBrickWidthQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            maxBrickWidthQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 3) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            minBrickHeightQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 4) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            maxBrickHeightQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 5) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            bevelRadiusScaleQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 6) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) return s;
            cornerBlendMode_ = static_cast<CornerBlendMode>(v);
            return Status::Ok;
        }
        if (fieldId == 7) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            bevelJitterQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 8) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            brickValueVariationQ12_ = static_cast<i32>(v);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept override {
        (void)textureGenerator;
        opAlloc_ = &alloc;
        // Whole-image operation: force full-cache mode.
        const Status s = monochromeCache().init(height, height, width, alloc);
        if (!ok(s)) {
            return s;
        }

        // Allocate segment buffers (reused across renders).
        const i32 minBrickWidthPx = javaMulShift(minBrickWidthQ12_, width, 12);
        if (minBrickWidthPx <= 0) {
            return Status::InvalidArgument;
        }
        const i32 maxSegments = (width / minBrickWidthPx) + 1;
        segments_ = Vec<Segment>(alloc);
        prevSegments_ = Vec<Segment>(alloc);
        auto rr = segments_.resize(static_cast<std::size_t>(maxSegments));
        if (!rr.isOk()) return rr.status();
        rr = prevSegments_.resize(static_cast<std::size_t>(maxSegments));
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < segments_.size(); i++) {
            segments_[i] = Segment{};
            prevSegments_[i] = Segment{};
        }
        return Status::Ok;
    }

    void clearCaches() noexcept override {
        // Keep capacity by default for reuse.
        TextureOperation::clearCaches();
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
        if (!monochromeCache().dirty()) {
            *out = lineOut;
            return Status::Ok;
        }

        Span<i32> all;
        Status s = monochromeCache().getAll(&all);
        if (!ok(s)) {
            *out = lineOut;
            return s;
        }

        render(textureGenerator, all);

        *out = lineOut;
        return Status::Ok;
    }

private:
    struct Segment final {
        i32 x0 = 0;
        i32 x1 = 0;
        i32 y2 = 0;
    };

    i32 seed_ = 0;
    i32 minBrickWidthQ12_ = 1024;
    i32 maxBrickWidthQ12_ = 2048;
    i32 minBrickHeightQ12_ = 409;
    i32 maxBrickHeightQ12_ = 819;
    i32 bevelRadiusScaleQ12_ = 1024;
    CornerBlendMode cornerBlendMode_ = CornerBlendMode::Multiply;
    i32 bevelJitterQ12_ = 1024;
    i32 brickValueVariationQ12_ = 1024;

    i32 bevelRadiusPx_ = 0;

    Allocator* opAlloc_ = nullptr;
    Vec<Segment> segments_{};
    Vec<Segment> prevSegments_{};

    inline i32* rowPtr(Span<i32> pixels, i32 y, i32 width) noexcept {
        return pixels.data() + static_cast<std::size_t>(y) * static_cast<std::size_t>(width);
    }

    static inline i32 minI32(i32 a, i32 b) noexcept { return (a < b) ? a : b; }
    static inline i32 maxI32(i32 a, i32 b) noexcept { return (a > b) ? a : b; }

    inline void fillRow(i32* row, i32 startX, i32 len, i32 value) noexcept {
        for (i32 i = 0; i < len; i++) {
            row[static_cast<std::size_t>(startX + i)] = value;
        }
    }

    void drawBrick(TextureGenerator& textureGenerator, Span<i32> pixels, i32 brickHeightPx, i32 brickWidthPx, i32 startX, i32 startY, JavaRandom& random) noexcept {
        const i32 w = textureGenerator.width();
        const i32 wMask = textureGenerator.widthMask();
        const i32 brickValue = (brickValueVariationQ12_ > 0) ? (4096 - nextIntJagex(random, brickValueVariationQ12_)) : 4096;
        const i32 bevelJitterPx = javaMulShift(bevelRadiusPx_, bevelJitterQ12_, 12);
        const i32 bevelRadiusPx = bevelRadiusPx_ - ((bevelJitterPx > 0) ? nextIntJagex(random, bevelJitterPx) : 0);

        if (w <= startX) {
            startX -= w;
        }

        if (bevelRadiusPx > 0) {
            if (brickHeightPx <= 0 || brickWidthPx <= 0) {
                return;
            }

            const i32 halfWidth = brickWidthPx / 2;
            const i32 halfHeight = brickHeightPx / 2;
            const i32 bevelWidthPx = (halfWidth >= bevelRadiusPx) ? bevelRadiusPx : halfWidth;
            const i32 bevelHeightPx = (bevelRadiusPx > halfHeight) ? halfHeight : bevelRadiusPx;
            const i32 innerStartX = startX + bevelWidthPx;
            const i32 innerWidth = brickWidthPx - bevelWidthPx * 2;

            for (i32 y = 0; y < brickHeightPx; y++) {
                i32* row = rowPtr(pixels, y + startY, w);
                if (bevelHeightPx <= y) {
                    const i32 invY = brickHeightPx - y - 1;
                    if (bevelHeightPx <= invY) {
                        for (i32 dx = 0; dx < bevelWidthPx; dx++) {
                            const i32 v = (brickValue * dx) / bevelWidthPx;
                            row[static_cast<std::size_t>(wMask & (startX + dx))] =
                                row[static_cast<std::size_t>(wMask & (brickWidthPx + startX - dx - 1))] = v;
                        }
                        if (innerStartX + innerWidth <= w) {
                            fillRow(row, innerStartX, innerWidth, brickValue);
                        } else {
                            const i32 rightLen = w - innerStartX;
                            fillRow(row, innerStartX, rightLen, brickValue);
                            fillRow(row, 0, innerWidth - rightLen, brickValue);
                        }
                    } else {
                        const i32 verticalFade = (invY * brickValue) / bevelHeightPx;
                        if (cornerBlendMode_ == CornerBlendMode::Multiply) {
                            for (i32 dx = 0; dx < bevelWidthPx; dx++) {
                                const i32 horizontalFade = (dx * brickValue) / bevelWidthPx;
                                const i32 v = javaMulShift(verticalFade, horizontalFade, 12);
                                row[static_cast<std::size_t>(wMask & (startX + dx))] =
                                    row[static_cast<std::size_t>((brickWidthPx + startX - dx - 1) & wMask)] = v;
                            }
                        } else {
                            for (i32 dx = 0; dx < bevelWidthPx; dx++) {
                                const i32 horizontalFade = (brickValue * dx) / bevelWidthPx;
                                const i32 v = (verticalFade > horizontalFade) ? horizontalFade : verticalFade;
                                row[static_cast<std::size_t>(wMask & (dx + startX))] =
                                    row[static_cast<std::size_t>(wMask & (startX + brickWidthPx - dx - 1))] = v;
                            }
                        }
                        if (w < innerWidth + innerStartX) {
                            const i32 rightLen = w - innerStartX;
                            fillRow(row, innerStartX, rightLen, verticalFade);
                            fillRow(row, 0, innerWidth - rightLen, verticalFade);
                        } else {
                            fillRow(row, innerStartX, innerWidth, verticalFade);
                        }
                    }
                } else {
                    const i32 verticalFade = (y * brickValue) / bevelHeightPx;
                    if (cornerBlendMode_ == CornerBlendMode::Multiply) {
                        for (i32 dx = 0; dx < bevelWidthPx; dx++) {
                            const i32 horizontalFade = (brickValue * dx) / bevelWidthPx;
                            const i32 v = javaMulShift(horizontalFade, verticalFade, 12);
                            row[static_cast<std::size_t>(wMask & (dx + startX))] =
                                row[static_cast<std::size_t>((startX + brickWidthPx - dx - 1) & wMask)] = v;
                        }
                    } else {
                        for (i32 dx = 0; dx < bevelWidthPx; dx++) {
                            const i32 horizontalFade = (brickValue * dx) / bevelWidthPx;
                            const i32 v = (verticalFade <= horizontalFade) ? verticalFade : horizontalFade;
                            row[static_cast<std::size_t>((dx + startX) & wMask)] =
                                row[static_cast<std::size_t>((brickWidthPx + startX - dx - 1) & wMask)] = v;
                        }
                    }

                    if (innerStartX + innerWidth > w) {
                        const i32 rightLen = w - innerStartX;
                        fillRow(row, innerStartX, rightLen, verticalFade);
                        fillRow(row, 0, innerWidth - rightLen, verticalFade);
                    } else {
                        fillRow(row, innerStartX, innerWidth, verticalFade);
                    }
                }
            }
            return;
        }

        if (w >= brickWidthPx + startX) {
            for (i32 y = 0; y < brickHeightPx; y++) {
                fillRow(rowPtr(pixels, y + startY, w), startX, brickWidthPx, brickValue);
            }
        } else {
            const i32 rightLen = w - startX;
            for (i32 y = 0; y < brickHeightPx; y++) {
                i32* row = rowPtr(pixels, y + startY, w);
                fillRow(row, startX, rightLen, brickValue);
                fillRow(row, 0, brickWidthPx - rightLen, brickValue);
            }
        }
    }

    void render(TextureGenerator& textureGenerator, Span<i32> pixels) noexcept {
        const i32 w = textureGenerator.width();
        const i32 h = textureGenerator.height();
        i32 rowXDelta = 0;
        i32 rowXOffset = 0;
        i32 xCursor = 0;
        i32 prevRowXOffset = 0;
        i32 segmentCursor = 0;
        bool isFirstRow = true;
        i32 segmentCount = 0;
        bool reachedBottom = true;
        const i32 minBrickWidthPx = javaMulShift(minBrickWidthQ12_, w, 12);
        i32 segmentWriteIndex = 0;
        const i32 minBrickHeightPx = javaMulShift(minBrickHeightQ12_, h, 12);
        const i32 maxBrickWidthPx = javaMulShift(w, maxBrickWidthQ12_, 12);
        const i32 maxBrickHeightPx = javaMulShift(maxBrickHeightQ12_, h, 12);
        if (maxBrickHeightPx <= 1) {
            return;
        }

        bevelRadiusPx_ = static_cast<i32>((static_cast<double>(w) / 8.0) * static_cast<double>(bevelRadiusScaleQ12_) / 4096.0);

        JavaRandom random(static_cast<u64>(seed_));

        // Clear segment buffers.
        for (std::size_t i = 0; i < segments_.size(); i++) {
            segments_[i] = Segment{};
            prevSegments_[i] = Segment{};
        }

        for (;;) {
            for (;;) {
                i32 brickWidthPx = minBrickWidthPx + nextIntJagex(random, maxBrickWidthPx - minBrickWidthPx);
                i32 brickHeightPx = nextIntJagex(random, maxBrickHeightPx - minBrickHeightPx) + minBrickHeightPx;
                i32 xEnd = xCursor + brickWidthPx;
                if (xEnd > w) {
                    brickWidthPx = w - xCursor;
                    xEnd = w;
                }

                i32 startY = 0;
                if (!isFirstRow) {
                    i32 searchIndex = segmentCursor;
                    const Segment& baseSegment = prevSegments_[static_cast<std::size_t>(segmentCursor)];
                    startY = baseSegment.y2;
                    i32 scannedCount = 0;
                    i32 targetX = rowXDelta + xEnd;
                    if (targetX < 0) {
                        targetX += w;
                    }
                    if (w < targetX) {
                        targetX -= w;
                    }

                    for (;;) {
                        const Segment& segment = prevSegments_[static_cast<std::size_t>(searchIndex)];
                        if (segment.x0 <= targetX && targetX <= segment.x1) {
                            if (searchIndex != segmentCursor) {
                                i32 startX = xCursor + rowXDelta;
                                if (startX < 0) {
                                    startX += w;
                                }
                                if (startX > w) {
                                    startX -= w;
                                }

                                for (i32 i = 1; i <= scannedCount; i++) {
                                    const i32 idx = (i + segmentCursor) % segmentCount;
                                    const Segment& seg = prevSegments_[static_cast<std::size_t>(idx)];
                                    startY = maxI32(startY, seg.y2);
                                }

                                for (i32 i = 0; i <= scannedCount; i++) {
                                    const i32 idx = (i + segmentCursor) % segmentCount;
                                    const Segment& seg = prevSegments_[static_cast<std::size_t>(idx)];
                                    const i32 segBottomY = seg.y2;
                                    if (segBottomY != startY) {
                                        const i32 segEndX = seg.x1;
                                        const i32 segStartX = seg.x0;
                                        i32 fillStartX = 0;
                                        i32 fillEndX = 0;
                                        if (startX < targetX) {
                                            fillStartX = maxI32(startX, segStartX);
                                            fillEndX = minI32(targetX, segEndX);
                                        } else if (segStartX == 0) {
                                            fillEndX = minI32(targetX, segEndX);
                                            fillStartX = 0;
                                        } else {
                                            fillStartX = maxI32(startX, segStartX);
                                            fillEndX = w;
                                        }
                                        drawBrick(
                                            textureGenerator,
                                            pixels,
                                            startY - segBottomY,
                                            fillEndX - fillStartX,
                                            prevRowXOffset + fillStartX,
                                            segBottomY,
                                            random);
                                    }
                                }
                            }
                            segmentCursor = searchIndex;
                            break;
                        }
                        searchIndex++;
                        if (searchIndex >= segmentCount) {
                            searchIndex = 0;
                        }
                        scannedCount++;
                    }
                }

                if (h < brickHeightPx + startY) {
                    brickHeightPx = h - startY;
                } else {
                    reachedBottom = false;
                }

                if (xEnd == w) {
                    drawBrick(textureGenerator, pixels, brickHeightPx, brickWidthPx, xCursor + rowXOffset, startY, random);
                    if (reachedBottom) {
                        return;
                    }

                    isFirstRow = false;
                    const i32 newSegmentCount = segmentWriteIndex + 1;
                    Segment& seg = segments_[static_cast<std::size_t>(segmentWriteIndex)];
                    reachedBottom = true;
                    seg.x1 = xEnd;
                    prevRowXOffset = rowXOffset;
                    segmentCount = newSegmentCount;
                    seg.x0 = xCursor;
                    seg.y2 = brickHeightPx + startY;
                    rowXOffset = nextIntJagex(random, w);

                    Vec<Segment> tmp = rs::move(prevSegments_);
                    segmentCursor = 0;
                    rowXDelta = rowXOffset - prevRowXOffset;
                    prevSegments_ = rs::move(segments_);
                    i32 xProbe = rowXDelta;
                    segments_ = rs::move(tmp);
                    if (rowXDelta < 0) {
                        xProbe = rowXDelta + w;
                    }
                    segmentWriteIndex = 0;
                    if (w < xProbe) {
                        xProbe -= w;
                    }
                    for (;;) {
                        const Segment& segCheck = prevSegments_[static_cast<std::size_t>(segmentCursor)];
                        if (xProbe >= segCheck.x0 && segCheck.x1 >= xProbe) {
                            xCursor = 0;
                            break;
                        }
                        segmentCursor++;
                        if (segmentCount <= segmentCursor) {
                            segmentCursor = 0;
                        }
                    }
                } else {
                    Segment& seg = segments_[static_cast<std::size_t>(segmentWriteIndex++)];
                    seg.x1 = xEnd;
                    seg.y2 = brickHeightPx + startY;
                    seg.x0 = xCursor;
                    drawBrick(textureGenerator, pixels, brickHeightPx, brickWidthPx, rowXOffset + xCursor, startY, random);
                    xCursor = xEnd;
                }
            }
        }
    }
};

} // namespace rs
