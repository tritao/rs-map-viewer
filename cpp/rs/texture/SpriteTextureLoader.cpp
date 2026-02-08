#include "SpriteTextureLoader.hpp"

#include <cstddef>

#include "../cache/format/Archive.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../sprite/SpriteLoader.hpp"
#include "../util/ColorUtil.hpp"
#include "../types.hpp"

namespace rs {

Status SpriteTextureDefinition::decode(i32 id, Span<const u8> bytes, SpriteTextureDefinition* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    Uint8ArrayReader reader(bytes, 0);

    u16 avg = 0;
    Status s = reader.readUnsignedShort(&avg);
    if (!ok(s)) {
        return s;
    }
    u8 opaqueU8 = 0;
    s = reader.readUnsignedByte(&opaqueU8);
    if (!ok(s)) {
        return s;
    }

    u8 spriteCount = 0;
    s = reader.readUnsignedByte(&spriteCount);
    if (!ok(s)) {
        return s;
    }
    if (spriteCount < 1 || spriteCount > 4) {
        return Status::BadFormat;
    }

    SpriteTextureDefinition def{};
    def.id = id;
    def.averageHsl = static_cast<i32>(avg);
    def.opaque = (opaqueU8 == 1);
    def.spriteCount = spriteCount;

    for (u8 i = 0; i < spriteCount; i++) {
        u16 spriteId = 0;
        s = reader.readUnsignedShort(&spriteId);
        if (!ok(s)) {
            return s;
        }
        def.spriteIds[i] = static_cast<i32>(spriteId);
    }

    if (spriteCount > 1) {
        def.hasSpriteTypes = true;
        const u8 typeCount = static_cast<u8>(spriteCount - 1);
        if (typeCount > 3) {
            return Status::BadFormat;
        }
        for (u8 i = 0; i < typeCount; i++) {
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            def.spriteTypes[static_cast<std::size_t>(i)] = v;
        }
        // Skip "unused" (spriteCount-1 bytes).
        for (u8 i = 0; i < typeCount; i++) {
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
        }
    }

    for (u8 i = 0; i < spriteCount; i++) {
        i32 t = 0;
        s = reader.readInt(&t);
        if (!ok(s)) {
            return s;
        }
        def.transforms[i] = t;
    }

    u8 animDir = 0;
    u8 animSpeed = 0;
    s = reader.readUnsignedByte(&animDir);
    if (!ok(s)) {
        return s;
    }
    s = reader.readUnsignedByte(&animSpeed);
    if (!ok(s)) {
        return s;
    }
    def.animationDirection = animDir;
    def.animationSpeed = animSpeed;

    *out = def;
    return Status::Ok;
}

Result<SpriteTextureLoader> SpriteTextureLoader::create(const Archive& definitionArchive, const CacheIndex& spriteIndex, Allocator& alloc) noexcept {
    const Span<const ArchiveFile> files = definitionArchive.files();
    i32 maxId = -1;
    for (std::size_t i = 0; i < files.size(); i++) {
        if (files[i].id > maxId) {
            maxId = files[i].id;
        }
    }
    const i32 count = (maxId < 0) ? 0 : (maxId + 1);

    Vec<SpriteTextureDefinition> defs(alloc);
    auto rr = defs.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<SpriteTextureLoader>::err(rr.status());
    }

    Vec<Status> statusById(alloc);
    rr = statusById.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<SpriteTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < statusById.size(); i++) {
        statusById[i] = Status::NotFound;
    }

    for (std::size_t i = 0; i < files.size(); i++) {
        const ArchiveFile& f = files[i];
        if (f.id < 0 || f.id >= count) {
            continue;
        }
        const i32 id = f.id;
        SpriteTextureDefinition def{};
        const Status s = SpriteTextureDefinition::decode(id, f.data.span(), &def);
        defs[static_cast<std::size_t>(id)] = def;
        statusById[static_cast<std::size_t>(id)] = s;
    }

    return Result<SpriteTextureLoader>::ok(SpriteTextureLoader(&spriteIndex, rs::move(defs), rs::move(statusById), count));
}

Result<SpriteTextureLoader> SpriteTextureLoader::createEmpty(const CacheIndex& spriteIndex, Allocator& alloc) noexcept {
    Vec<SpriteTextureDefinition> defs(alloc);
    Vec<Status> statusById(alloc);
    return Result<SpriteTextureLoader>::ok(SpriteTextureLoader(&spriteIndex, rs::move(defs), rs::move(statusById), 0));
}

Status SpriteTextureLoader::getDefinition(i32 id, const SpriteTextureDefinition** out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (id < 0) {
        *out = nullptr;
        return Status::OutOfRange;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= statusById_.size()) {
        *out = nullptr;
        return Status::OutOfRange;
    }
    const Status s = statusById_[idx];
    if (!ok(s)) {
        *out = nullptr;
        return s;
    }
    *out = &defs_[idx];
    return Status::Ok;
}

