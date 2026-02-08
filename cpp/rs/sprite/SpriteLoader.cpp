#include "SpriteLoader.hpp"

#include <cstddef>

#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"
#include "IndexedSprite.hpp"
#include "SpriteArchive.hpp"

namespace rs {

Result<SpriteArchive> SpriteLoader::decodeSpriteArchive(Span<const u8> data, Allocator& alloc) noexcept {
    if (data.size() < 2) {
        return Result<SpriteArchive>::err(Status::Truncated);
    }

    Uint8ArrayReader reader(data, 0);

    // Footer: spriteCount u16 (big-endian) at the end.
    const std::size_t len = data.size();
    Status s = reader.seek(len - 2);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }
    u16 spriteCountU16 = 0;
    s = reader.readUnsignedShort(&spriteCountU16);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }
    const i32 spriteCount = static_cast<i32>(spriteCountU16);
    if (spriteCount < 0) {
        return Result<SpriteArchive>::err(Status::BadFormat);
    }
    if (spriteCount == 0) {
        SpriteArchive out(alloc);
        return Result<SpriteArchive>::ok(rs::move(out));
    }

    // Metadata block starts at len - (7 + spriteCount*8).
    const std::size_t metaBytes = static_cast<std::size_t>(7) + static_cast<std::size_t>(spriteCount) * 8u;
    if (metaBytes > len) {
        return Result<SpriteArchive>::err(Status::BadFormat);
    }
    const std::size_t metaOffset = len - metaBytes;
    s = reader.seek(metaOffset);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }

    u16 widthU16 = 0;
    u16 heightU16 = 0;
    s = reader.readUnsignedShort(&widthU16);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }
    s = reader.readUnsignedShort(&heightU16);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }
    const i32 width = static_cast<i32>(widthU16);
    const i32 height = static_cast<i32>(heightU16);

    u8 paletteSizeMinus1 = 0;
    s = reader.readUnsignedByte(&paletteSizeMinus1);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }
    const i32 paletteSize = static_cast<i32>(paletteSizeMinus1) + 1;
    if (paletteSize <= 0) {
        return Result<SpriteArchive>::err(Status::BadFormat);
    }

    Vec<i32> xOffsets(alloc);
    Vec<i32> yOffsets(alloc);
    Vec<i32> subWidths(alloc);
    Vec<i32> subHeights(alloc);
    auto rr = xOffsets.resize(static_cast<std::size_t>(spriteCount));
    if (!rr.isOk()) {
        return Result<SpriteArchive>::err(rr.status());
    }
    rr = yOffsets.resize(static_cast<std::size_t>(spriteCount));
    if (!rr.isOk()) {
        return Result<SpriteArchive>::err(rr.status());
    }
    rr = subWidths.resize(static_cast<std::size_t>(spriteCount));
    if (!rr.isOk()) {
        return Result<SpriteArchive>::err(rr.status());
    }
    rr = subHeights.resize(static_cast<std::size_t>(spriteCount));
    if (!rr.isOk()) {
        return Result<SpriteArchive>::err(rr.status());
    }

    for (i32 i = 0; i < spriteCount; i++) {
        u16 v = 0;
        s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return Result<SpriteArchive>::err(s);
        }
        xOffsets[static_cast<std::size_t>(i)] = static_cast<i32>(v);
    }
    for (i32 i = 0; i < spriteCount; i++) {
        u16 v = 0;
        s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return Result<SpriteArchive>::err(s);
        }
        yOffsets[static_cast<std::size_t>(i)] = static_cast<i32>(v);
    }
    for (i32 i = 0; i < spriteCount; i++) {
        u16 v = 0;
        s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return Result<SpriteArchive>::err(s);
        }
        subWidths[static_cast<std::size_t>(i)] = static_cast<i32>(v);
    }
    for (i32 i = 0; i < spriteCount; i++) {
        u16 v = 0;
        s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return Result<SpriteArchive>::err(s);
        }
        subHeights[static_cast<std::size_t>(i)] = static_cast<i32>(v);
    }

    // Palette lives immediately before the metadata block: (paletteSize-1) * 3 bytes.
    const std::size_t paletteBytes = static_cast<std::size_t>(paletteSize - 1) * 3u;
    if (paletteBytes > metaOffset) {
        return Result<SpriteArchive>::err(Status::BadFormat);
    }
    const std::size_t paletteOffset = metaOffset - paletteBytes;
    s = reader.seek(paletteOffset);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }

    SpriteArchive out(alloc);
    out.width = width;
    out.height = height;

    rr = out.palette.resize(static_cast<std::size_t>(paletteSize));
    if (!rr.isOk()) {
        return Result<SpriteArchive>::err(rr.status());
    }
    out.palette[0] = 0;
    for (i32 i = 1; i < paletteSize; i++) {
        u32 color = 0;
        s = reader.readMedium(&color);
        if (!ok(s)) {
            return Result<SpriteArchive>::err(s);
        }
        if (color == 0) {
            color = 1;
        }
        out.palette[static_cast<std::size_t>(i)] = static_cast<i32>(color);
    }

    rr = out.sprites.resize(static_cast<std::size_t>(spriteCount));
    if (!rr.isOk()) {
        return Result<SpriteArchive>::err(rr.status());
    }

    // Pixel payload starts at offset 0.
    s = reader.seek(0);
    if (!ok(s)) {
        return Result<SpriteArchive>::err(s);
    }

    const Span<const i32> paletteSpan(out.palette.data(), out.palette.size());

    for (i32 i = 0; i < spriteCount; i++) {
        const std::size_t idx = static_cast<std::size_t>(i);
        const i32 sw = subWidths[idx];
        const i32 sh = subHeights[idx];
        if (sw < 0 || sh < 0) {
            return Result<SpriteArchive>::err(Status::BadFormat);
        }
        const std::size_t pixelCount = static_cast<std::size_t>(sw) * static_cast<std::size_t>(sh);

        u8 dim = 0;
        s = reader.readUnsignedByte(&dim);
        if (!ok(s)) {
            return Result<SpriteArchive>::err(s);
        }

        IndexedSprite sprite;
        sprite.width = width;
        sprite.height = height;
        sprite.xOffset = xOffsets[idx];
        sprite.yOffset = yOffsets[idx];
        sprite.subWidth = sw;
        sprite.subHeight = sh;
        sprite.palette = paletteSpan;
        sprite.pixels = Vec<u8>(alloc);

        rr = sprite.pixels.resize(pixelCount);
        if (!rr.isOk()) {
            return Result<SpriteArchive>::err(rr.status());
        }

        if (dim == 0) {
            for (std::size_t p = 0; p < pixelCount; p++) {
                i8 v = 0;
                s = reader.readByte(&v);
                if (!ok(s)) {
                    return Result<SpriteArchive>::err(s);
                }
                sprite.pixels[p] = static_cast<u8>(v);
            }
        } else if (dim == 1) {
            for (i32 x = 0; x < sw; x++) {
                for (i32 y = 0; y < sh; y++) {
                    i8 v = 0;
                    s = reader.readByte(&v);
                    if (!ok(s)) {
                        return Result<SpriteArchive>::err(s);
                    }
                    const std::size_t p = static_cast<std::size_t>(x) + static_cast<std::size_t>(y) * static_cast<std::size_t>(sw);
                    if (p < sprite.pixels.size()) {
                        sprite.pixels[p] = static_cast<u8>(v);
                    }
                }
            }
        } else {
            return Result<SpriteArchive>::err(Status::BadFormat);
        }

        out.sprites[idx] = rs::move(sprite);
    }

    return Result<SpriteArchive>::ok(rs::move(out));
}

