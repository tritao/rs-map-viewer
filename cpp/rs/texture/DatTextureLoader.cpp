#include "DatTextureLoader.hpp"

#include <cstddef>

#include "../core/Move.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../sprite/SpriteLoader.hpp"
#include "../util/ColorUtil.hpp"
#include "../util/StringHash.hpp"

namespace rs {

static i32 hashDatTextureFileName(i32 id) noexcept {
    if (id < 0) {
        return 0;
    }
    // Build "<id>.dat" without STL.
    char buf[32];
    std::size_t len = 0;

    u32 v = static_cast<u32>(id);
    char tmp[16];
    std::size_t tlen = 0;
    do {
        const u32 digit = v % 10u;
        tmp[tlen++] = static_cast<char>('0' + digit);
        v /= 10u;
    } while (v != 0u && tlen < sizeof(tmp));

    // Reverse digits into buf.
    for (std::size_t i = 0; i < tlen && len + 1 < sizeof(buf); i++) {
        buf[len++] = tmp[tlen - 1 - i];
    }

    // Append ".dat".
    if (len + 4 < sizeof(buf)) {
        buf[len++] = '.';
        buf[len++] = 'd';
        buf[len++] = 'a';
        buf[len++] = 't';
    }

    return hashOld(buf, len);
}

Result<DatTextureLoader> DatTextureLoader::create(
    Archive textureArchive,
    Span<const i32> animatedTextureIds,
    Allocator& alloc) noexcept {
    const std::size_t fileCount = textureArchive.files().size();
    const i32 textureCount = fileCount > 0 ? static_cast<i32>(fileCount - 1) : 0;
    const i32 lastTextureId = textureCount - 1;

    Vec<i32> textureIds(alloc);
    if (textureCount > 0) {
        auto rr = textureIds.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) {
            return Result<DatTextureLoader>::err(rr.status());
        }
        for (i32 i = 0; i < textureCount; i++) {
            textureIds[static_cast<std::size_t>(i)] = i;
        }
    }

    Vec<u8> isAnimated(alloc);
    if (textureCount > 0) {
        auto rr = isAnimated.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) {
            return Result<DatTextureLoader>::err(rr.status());
        }
        for (std::size_t i = 0; i < isAnimated.size(); i++) {
            isAnimated[i] = 0;
        }
        for (std::size_t i = 0; i < animatedTextureIds.size(); i++) {
            const i32 id = animatedTextureIds[i];
            if (id < 0 || id > lastTextureId) {
                continue;
            }
            isAnimated[static_cast<std::size_t>(id)] = 1;
        }
    }

    SpriteTable sprites(alloc);
    BoolTable transparent(alloc);
    I32Table averageHsl(alloc);

    if (textureCount > 0) {
        auto rr = sprites.cached.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());
        rr = sprites.status.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());
        rr = sprites.sprites.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());

        for (std::size_t i = 0; i < sprites.cached.size(); i++) {
            sprites.cached[i] = 0;
            sprites.status[i] = Status::Ok;
        }

        rr = transparent.known.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());
        rr = transparent.value.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());
        rr = averageHsl.known.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());
        rr = averageHsl.value.resize(static_cast<std::size_t>(textureCount));
        if (!rr.isOk()) return Result<DatTextureLoader>::err(rr.status());

        for (std::size_t i = 0; i < transparent.known.size(); i++) {
            transparent.known[i] = 0;
            transparent.value[i] = 0;
            averageHsl.known[i] = 0;
            averageHsl.value[i] = 0;
        }
    }

    DatTextureLoader out(rs::move(textureArchive), rs::move(textureIds), rs::move(isAnimated), rs::move(sprites), rs::move(transparent), rs::move(averageHsl));
    return Result<DatTextureLoader>::ok(rs::move(out));
}

DatTextureLoader::DatTextureLoader(
    Archive textureArchive,
    Vec<i32> textureIds,
    Vec<u8> isAnimated,
    SpriteTable sprites,
    BoolTable transparent,
    I32Table averageHsl) noexcept
    : textureArchive_(rs::move(textureArchive)),
      textureIds_(rs::move(textureIds)),
      isAnimated_(rs::move(isAnimated)),
      sprites_(rs::move(sprites)),
      transparent_(rs::move(transparent)),
      averageHsl_(rs::move(averageHsl)) {}

