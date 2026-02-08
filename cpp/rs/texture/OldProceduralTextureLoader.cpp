#include "OldProceduralTextureLoader.hpp"

#include <cstddef>

#include "../cache/format/ArchiveFile.hpp"
#include "../core/Move.hpp"
#include "../types.hpp"

namespace rs {

Result<OldProceduralTextureDefinition> OldProceduralTextureDefinition::decodeFromBytes(i32 id, Span<const u8> bytes, Allocator& alloc) noexcept {
    Uint8ArrayReader reader(bytes, 0);

    auto procRes = ProceduralTexture::decode(reader, false, alloc);
    if (!procRes.isOk()) {
        return Result<OldProceduralTextureDefinition>::err(procRes.status());
    }

    u8 flags = 0;
    u8 sizeU8 = 0;
    u16 avg = 0;
    u8 unusedU8 = 0;
    u8 animUFlags = 0;
    u8 animVFlags = 0;
    u8 skip0 = 0;
    u8 skip1 = 0;

    Status s = reader.readUnsignedByte(&flags);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedByte(&sizeU8);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedShort(&avg);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedByte(&unusedU8);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedByte(&animUFlags);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedByte(&animVFlags);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedByte(&skip0);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);
    s = reader.readUnsignedByte(&skip1);
    if (!ok(s)) return Result<OldProceduralTextureDefinition>::err(s);

    OldProceduralTextureDefinition out{};
    out.id = id;
    out.procedural = rs::move(procRes.value());
    out.flag1 = (flags & 0x1u) != 0;
    out.valid = (flags & 0x2u) != 0;
    out.size = sizeU8;
    out.averageHsl = static_cast<i32>(avg);
    out.unused = (unusedU8 == 0xFF) ? 256 : static_cast<i32>(unusedU8);
    out.animDirU = (animUFlags >> 6) & 0x3u;
    out.animDirV = (animVFlags >> 6) & 0x3u;
    out.animSpeed = static_cast<i32>(animVFlags & 0x3Fu) - 6;
    (void)skip0;
    (void)skip1;

    return Result<OldProceduralTextureDefinition>::ok(rs::move(out));
}

OldProceduralTextureLoader::OldProceduralTextureLoader(
    CacheSpriteSource spriteSource,
    Vec<i32> textureIds,
    Vec<i32> idToIndex,
    DefTable defs,
    TransparentTable transparent,
    TextureGenerator generator) noexcept
    : spriteSource_(rs::move(spriteSource)),
      textureIds_(rs::move(textureIds)),
      idToIndex_(rs::move(idToIndex)),
      defs_(rs::move(defs)),
      transparent_(rs::move(transparent)),
      generator_(rs::move(generator)) {
    fixupGeneratorPointers();
}

OldProceduralTextureLoader& OldProceduralTextureLoader::operator=(OldProceduralTextureLoader&& other) noexcept {
    if (this == &other) {
        return *this;
    }

    spriteSource_ = rs::move(other.spriteSource_);
    textureIds_ = rs::move(other.textureIds_);
    idToIndex_ = rs::move(other.idToIndex_);
    defs_ = rs::move(other.defs_);
    transparent_ = rs::move(other.transparent_);
    pixelCached_ = rs::move(other.pixelCached_);
    pixelStatus_ = rs::move(other.pixelStatus_);
    generator_ = rs::move(other.generator_);

    fixupGeneratorPointers();
    other.fixupGeneratorPointers();
    return *this;
}

void OldProceduralTextureLoader::fixupGeneratorPointers() noexcept {
    generator_.spriteSource = &spriteSource_;
    generator_.textureSource = this;
}

Result<OldProceduralTextureLoader> OldProceduralTextureLoader::create(
    const Archive* textureDefinitionArchive,
    const CacheIndex& spriteIndex,
    Allocator& alloc) noexcept {
    CacheSpriteSource spriteSource(spriteIndex);

    Vec<i32> textureIds(alloc);
    Vec<i32> idToIndex(alloc);
    DefTable defs(alloc);
    TransparentTable transparent(alloc);
    TextureGenerator generator(alloc);

    if (!textureDefinitionArchive) {
        OldProceduralTextureLoader out(
            rs::move(spriteSource),
            rs::move(textureIds),
            rs::move(idToIndex),
            rs::move(defs),
            rs::move(transparent),
            rs::move(generator));
        return Result<OldProceduralTextureLoader>::ok(rs::move(out));
    }

    const Span<const ArchiveFile> files = textureDefinitionArchive->files();
    i32 maxId = -1;
    for (std::size_t i = 0; i < files.size(); i++) {
        if (files[i].id > maxId) {
            maxId = files[i].id;
        }
    }
    const i32 count = (maxId < 0) ? 0 : (maxId + 1);

    auto rr = textureIds.resize(files.size());
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    rr = idToIndex.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < idToIndex.size(); i++) {
        idToIndex[i] = -1;
    }

    rr = defs.cached.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    rr = defs.status.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    rr = defs.defs.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < defs.cached.size(); i++) {
        defs.cached[i] = 1;
        defs.status[i] = Status::NotFound;
        defs.defs[i] = OldProceduralTextureDefinition{};
    }

    rr = transparent.known.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    rr = transparent.value.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < transparent.known.size(); i++) {
        transparent.known[i] = 0;
        transparent.value[i] = 0;
    }

    Vec<u8> pixelCached(alloc);
    Vec<Status> pixelStatus(alloc);
    rr = pixelCached.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    rr = pixelStatus.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<OldProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < pixelCached.size(); i++) {
        pixelCached[i] = 0;
        pixelStatus[i] = Status::NotFound;
    }

    for (std::size_t i = 0; i < files.size(); i++) {
        const ArchiveFile& f = files[i];
        textureIds[i] = f.id;
        if (f.id < 0 || f.id >= count) {
            continue;
        }
        idToIndex[static_cast<std::size_t>(f.id)] = static_cast<i32>(i);

        auto defRes = OldProceduralTextureDefinition::decodeFromBytes(f.id, f.data.span(), alloc);
        const Status s = defRes.isOk() ? Status::Ok : defRes.status();
        defs.status[static_cast<std::size_t>(f.id)] = s;
        if (defRes.isOk()) {
            defs.defs[static_cast<std::size_t>(f.id)] = rs::move(defRes.value());
        }
    }

    OldProceduralTextureLoader out(
        rs::move(spriteSource),
        rs::move(textureIds),
        rs::move(idToIndex),
        rs::move(defs),
        rs::move(transparent),
        rs::move(generator));

    out.pixelCached_ = rs::move(pixelCached);
    out.pixelStatus_ = rs::move(pixelStatus);
    return Result<OldProceduralTextureLoader>::ok(rs::move(out));
}