Result<IndexedSprite> SpriteLoader::decodeIndexedSpriteDat(
    Span<const u8> datBytes,
    Span<const u8> indexBytes,
    i32 offset,
    Allocator& alloc) noexcept {
    if (offset < 0) {
        return Result<IndexedSprite>::err(Status::OutOfRange);
    }

    Uint8ArrayReader dataReader(datBytes, 0);
    Uint8ArrayReader indexReader(indexBytes, 0);

    u16 indexOffsetU16 = 0;
    Status s = dataReader.readUnsignedShort(&indexOffsetU16);
    if (!ok(s)) {
        return Result<IndexedSprite>::err(s);
    }
    const std::size_t indexOffset = static_cast<std::size_t>(indexOffsetU16);
    if (indexOffset > indexBytes.size()) {
        return Result<IndexedSprite>::err(Status::BadFormat);
    }
    s = indexReader.seek(indexOffset);
    if (!ok(s)) {
        return Result<IndexedSprite>::err(s);
    }

    u16 widthU16 = 0;
    u16 heightU16 = 0;
    s = indexReader.readUnsignedShort(&widthU16);
    if (!ok(s)) return Result<IndexedSprite>::err(s);
    s = indexReader.readUnsignedShort(&heightU16);
    if (!ok(s)) return Result<IndexedSprite>::err(s);

    u8 paletteSizeU8 = 0;
    s = indexReader.readUnsignedByte(&paletteSizeU8);
    if (!ok(s)) return Result<IndexedSprite>::err(s);
    const i32 paletteSize = static_cast<i32>(paletteSizeU8);
    if (paletteSize <= 0) {
        return Result<IndexedSprite>::err(Status::BadFormat);
    }

    Vec<i32> palette(alloc);
    auto rr = palette.resize(static_cast<std::size_t>(paletteSize));
    if (!rr.isOk()) {
        return Result<IndexedSprite>::err(rr.status());
    }
    palette[0] = 0;
    for (i32 i = 0; i < paletteSize - 1; i++) {
        u32 color = 0;
        s = indexReader.readMedium(&color);
        if (!ok(s)) return Result<IndexedSprite>::err(s);
        palette[static_cast<std::size_t>(i + 1)] = static_cast<i32>(color);
    }

    for (i32 i = 0; i < offset; i++) {
        u8 tmp = 0;
        u16 swU16 = 0;
        u16 shU16 = 0;

        // xOff, yOff
        s = indexReader.readUnsignedByte(&tmp);
        if (!ok(s)) return Result<IndexedSprite>::err(s);
        s = indexReader.readUnsignedByte(&tmp);
        if (!ok(s)) return Result<IndexedSprite>::err(s);

        s = indexReader.readUnsignedShort(&swU16);
        if (!ok(s)) return Result<IndexedSprite>::err(s);
        s = indexReader.readUnsignedShort(&shU16);
        if (!ok(s)) return Result<IndexedSprite>::err(s);

        // type
        s = indexReader.readUnsignedByte(&tmp);
        if (!ok(s)) return Result<IndexedSprite>::err(s);

        const std::size_t pixelCount = static_cast<std::size_t>(swU16) * static_cast<std::size_t>(shU16);
        if (dataReader.remaining() < pixelCount) {
            return Result<IndexedSprite>::err(Status::Truncated);
        }
        s = dataReader.skip(pixelCount);
        if (!ok(s)) return Result<IndexedSprite>::err(s);
    }

    // Decode target sprite metadata (7 bytes) + pixels.
    u8 xOffU8 = 0;
    u8 yOffU8 = 0;
    u16 subWidthU16 = 0;
    u16 subHeightU16 = 0;
    u8 typeU8 = 0;

    s = indexReader.readUnsignedByte(&xOffU8);
    if (!ok(s)) return Result<IndexedSprite>::err(s);
    s = indexReader.readUnsignedByte(&yOffU8);
    if (!ok(s)) return Result<IndexedSprite>::err(s);
    s = indexReader.readUnsignedShort(&subWidthU16);
    if (!ok(s)) return Result<IndexedSprite>::err(s);
    s = indexReader.readUnsignedShort(&subHeightU16);
    if (!ok(s)) return Result<IndexedSprite>::err(s);
    s = indexReader.readUnsignedByte(&typeU8);
    if (!ok(s)) return Result<IndexedSprite>::err(s);

    const i32 width = static_cast<i32>(widthU16);
    const i32 height = static_cast<i32>(heightU16);
    const i32 subWidth = static_cast<i32>(subWidthU16);
    const i32 subHeight = static_cast<i32>(subHeightU16);
    if (width <= 0 || height <= 0 || subWidth < 0 || subHeight < 0) {
        return Result<IndexedSprite>::err(Status::BadFormat);
    }

    const std::size_t pixelCount = static_cast<std::size_t>(subWidth) * static_cast<std::size_t>(subHeight);
    if (dataReader.remaining() < pixelCount) {
        return Result<IndexedSprite>::err(Status::Truncated);
    }

    IndexedSprite sprite;
    sprite.width = width;
    sprite.height = height;
    sprite.xOffset = static_cast<i32>(xOffU8);
    sprite.yOffset = static_cast<i32>(yOffU8);
    sprite.subWidth = subWidth;
    sprite.subHeight = subHeight;
    sprite.paletteOwned = rs::move(palette);
    sprite.palette = Span<const i32>(sprite.paletteOwned.data(), sprite.paletteOwned.size());
    sprite.pixels = Vec<u8>(alloc);

    rr = sprite.pixels.resize(pixelCount);
    if (!rr.isOk()) {
        return Result<IndexedSprite>::err(rr.status());
    }

    if (typeU8 == 0) {
        for (std::size_t i = 0; i < pixelCount; i++) {
            i8 v = 0;
            s = dataReader.readByte(&v);
            if (!ok(s)) return Result<IndexedSprite>::err(s);
            sprite.pixels[i] = static_cast<u8>(v);
        }
    } else if (typeU8 == 1) {
        for (i32 x = 0; x < subWidth; x++) {
            for (i32 y = 0; y < subHeight; y++) {
                i8 v = 0;
                s = dataReader.readByte(&v);
                if (!ok(s)) return Result<IndexedSprite>::err(s);
                const std::size_t i = static_cast<std::size_t>(x) + static_cast<std::size_t>(y) * static_cast<std::size_t>(subWidth);
                if (i < sprite.pixels.size()) {
                    sprite.pixels[i] = static_cast<u8>(v);
                }
            }
        }
    } else {
        return Result<IndexedSprite>::err(Status::BadFormat);
    }

    return Result<IndexedSprite>::ok(rs::move(sprite));
}