DatTextureLoader& DatTextureLoader::operator=(DatTextureLoader&& other) noexcept {
    if (this == &other) {
        return *this;
    }
    textureArchive_ = rs::move(other.textureArchive_);
    textureIds_ = rs::move(other.textureIds_);
    isAnimated_ = rs::move(other.isAnimated_);
    sprites_ = rs::move(other.sprites_);
    transparent_ = rs::move(other.transparent_);
    averageHsl_ = rs::move(other.averageHsl_);
    return *this;
}

Result<const IndexedSprite*> DatTextureLoader::tryLoadTextureSprite(i32 id, Allocator& alloc) const noexcept {
    if (id < 0) {
        return Result<const IndexedSprite*>::err(Status::OutOfRange);
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= sprites_.cached.size()) {
        return Result<const IndexedSprite*>::err(Status::OutOfRange);
    }

    if (sprites_.cached[idx] != 0) {
        const Status s = sprites_.status[idx];
        if (!ok(s)) {
            return Result<const IndexedSprite*>::err(s);
        }
        return Result<const IndexedSprite*>::ok(&sprites_.sprites[idx]);
    }

    const i32 indexHash = hashOld("index.dat");
    const i32 datHash = hashDatTextureFileName(id);

    const ArchiveFile* indexFile = textureArchive_.getFileByNameHash(indexHash);
    const ArchiveFile* datFile = textureArchive_.getFileByNameHash(datHash);
    if (!indexFile || !datFile) {
        sprites_.cached[idx] = 1;
        sprites_.status[idx] = Status::NotFound;
        transparent_.known[idx] = 1;
        transparent_.value[idx] = 0;
        averageHsl_.known[idx] = 1;
        averageHsl_.value[idx] = 0;
        return Result<const IndexedSprite*>::err(Status::NotFound);
    }

    const Span<const u8> datBytes(datFile->data.data(), datFile->data.size());
    const Span<const u8> indexBytes(indexFile->data.data(), indexFile->data.size());

    auto spriteRes = SpriteLoader::decodeIndexedSpriteDat(datBytes, indexBytes, 0, alloc);
    if (!spriteRes.isOk()) {
        sprites_.cached[idx] = 1;
        sprites_.status[idx] = spriteRes.status();
        transparent_.known[idx] = 1;
        transparent_.value[idx] = 0;
        averageHsl_.known[idx] = 1;
        averageHsl_.value[idx] = 0;
        return Result<const IndexedSprite*>::err(spriteRes.status());
    }
    IndexedSprite sprite = rs::move(spriteRes.value());
    const Status ns = sprite.normalize(alloc);
    if (!ok(ns)) {
        sprites_.cached[idx] = 1;
        sprites_.status[idx] = ns;
        transparent_.known[idx] = 1;
        transparent_.value[idx] = 0;
        averageHsl_.known[idx] = 1;
        averageHsl_.value[idx] = 0;
        return Result<const IndexedSprite*>::err(ns);
    }

    // Cache transparency and averageHsl.
    bool isTransparent = false;
    const Span<const i32> palette = sprite.palette;
    for (std::size_t p = 0; p < sprite.pixels.size(); p++) {
        const u8 palIdx = sprite.pixels[p];
        const std::size_t pi = static_cast<std::size_t>(palIdx);
        if (pi < palette.size() && palette[pi] == 0) {
            isTransparent = true;
            break;
        }
    }
    transparent_.known[idx] = 1;
    transparent_.value[idx] = isTransparent ? 1 : 0;

    i64 sumR = 0;
    i64 sumG = 0;
    i64 sumB = 0;
    const i32 colourCount = static_cast<i32>(palette.size());
    if (colourCount > 0) {
        for (std::size_t i = 0; i < palette.size(); i++) {
            const i32 rgb = palette[i];
            sumR += (rgb >> 16) & 0xFF;
            sumG += (rgb >> 8) & 0xFF;
            sumB += rgb & 0xFF;
        }
        const i32 avgR = static_cast<i32>(sumR / colourCount);
        const i32 avgG = static_cast<i32>(sumG / colourCount);
        const i32 avgB = static_cast<i32>(sumB / colourCount);
        const i32 avgRgb = (avgR << 16) + (avgG << 8) + avgB;
        averageHsl_.known[idx] = 1;
        averageHsl_.value[idx] = rgbToHsl(avgRgb);
    } else {
        averageHsl_.known[idx] = 1;
        averageHsl_.value[idx] = 0;
    }

    sprites_.sprites[idx] = rs::move(sprite);
    sprites_.cached[idx] = 1;
    sprites_.status[idx] = Status::Ok;

    return Result<const IndexedSprite*>::ok(&sprites_.sprites[idx]);
}

