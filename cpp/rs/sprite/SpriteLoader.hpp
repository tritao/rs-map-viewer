#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../types.hpp"
#include "SpriteArchive.hpp"

namespace rs {

class SpriteLoader final {
public:
    static Result<SpriteArchive> decodeSpriteArchive(Span<const u8> data, Allocator& alloc) noexcept;

    // Legacy/old cache indexed-sprite DAT format (data file contains pixel bytes + u16 indexOffset;
    // index file contains palette + per-sprite metadata).
    static Result<IndexedSprite> decodeIndexedSpriteDat(
        Span<const u8> datBytes,
        Span<const u8> indexBytes,
        i32 offset,
        Allocator& alloc) noexcept;

    static Result<Vec<IndexedSprite>> decodeIndexedSpritesDat(
        Span<const u8> datBytes,
        Span<const u8> indexBytes,
        Allocator& alloc) noexcept;
};

} // namespace rs