Result<Vec<IndexedSprite>> SpriteLoader::decodeIndexedSpritesDat(
    Span<const u8> datBytes,
    Span<const u8> indexBytes,
    Allocator& alloc) noexcept {
    Uint8ArrayReader dataReader(datBytes, 0);
    Uint8ArrayReader indexReader(indexBytes, 0);

    u16 indexOffsetU16 = 0;
    Status s = dataReader.readUnsignedShort(&indexOffsetU16);
    if (!ok(s)) {
        return Result<Vec<IndexedSprite>>::err(s);
    }
    const std::size_t indexOffset = static_cast<std::size_t>(indexOffsetU16);
    if (indexOffset > indexBytes.size()) {
        return Result<Vec<IndexedSprite>>::err(Status::BadFormat);
    }
    s = indexReader.seek(indexOffset);
    if (!ok(s)) {
        return Result<Vec<IndexedSprite>>::err(s);
    }

    u16 widthU16 = 0;
    u16 heightU16 = 0;
    s = indexReader.readUnsignedShort(&widthU16);
    if (!ok(s)) return Result<Vec<IndexedSprite>>::err(s);
    s = indexReader.readUnsignedShort(&heightU16);
    if (!ok(s)) return Result<Vec<IndexedSprite>>::err(s);
    const i32 width = static_cast<i32>(widthU16);
    const i32 height = static_cast<i32>(heightU16);

    u8 paletteSizeU8 = 0;
    s = indexReader.readUnsignedByte(&paletteSizeU8);
    if (!ok(s)) return Result<Vec<IndexedSprite>>::err(s);
    const i32 paletteSize = static_cast<i32>(paletteSizeU8);
    if (paletteSize <= 0) {
        return Result<Vec<IndexedSprite>>::err(Status::BadFormat);
    }

    Vec<i32> palette(alloc);
    auto rr = palette.resize(static_cast<std::size_t>(paletteSize));
    if (!rr.isOk()) {
        return Result<Vec<IndexedSprite>>::err(rr.status());
    }
    palette[0] = 0;
    for (i32 i = 0; i < paletteSize - 1; i++) {
        u32 color = 0;
        s = indexReader.readMedium(&color);
        if (!ok(s)) return Result<Vec<IndexedSprite>>::err(s);
        palette[static_cast<std::size_t>(i + 1)] = static_cast<i32>(color);
    }

    Vec<IndexedSprite> sprites(alloc);

    while (indexReader.remaining() >= 7) {
        u8 xOffU8 = 0;
        u8 yOffU8 = 0;
        u16 subWidthU16 = 0;
        u16 subHeightU16 = 0;
        u8 typeU8 = 0;

        s = indexReader.readUnsignedByte(&xOffU8);
        if (!ok(s)) break;
        s = indexReader.readUnsignedByte(&yOffU8);
        if (!ok(s)) break;
        s = indexReader.readUnsignedShort(&subWidthU16);
        if (!ok(s)) break;
        s = indexReader.readUnsignedShort(&subHeightU16);
        if (!ok(s)) break;
        s = indexReader.readUnsignedByte(&typeU8);
        if (!ok(s)) break;

        const std::size_t pixelCount = static_cast<std::size_t>(subWidthU16) * static_cast<std::size_t>(subHeightU16);
        if (dataReader.remaining() < pixelCount) {
            break;
        }

        IndexedSprite sprite;
        sprite.width = width;
        sprite.height = height;
        sprite.xOffset = static_cast<i32>(xOffU8);
        sprite.yOffset = static_cast<i32>(yOffU8);
        sprite.subWidth = static_cast<i32>(subWidthU16);
        sprite.subHeight = static_cast<i32>(subHeightU16);
        sprite.paletteOwned = Vec<i32>(alloc);
        rr = sprite.paletteOwned.resize(palette.size());
        if (!rr.isOk()) {
            return Result<Vec<IndexedSprite>>::err(rr.status());
        }
        for (std::size_t i = 0; i < palette.size(); i++) {
            sprite.paletteOwned[i] = palette[i];
        }
        sprite.palette = Span<const i32>(sprite.paletteOwned.data(), sprite.paletteOwned.size());
        sprite.pixels = Vec<u8>(alloc);
        rr = sprite.pixels.resize(pixelCount);
        if (!rr.isOk()) {
            return Result<Vec<IndexedSprite>>::err(rr.status());
        }

        if (typeU8 == 0) {
            for (std::size_t i = 0; i < pixelCount; i++) {
                i8 v = 0;
                s = dataReader.readByte(&v);
                if (!ok(s)) return Result<Vec<IndexedSprite>>::err(s);
                sprite.pixels[i] = static_cast<u8>(v);
            }
        } else if (typeU8 == 1) {
            const i32 sw = sprite.subWidth;
            const i32 sh = sprite.subHeight;
            for (i32 x = 0; x < sw; x++) {
                for (i32 y = 0; y < sh; y++) {
                    i8 v = 0;
                    s = dataReader.readByte(&v);
                    if (!ok(s)) return Result<Vec<IndexedSprite>>::err(s);
                    const std::size_t i = static_cast<std::size_t>(x) + static_cast<std::size_t>(y) * static_cast<std::size_t>(sw);
                    if (i < sprite.pixels.size()) {
                        sprite.pixels[i] = static_cast<u8>(v);
                    }
                }
            }
        } else {
            break;
        }

        auto pr = sprites.pushBack(rs::move(sprite));
        if (!pr.isOk()) {
            return Result<Vec<IndexedSprite>>::err(pr.status());
        }
    }

    return Result<Vec<IndexedSprite>>::ok(rs::move(sprites));
}

} // namespace rs