bool DatTextureLoader::isSmall(i32 textureId) const noexcept {
    if (textureId < 0) {
        return false;
    }
    const std::size_t idx = static_cast<std::size_t>(textureId);
    if (idx >= sprites_.cached.size()) {
        return false;
    }

    if (sprites_.cached[idx] != 0 && ok(sprites_.status[idx])) {
        return sprites_.sprites[idx].subWidth == 64;
    }

    // Non-allocating fast path: parse header for subWidth.
    const i32 indexHash = hashOld("index.dat");
    const i32 datHash = hashDatTextureFileName(textureId);

    const ArchiveFile* indexFile = textureArchive_.getFileByNameHash(indexHash);
    const ArchiveFile* datFile = textureArchive_.getFileByNameHash(datHash);
    if (!indexFile || !datFile) {
        return false;
    }

    const Span<const u8> datBytes(datFile->data.data(), datFile->data.size());
    const Span<const u8> indexBytes(indexFile->data.data(), indexFile->data.size());
    Uint8ArrayReader dataReader(datBytes, 0);
    Uint8ArrayReader indexReader(indexBytes, 0);

    u16 indexOffsetU16 = 0;
    Status s = dataReader.readUnsignedShort(&indexOffsetU16);
    if (!ok(s)) {
        return false;
    }
    const std::size_t indexOffset = static_cast<std::size_t>(indexOffsetU16);
    if (indexOffset > indexBytes.size()) {
        return false;
    }
    s = indexReader.seek(indexOffset);
    if (!ok(s)) {
        return false;
    }

    u16 w = 0;
    u16 h = 0;
    u8 paletteSize = 0;
    u8 tmp = 0;
    u16 subW = 0;
    u16 subH = 0;

    s = indexReader.readUnsignedShort(&w);
    if (!ok(s)) return false;
    s = indexReader.readUnsignedShort(&h);
    if (!ok(s)) return false;
    s = indexReader.readUnsignedByte(&paletteSize);
    if (!ok(s) || paletteSize == 0) return false;

    const std::size_t paletteBytes = static_cast<std::size_t>(paletteSize - 1) * 3u;
    s = indexReader.skip(paletteBytes);
    if (!ok(s)) return false;

    s = indexReader.readUnsignedByte(&tmp); // xOff
    if (!ok(s)) return false;
    s = indexReader.readUnsignedByte(&tmp); // yOff
    if (!ok(s)) return false;
    s = indexReader.readUnsignedShort(&subW);
    if (!ok(s)) return false;
    s = indexReader.readUnsignedShort(&subH);
    if (!ok(s)) return false;
    s = indexReader.readUnsignedByte(&tmp); // type
    if (!ok(s)) return false;

    (void)w;
    (void)h;
    (void)subH;
    return static_cast<i32>(subW) == 64;
}

bool DatTextureLoader::isTransparent(i32 id) const noexcept {
    if (id < 0) {
        return false;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= transparent_.known.size()) {
        return false;
    }
    if (transparent_.known[idx] != 0) {
        return transparent_.value[idx] != 0;
    }
    (void)tryLoadTextureSprite(id, defaultAllocator());
    return transparent_.known[idx] != 0 && transparent_.value[idx] != 0;
}

i32 DatTextureLoader::getAverageHsl(i32 id) const noexcept {
    if (id < 0) {
        return 0;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= averageHsl_.known.size()) {
        return 0;
    }
    if (averageHsl_.known[idx] != 0) {
        return averageHsl_.value[idx];
    }
    (void)tryLoadTextureSprite(id, defaultAllocator());
    return averageHsl_.known[idx] != 0 ? averageHsl_.value[idx] : 0;
}