Result<Vec<i32>> SpriteTextureLoader::tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept {
    (void)flipH;

    if (!spriteIndex_) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }

    const SpriteTextureDefinition* def = nullptr;
    Status s = getDefinition(id, &def);
    if (!ok(s) || !def) {
        return Result<Vec<i32>>::err(s);
    }

    if (size <= 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    const std::size_t pixelCount = static_cast<std::size_t>(size) * static_cast<std::size_t>(size);

    Vec<i32> pixels(alloc);
    auto rr = pixels.resize(pixelCount);
    if (!rr.isOk()) {
        return Result<Vec<i32>>::err(rr.status());
    }
    for (std::size_t i = 0; i < pixels.size(); i++) {
        pixels[i] = 0;
    }

    for (u8 spriteIdx = 0; spriteIdx < def->spriteCount; spriteIdx++) {
        const i32 spriteId = def->spriteIds[spriteIdx];

        // Fetch sprite bytes from sprites index: archiveId=spriteId, fileId=0.
        auto archRes = spriteIndex_->getArchive(spriteId, alloc);
        if (!archRes.isOk()) {
            return Result<Vec<i32>>::err(archRes.status());
        }
        const Archive spriteArchive = rs::move(archRes.value());
        const ArchiveFile* file = spriteArchive.getFile(0);
        if (!file) {
            return Result<Vec<i32>>::err(Status::NotFound);
        }

        auto spriteRes = SpriteLoader::decodeSpriteArchive(file->data.span(), alloc);
        if (!spriteRes.isOk()) {
            return Result<Vec<i32>>::err(spriteRes.status());
        }
        SpriteArchive decoded = rs::move(spriteRes.value());
        if (decoded.sprites.size() == 0) {
            return Result<Vec<i32>>::err(Status::NotFound);
        }

        IndexedSprite& sprite = decoded.sprites[0];
        s = sprite.normalize(alloc);
        if (!ok(s)) {
            return Result<Vec<i32>>::err(s);
        }

        const Span<const i32> sourcePalette = sprite.palette;
        Vec<i32> paletteArgb(alloc);
        rr = paletteArgb.resize(sourcePalette.size());
        if (!rr.isOk()) {
            return Result<Vec<i32>>::err(rr.status());
        }

        const i32 transform = def->transforms[spriteIdx];
        const bool hasTransform = (transform & -0x01000000) == 0x03000000;
        const i32 r_b = transform & 0x00FF00FF;
        const i32 green = (transform >> 8) & 0xFF;

        for (std::size_t pi = 0; pi < sourcePalette.size(); pi++) {
            i32 rgb = sourcePalette[pi];
            if (hasTransform) {
                const i32 rg = rgb >> 8;
                const i32 gb = rgb & 0xFFFF;
                if (rg == gb) {
                    const i32 blue = rgb & 0xFF;
                    rgb = (((r_b * blue) >> 8) & 0x00FF00FF) | ((green * blue) & 0x0000FF00);
                }
            }

            i32 alpha = 0xFF;
            if (rgb == 0) {
                alpha = 0;
            }
            const i32 bright = brightenRgb(rgb, brightness);
            paletteArgb[pi] = (alpha << 24) | bright;
        }

        const i32 sw = sprite.subWidth;
        const i32 sh = sprite.subHeight;
        const Span<const u8> palettePixels(sprite.pixels.data(), sprite.pixels.size());

        std::size_t outIndex = 0;
        if (size == sw) {
            for (std::size_t p = 0; p < pixelCount; p++) {
                const u8 idx = palettePixels[p];
                pixels[p] = paletteArgb[static_cast<std::size_t>(idx)];
            }
            continue;
        }

        if (sw == 64 && size == 128) {
            for (i32 x = 0; x < size; x++) {
                for (i32 y = 0; y < size; y++) {
                    const std::size_t src = (static_cast<std::size_t>(x >> 1) << 6) + static_cast<std::size_t>(y >> 1);
                    const u8 idx = palettePixels[src];
                    pixels[outIndex++] = paletteArgb[static_cast<std::size_t>(idx)];
                }
            }
            continue;
        }

        if (sw == 128 && size == 64) {
            for (i32 x = 0; x < size; x++) {
                for (i32 y = 0; y < size; y++) {
                    const std::size_t src =
                        static_cast<std::size_t>(y << 1) + ((static_cast<std::size_t>(x << 1)) << 7);
                    const u8 idx = palettePixels[src];
                    pixels[outIndex++] = paletteArgb[static_cast<std::size_t>(idx)];
                }
            }
            continue;
        }

        return Result<Vec<i32>>::err(Status::Unsupported);
    }

    return Result<Vec<i32>>::ok(rs::move(pixels));
}

} // namespace rs