i32 OldProceduralTextureLoader::getTextureIndex(i32 id) const noexcept {
    if (id < 0) {
        return -1;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= idToIndex_.size()) {
        return -1;
    }
    return idToIndex_[idx];
}

bool OldProceduralTextureLoader::isSd(i32 id) const noexcept {
    if (id < 0) {
        return false;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= defs_.status.size()) {
        return false;
    }
    return ok(defs_.status[idx]);
}

i32 OldProceduralTextureLoader::getAverageHsl(i32 id) const noexcept {
    const OldProceduralTextureDefinition* def = nullptr;
    const Status s = getDefinition(id, &def);
    if (!ok(s) || !def) {
        return 0;
    }
    return def->averageHsl;
}

Status OldProceduralTextureLoader::getDefinition(i32 id, const OldProceduralTextureDefinition** out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = nullptr;
    if (id < 0) {
        return Status::OutOfRange;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= defs_.status.size()) {
        return Status::OutOfRange;
    }
    const Status s = defs_.status[idx];
    if (!ok(s)) {
        return s;
    }
    *out = &defs_.defs[idx];
    return Status::Ok;
}

bool OldProceduralTextureLoader::isSmall(i32 textureId) const noexcept {
    const OldProceduralTextureDefinition* def = nullptr;
    const Status s = getDefinition(textureId, &def);
    if (!ok(s) || !def) {
        return false;
    }
    return def->size == 64;
}

Result<Vec<i32>> OldProceduralTextureLoader::tryGetPixelsRgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept {
    if (id < 0 || size <= 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx < pixelCached_.size() && pixelCached_[idx] != 0) {
        return Result<Vec<i32>>::err(pixelStatus_[idx]);
    }

    const OldProceduralTextureDefinition* def = nullptr;
    Status s = getDefinition(id, &def);
    if (!ok(s) || !def) {
        return Result<Vec<i32>>::err(s);
    }

    auto pixRes = def->procedural.getPixelsRgb(generator_, size, size, flipH, false, brightness, alloc);
    if (!pixRes.isOk()) {
        if (idx < pixelCached_.size() && (pixRes.status() == Status::BadFormat || pixRes.status() == Status::Truncated)) {
            pixelCached_[idx] = 1;
            pixelStatus_[idx] = pixRes.status();
        }
        return Result<Vec<i32>>::err(pixRes.status());
    }

    if (idx < transparent_.known.size()) {
        transparent_.known[idx] = 1;
        transparent_.value[idx] = generator_.isTransparent ? 1 : 0;
    }

    return Result<Vec<i32>>::ok(rs::move(pixRes.value()));
}

Result<Vec<i32>> OldProceduralTextureLoader::tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept {
    if (id < 0 || size <= 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx < pixelCached_.size() && pixelCached_[idx] != 0) {
        return Result<Vec<i32>>::err(pixelStatus_[idx]);
    }

    const OldProceduralTextureDefinition* def = nullptr;
    Status s = getDefinition(id, &def);
    if (!ok(s) || !def) {
        return Result<Vec<i32>>::err(s);
    }

    auto pixRes = def->procedural.getPixelsArgb(generator_, size, size, flipH, false, brightness, alloc);
    if (!pixRes.isOk()) {
        if (idx < pixelCached_.size() && (pixRes.status() == Status::BadFormat || pixRes.status() == Status::Truncated)) {
            pixelCached_[idx] = 1;
            pixelStatus_[idx] = pixRes.status();
        }
        return Result<Vec<i32>>::err(pixRes.status());
    }

    if (idx < transparent_.known.size()) {
        transparent_.known[idx] = 1;
        transparent_.value[idx] = generator_.isTransparent ? 1 : 0;
    }

    return Result<Vec<i32>>::ok(rs::move(pixRes.value()));
}

Status OldProceduralTextureLoader::tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept {
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

void OldProceduralTextureLoader::clearCache() noexcept {
    generator_.clearCache();
    for (std::size_t i = 0; i < transparent_.known.size(); i++) {
        transparent_.known[i] = 0;
        transparent_.value[i] = 0;
    }
    for (std::size_t i = 0; i < pixelCached_.size(); i++) {
        pixelCached_[i] = 0;
        pixelStatus_[i] = Status::NotFound;
    }
}

} // namespace rs

