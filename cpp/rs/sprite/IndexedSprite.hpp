#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

struct IndexedSprite final {
    i32 width = 0;
    i32 height = 0;

    i32 xOffset = 0;
    i32 yOffset = 0;
    i32 subWidth = 0;
    i32 subHeight = 0;

    // Optional owned palette storage (used by legacy indexed-sprite DAT decoding).
    Vec<i32> paletteOwned{};
    Span<const i32> palette;
    Vec<u8> pixels{};

    // Mirrors `IndexedSprite.normalize()` (TS): expands sub-rectangle into full (width*height) pixels.
    Status normalize(Allocator& alloc) noexcept {
        if (subWidth <= 0 || subHeight <= 0 || width <= 0 || height <= 0) {
            return Status::BadFormat;
        }
        if (subWidth == width && subHeight == height && xOffset == 0 && yOffset == 0) {
            return Status::Ok;
        }

        const std::size_t fullCount = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
        Vec<u8> full(alloc);
        auto rr = full.resize(fullCount);
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < full.size(); i++) {
            full[i] = 0;
        }

        const std::size_t subCount = static_cast<std::size_t>(subWidth) * static_cast<std::size_t>(subHeight);
        if (pixels.size() < subCount) {
            return Status::Truncated;
        }

        for (i32 y = 0; y < subHeight; y++) {
            for (i32 x = 0; x < subWidth; x++) {
                const i32 dstX = x + xOffset;
                const i32 dstY = y + yOffset;
                if (dstX < 0 || dstY < 0 || dstX >= width || dstY >= height) {
                    continue;
                }
                const std::size_t srcIdx = static_cast<std::size_t>(x) + static_cast<std::size_t>(y) * static_cast<std::size_t>(subWidth);
                const std::size_t dstIdx = static_cast<std::size_t>(dstX) + static_cast<std::size_t>(dstY) * static_cast<std::size_t>(width);
                full[dstIdx] = pixels[srcIdx];
            }
        }

        pixels = rs::move(full);
        subWidth = width;
        subHeight = height;
        xOffset = 0;
        yOffset = 0;
        return Status::Ok;
    }
};

} // namespace rs