Result<Vec<i32>> DatTextureLoader::tryLoadPixelsInternal(
    i32 id,
    i32 size,
    float brightness,
    bool argb,
    Allocator& alloc) const noexcept {
    if (size <= 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }

    auto spriteRes = tryLoadTextureSprite(id, alloc);
    if (!spriteRes.isOk()) {
        return Result<Vec<i32>>::err(spriteRes.status());
    }
    const IndexedSprite* sprite = spriteRes.value();
    if (!sprite) {
        return Result<Vec<i32>>::err(Status::NotFound);
    }

    const Span<const i32> sourcePalette = sprite->palette;
    Vec<i32> palette(alloc);
    auto rr = palette.resize(sourcePalette.size());
    if (!rr.isOk()) {
        return Result<Vec<i32>>::err(rr.status());
    }
    for (std::size_t pi = 0; pi < sourcePalette.size(); pi++) {
        const i32 rgb = sourcePalette[pi];
        const i32 bright = brightenRgb(rgb, brightness);
        if (argb) {
            const i32 alpha = (rgb == 0) ? 0 : 0xFF;
            palette[pi] = (alpha << 24) | bright;
        } else {
            palette[pi] = bright;
        }
    }

    const std::size_t pixelCount = static_cast<std::size_t>(size) * static_cast<std::size_t>(size);
    Vec<i32> pixels(alloc);
    rr = pixels.resize(pixelCount);
    if (!rr.isOk()) {
        return Result<Vec<i32>>::err(rr.status());
    }

    const Vec<u8>& palettePixels = sprite->pixels;
    if (size == sprite->subWidth) {
        if (palettePixels.size() < pixelCount) {
            return Result<Vec<i32>>::err(Status::Truncated);
        }
        for (std::size_t i = 0; i < pixelCount; i++) {
            const std::size_t palIdx = static_cast<std::size_t>(palettePixels[i]);
            pixels[i] = palIdx < palette.size() ? palette[palIdx] : 0;
        }
        return Result<Vec<i32>>::ok(rs::move(pixels));
    }

    if (sprite->subWidth == 64 && size == 128) {
        std::size_t out = 0;
        for (i32 x = 0; x < size; x++) {
            for (i32 y = 0; y < size; y++) {
                const std::size_t srcIdx = (static_cast<std::size_t>(x >> 1) << 6) + static_cast<std::size_t>(y >> 1);
                const std::size_t palIdx = srcIdx < palettePixels.size() ? static_cast<std::size_t>(palettePixels[srcIdx]) : 0;
                pixels[out++] = palIdx < palette.size() ? palette[palIdx] : 0;
            }
        }
        return Result<Vec<i32>>::ok(rs::move(pixels));
    }

    if (sprite->subWidth == 128 && size == 64) {
        std::size_t out = 0;
        for (i32 x = 0; x < size; x++) {
            for (i32 y = 0; y < size; y++) {
                const std::size_t srcIdx = static_cast<std::size_t>(y << 1) + (static_cast<std::size_t>(x << 1) << 7);
                const std::size_t palIdx = srcIdx < palettePixels.size() ? static_cast<std::size_t>(palettePixels[srcIdx]) : 0;
                pixels[out++] = palIdx < palette.size() ? palette[palIdx] : 0;
            }
        }
        return Result<Vec<i32>>::ok(rs::move(pixels));
    }

    return Result<Vec<i32>>::err(Status::Unsupported);
}

Result<Vec<i32>> DatTextureLoader::tryGetPixelsRgb(i32 id, i32 size, bool /*flipH*/, float brightness, Allocator& alloc) const noexcept {
    if (id < 0) {
        return Result<Vec<i32>>::err(Status::OutOfRange);
    }
    return tryLoadPixelsInternal(id, size, brightness, false, alloc);
}

Result<Vec<i32>> DatTextureLoader::tryGetPixelsArgb(i32 id, i32 size, bool /*flipH*/, float brightness, Allocator& alloc) const noexcept {
    if (id < 0) {
        return Result<Vec<i32>>::err(Status::OutOfRange);
    }
    return tryLoadPixelsInternal(id, size, brightness, true, alloc);
}

void DatTextureLoader::clearCache() noexcept {
    for (std::size_t i = 0; i < sprites_.cached.size(); i++) {
        sprites_.cached[i] = 0;
        sprites_.status[i] = Status::Ok;
        transparent_.known[i] = 0;
        transparent_.value[i] = 0;
        averageHsl_.known[i] = 0;
        averageHsl_.value[i] = 0;
    }
}

Status DatTextureLoader::tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    out->pixels.clear();
    out->width = 0;
    out->height = 0;

    auto r = tryGetPixelsRgb(textureId, sizeHint, false, 1.0f, alloc);
    if (!r.isOk()) {
        return r.status();
    }
    out->pixels = rs::move(r.value());
    out->width = sizeHint;
    out->height = sizeHint;
    return Status::Ok;
}

} // namespace rs
