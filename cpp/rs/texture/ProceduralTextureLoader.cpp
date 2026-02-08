#include "ProceduralTextureLoader.hpp"

#include <cstddef>

#include "../cache/ArchiveMeta.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../sprite/IndexedSprite.hpp"
#include "../sprite/SpriteArchive.hpp"
#include "../types.hpp"

namespace rs {

Result<ProceduralTextureDefinition> ProceduralTextureDefinition::decodeFromBytes(
    i32 id,
    Span<const u8> bytes,
    bool hasAlphaOperation,
    Allocator& alloc) noexcept {
    Uint8ArrayReader reader(bytes, 0);

    auto procRes = ProceduralTexture::decode(reader, hasAlphaOperation, alloc);
    if (!procRes.isOk()) {
        return Result<ProceduralTextureDefinition>::err(procRes.status());
    }

    u8 bool1 = 0;
    u8 flipV = 0;
    u8 repeatS = 0;
    u8 repeatT = 0;
    u8 combine = 0;
    i8 animU = 0;
    i8 animV = 0;

    Status s = reader.readUnsignedByte(&bool1);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }
    s = reader.readUnsignedByte(&flipV);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }
    s = reader.readUnsignedByte(&repeatS);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }
    s = reader.readUnsignedByte(&repeatT);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }
    s = reader.readUnsignedByte(&combine);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }
    s = reader.readByte(&animU);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }
    s = reader.readByte(&animV);
    if (!ok(s)) {
        return Result<ProceduralTextureDefinition>::err(s);
    }

    ProceduralTextureDefinition out{};
    out.id = id;
    out.procedural = rs::move(procRes.value());
    out.bool1 = (bool1 == 1);
    out.flipV = (flipV == 1);
    out.repeatS = (repeatS == 1);
    out.repeatT = (repeatT == 1);
    out.combineMode = static_cast<u8>(combine & 0x3u);
    out.animU = animU;
    out.animV = animV;

    return Result<ProceduralTextureDefinition>::ok(rs::move(out));
}

Status CacheSpriteSource::tryLoadSpritePixelsArgb(i32 spriteId, SpritePixels* out, Allocator& alloc) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    out->pixels.clear();
    out->width = 0;
    out->height = 0;

    if (!spriteIndex_ || spriteId < 0) {
        return Status::InvalidArgument;
    }

    auto archRes = spriteIndex_->getArchive(spriteId, alloc);
    if (!archRes.isOk()) {
        return archRes.status();
    }
    Archive spriteArchive = rs::move(archRes.value());
    const ArchiveFile* file = spriteArchive.getFile(0);
    if (!file) {
        return Status::NotFound;
    }

    auto sprRes = SpriteLoader::decodeSpriteArchive(file->data.span(), alloc);
    if (!sprRes.isOk()) {
        return sprRes.status();
    }
    SpriteArchive decoded = rs::move(sprRes.value());
    if (decoded.sprites.size() == 0) {
        return Status::NotFound;
    }

    IndexedSprite& sprite = decoded.sprites[0];
    Status s = sprite.normalize(alloc);
    if (!ok(s)) {
        return s;
    }

    if (sprite.width <= 0 || sprite.height <= 0) {
        return Status::BadFormat;
    }
    const std::size_t pixelCount = static_cast<std::size_t>(sprite.width) * static_cast<std::size_t>(sprite.height);
    if (sprite.pixels.size() < pixelCount) {
        return Status::Truncated;
    }

    Vec<i32> pixels(alloc);
    auto rr = pixels.resize(pixelCount);
    if (!rr.isOk()) {
        return rr.status();
    }

    const Span<const i32> palette = sprite.palette;
    for (std::size_t i = 0; i < pixelCount; i++) {
        const u8 pi = sprite.pixels[i];
        const std::size_t paletteIdx = static_cast<std::size_t>(pi);
        i32 rgb = 0;
        if (paletteIdx < palette.size()) {
            rgb = palette[paletteIdx];
        }
        if (rgb != 0) {
            pixels[i] = static_cast<i32>(0xFF000000u) | rgb;
        } else {
            pixels[i] = 0;
        }
    }

    out->pixels = rs::move(pixels);
    out->width = sprite.width;
    out->height = sprite.height;
    return Status::Ok;
}

ProceduralTextureLoader::ProceduralTextureLoader(
    bool hasAlphaOperation,
    const CacheIndex* textureIndex,
    Archive textureArchive0,
    bool hasTextureArchive0,
    CacheSpriteSource spriteSource,
    Vec<i32> textureIds,
    MaterialTable materials,
    DefTable defs,
    TransparentTable transparent,
    TextureGenerator generator) noexcept
    : hasAlphaOperation_(hasAlphaOperation),
      textureIndex_(textureIndex),
      textureArchive0_(rs::move(textureArchive0)),
      hasTextureArchive0_(hasTextureArchive0),
      spriteSource_(rs::move(spriteSource)),
      textureIds_(rs::move(textureIds)),
      materials_(rs::move(materials)),
      defs_(rs::move(defs)),
      transparent_(rs::move(transparent)),
      generator_(rs::move(generator)) {
    fixupGeneratorPointers();
}

ProceduralTextureLoader& ProceduralTextureLoader::operator=(ProceduralTextureLoader&& other) noexcept {
    if (this == &other) {
        return *this;
    }

    hasAlphaOperation_ = other.hasAlphaOperation_;
    textureIndex_ = other.textureIndex_;
    textureArchive0_ = rs::move(other.textureArchive0_);
    hasTextureArchive0_ = other.hasTextureArchive0_;
    spriteSource_ = rs::move(other.spriteSource_);
    textureIds_ = rs::move(other.textureIds_);
    materials_ = rs::move(other.materials_);
    defs_ = rs::move(other.defs_);
    transparent_ = rs::move(other.transparent_);
    pixelCached_ = rs::move(other.pixelCached_);
    pixelStatus_ = rs::move(other.pixelStatus_);
    generator_ = rs::move(other.generator_);

    other.textureIndex_ = nullptr;
    other.hasTextureArchive0_ = false;

    fixupGeneratorPointers();
    other.fixupGeneratorPointers();

    return *this;
}

void ProceduralTextureLoader::fixupGeneratorPointers() noexcept {
    generator_.spriteSource = &spriteSource_;
    generator_.textureSource = this;
}

Result<ProceduralTextureLoader::MaterialTable> ProceduralTextureLoader::decodeMaterials(
    bool hasAlphaMaterialField,
    Span<const u8> bytes,
    Allocator& alloc) noexcept {
    Uint8ArrayReader reader(bytes, 0);

    u16 countU16 = 0;
    Status s = reader.readUnsignedShort(&countU16);
    if (!ok(s)) {
        return Result<MaterialTable>::err(s);
    }
    const i32 count = static_cast<i32>(countU16);
    if (count < 0) {
        return Result<MaterialTable>::err(Status::BadFormat);
    }

    MaterialTable out(alloc);
    auto rr = out.exists.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<MaterialTable>::err(rr.status());
    }
    rr = out.materials.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<MaterialTable>::err(rr.status());
    }
    for (std::size_t i = 0; i < out.exists.size(); i++) {
        out.exists[i] = 0;
        out.materials[i] = ProcTextureMaterial{};
    }

    // exists flags
    for (i32 i = 0; i < count; i++) {
        u8 exists = 0;
        s = reader.readUnsignedByte(&exists);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        if (exists == 1) {
            out.exists[static_cast<std::size_t>(i)] = 1;
        }
    }

    // valid flags
    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        u8 valid = 0;
        s = reader.readUnsignedByte(&valid);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].valid = (valid == 1);
    }

    if (hasAlphaMaterialField) {
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 alpha = 0;
            s = reader.readUnsignedByte(&alpha);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].alpha = (alpha == 1);
        }
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        u8 small = 0;
        s = reader.readUnsignedByte(&small);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].small = (small == 1);
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        u8 disabled = 0;
        s = reader.readUnsignedByte(&disabled);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].disabled = (disabled == 1);
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        i8 v = 0;
        s = reader.readByte(&v);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].brightness = v;
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        i8 v = 0;
        s = reader.readByte(&v);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].blanch = v;
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        i8 v = 0;
        s = reader.readByte(&v);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].shaderId = v;
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        i8 v = 0;
        s = reader.readByte(&v);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].shaderParam = v;
    }

    for (i32 i = 0; i < count; i++) {
        if (out.exists[static_cast<std::size_t>(i)] == 0) {
            continue;
        }
        u16 v = 0;
        s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return Result<MaterialTable>::err(s);
        }
        out.materials[static_cast<std::size_t>(i)].averageHsl = static_cast<i32>(v);
    }

    if (reader.remaining() > 0) {
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            i8 v = 0;
            s = reader.readByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].animU = v;
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            i8 v = 0;
            s = reader.readByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].animV = v;
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            i8 v = 0;
            s = reader.readByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].flipV = (v == 1);
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            i8 v = 0;
            s = reader.readByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].mipmap = v;
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].repeatS = (v == 1);
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].repeatT = (v == 1);
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].floatTexture = (v == 1);
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].combineMode = v;
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            i32 v = 0;
            s = reader.readInt(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].shaderParam2 = v;
        }
        for (i32 i = 0; i < count; i++) {
            if (out.exists[static_cast<std::size_t>(i)] == 0) {
                continue;
            }
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return Result<MaterialTable>::err(s);
            }
            out.materials[static_cast<std::size_t>(i)].alphaMode = v;
        }
    }

    return Result<MaterialTable>::ok(rs::move(out));
}

Result<Vec<i32>> ProceduralTextureLoader::enumerateTextureIdsSmart(const CacheIndex& textureIndex, Allocator& alloc) noexcept {
    if (textureIndex.archiveCount() == 1 && textureIndex.archiveExists(0)) {
        ArchiveMeta meta{};
        const Status s = textureIndex.getArchiveMeta(0, &meta);
        if (!ok(s)) {
            return Result<Vec<i32>>::err(s);
        }
        Vec<i32> ids(alloc);
        auto rr = ids.resize(static_cast<std::size_t>(meta.fileCount));
        if (!rr.isOk()) {
            return Result<Vec<i32>>::err(rr.status());
        }
        for (i32 i = 0; i < meta.fileCount; i++) {
            ids[static_cast<std::size_t>(i)] = meta.fileIds[static_cast<std::size_t>(i)];
        }
        return Result<Vec<i32>>::ok(rs::move(ids));
    }

    const Span<const i32> archIds = textureIndex.archiveIds();
    Vec<i32> ids(alloc);
    auto rr = ids.resize(archIds.size());
    if (!rr.isOk()) {
        return Result<Vec<i32>>::err(rr.status());
    }
    for (std::size_t i = 0; i < archIds.size(); i++) {
        ids[i] = archIds[i];
    }
    return Result<Vec<i32>>::ok(rs::move(ids));
}

Result<i32> ProceduralTextureLoader::computeMaxTextureIdSmart(const CacheIndex& textureIndex) noexcept {
    if (textureIndex.archiveCount() == 1 && textureIndex.archiveExists(0)) {
        ArchiveMeta meta{};
        const Status s = textureIndex.getArchiveMeta(0, &meta);
        if (!ok(s)) {
            return Result<i32>::err(s);
        }
        return Result<i32>::ok(meta.lastFileId);
    }
    return Result<i32>::ok(textureIndex.lastArchiveId());
}

Result<ProceduralTextureLoader> ProceduralTextureLoader::createFromMaterialsBytes(
    bool hasAlphaMaterialField,
    bool hasAlphaOperation,
    Span<const u8> materialsBytes,
    const CacheIndex& textureIndex,
    const CacheIndex& spriteIndex,
    Allocator& alloc) noexcept {
    auto matRes = decodeMaterials(hasAlphaMaterialField, materialsBytes, alloc);
    if (!matRes.isOk()) {
        return Result<ProceduralTextureLoader>::err(matRes.status());
    }

    auto idsRes = enumerateTextureIdsSmart(textureIndex, alloc);
    if (!idsRes.isOk()) {
        return Result<ProceduralTextureLoader>::err(idsRes.status());
    }
    Vec<i32> textureIds = rs::move(idsRes.value());

    auto maxRes = computeMaxTextureIdSmart(textureIndex);
    if (!maxRes.isOk()) {
        return Result<ProceduralTextureLoader>::err(maxRes.status());
    }
    const i32 maxId = maxRes.value();
    const i32 count = (maxId < 0) ? 0 : (maxId + 1);

    // Optionally pre-load archive 0 when the index is in "single archive" mode.
    Archive archive0{};
    bool hasArchive0 = false;
    if (textureIndex.archiveCount() == 1 && textureIndex.archiveExists(0)) {
        auto archRes = textureIndex.getArchive(0, alloc);
        if (archRes.isOk()) {
            archive0 = rs::move(archRes.value());
            hasArchive0 = true;
        }
    }

    DefTable defs(alloc);
    auto rr = defs.cached.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    rr = defs.status.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    rr = defs.defs.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < defs.cached.size(); i++) {
        defs.cached[i] = 0;
        defs.status[i] = Status::NotFound;
        defs.defs[i] = ProceduralTextureDefinition{};
    }

    TransparentTable transparent(alloc);
    rr = transparent.known.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    rr = transparent.value.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < transparent.known.size(); i++) {
        transparent.known[i] = 0;
        transparent.value[i] = 0;
    }

    TextureGenerator generator(alloc);
    CacheSpriteSource spriteSource(spriteIndex);

    ProceduralTextureLoader out(
        hasAlphaOperation,
        &textureIndex,
        rs::move(archive0),
        hasArchive0,
        rs::move(spriteSource),
        rs::move(textureIds),
        rs::move(matRes.value()),
        rs::move(defs),
        rs::move(transparent),
        rs::move(generator));

    // Pixel failure caches (dense by id).
    out.pixelCached_ = Vec<u8>(alloc);
    out.pixelStatus_ = Vec<Status>(alloc);
    rr = out.pixelCached_.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    rr = out.pixelStatus_.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<ProceduralTextureLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < out.pixelCached_.size(); i++) {
        out.pixelCached_[i] = 0;
        out.pixelStatus_[i] = Status::NotFound;
    }

    return Result<ProceduralTextureLoader>::ok(rs::move(out));
}

bool ProceduralTextureLoader::isSmall(i32 textureId) const noexcept {
    if (textureId < 0) {
        return false;
    }
    const std::size_t idx = static_cast<std::size_t>(textureId);
    if (idx >= materials_.exists.size()) {
        return false;
    }
    if (materials_.exists[idx] == 0) {
        return false;
    }
    return materials_.materials[idx].small;
}

Result<const ProceduralTextureDefinition*> ProceduralTextureLoader::tryLoadTextureDefinition(i32 id) const noexcept {
    if (!textureIndex_) {
        return Result<const ProceduralTextureDefinition*>::err(Status::InvalidArgument);
    }
    Allocator& alloc = generator_.allocator();
    if (id < 0) {
        return Result<const ProceduralTextureDefinition*>::err(Status::OutOfRange);
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= defs_.cached.size()) {
        return Result<const ProceduralTextureDefinition*>::err(Status::OutOfRange);
    }

    if (defs_.cached[idx] != 0) {
        const Status s = defs_.status[idx];
        if (!ok(s)) {
            return Result<const ProceduralTextureDefinition*>::err(s);
        }
        return Result<const ProceduralTextureDefinition*>::ok(&defs_.defs[idx]);
    }

    // Fetch definition bytes via "smart" addressing.
    const bool singleArchive = (textureIndex_->archiveCount() == 1 && textureIndex_->archiveExists(0));

    Span<const u8> bytes(nullptr, 0);
    if (singleArchive && hasTextureArchive0_) {
        const ArchiveFile* f = textureArchive0_.getFile(id);
        if (!f) {
            return Result<const ProceduralTextureDefinition*>::err(Status::NotFound);
        }
        bytes = f->data.span();
    } else {
        // Load the relevant archive on demand.
        const i32 archiveId = singleArchive ? 0 : id;
        auto archRes = textureIndex_->getArchive(archiveId, alloc);
        if (!archRes.isOk()) {
            return Result<const ProceduralTextureDefinition*>::err(archRes.status());
        }
        Archive arch = rs::move(archRes.value());
        const i32 fileId = singleArchive ? id : 0;
        const ArchiveFile* f = arch.getFile(fileId);
        if (!f) {
            return Result<const ProceduralTextureDefinition*>::err(Status::NotFound);
        }
        bytes = f->data.span();

        auto defRes = ProceduralTextureDefinition::decodeFromBytes(id, bytes, hasAlphaOperation_, alloc);
        if (!defRes.isOk()) {
            // Cache permanent decode failures only (bad format). Avoid caching NotFound / IO / OOM.
            if (defRes.status() == Status::BadFormat || defRes.status() == Status::Truncated) {
                defs_.cached[idx] = 1;
                defs_.status[idx] = defRes.status();
            }
            return Result<const ProceduralTextureDefinition*>::err(defRes.status());
        }

        defs_.defs[idx] = rs::move(defRes.value());
        defs_.cached[idx] = 1;
        defs_.status[idx] = Status::Ok;
        return Result<const ProceduralTextureDefinition*>::ok(&defs_.defs[idx]);
    }

    auto defRes = ProceduralTextureDefinition::decodeFromBytes(id, bytes, hasAlphaOperation_, alloc);
    if (!defRes.isOk()) {
        if (defRes.status() == Status::BadFormat || defRes.status() == Status::Truncated) {
            defs_.cached[idx] = 1;
            defs_.status[idx] = defRes.status();
        }
        return Result<const ProceduralTextureDefinition*>::err(defRes.status());
    }
    defs_.defs[idx] = rs::move(defRes.value());
    defs_.cached[idx] = 1;
    defs_.status[idx] = Status::Ok;
    return Result<const ProceduralTextureDefinition*>::ok(&defs_.defs[idx]);
}

Status ProceduralTextureLoader::getTextureDefinition(i32 id, const ProceduralTextureDefinition** out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = nullptr;

    auto r = tryLoadTextureDefinition(id);
    if (!r.isOk()) {
        return r.status();
    }
    *out = r.value();
    return Status::Ok;
}

Result<Vec<i32>> ProceduralTextureLoader::tryGetPixelsRgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept {
    if (id < 0 || size <= 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx < pixelCached_.size() && pixelCached_[idx] != 0) {
        return Result<Vec<i32>>::err(pixelStatus_[idx]);
    }

    auto defRes = tryLoadTextureDefinition(id);
    if (!defRes.isOk()) {
        return Result<Vec<i32>>::err(defRes.status());
    }
    const ProceduralTextureDefinition* def = defRes.value();
    if (!def) {
        return Result<Vec<i32>>::err(Status::NotFound);
    }

    auto pixRes = def->procedural.getPixelsRgb(generator_, size, size, flipH, def->flipV, brightness, alloc);
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

Result<Vec<i32>> ProceduralTextureLoader::tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept {
    if (id < 0 || size <= 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx < pixelCached_.size() && pixelCached_[idx] != 0) {
        return Result<Vec<i32>>::err(pixelStatus_[idx]);
    }

    auto defRes = tryLoadTextureDefinition(id);
    if (!defRes.isOk()) {
        return Result<Vec<i32>>::err(defRes.status());
    }
    const ProceduralTextureDefinition* def = defRes.value();
    if (!def) {
        return Result<Vec<i32>>::err(Status::NotFound);
    }

    auto pixRes = def->procedural.getPixelsArgb(generator_, size, size, flipH, def->flipV, brightness, alloc);
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

Status ProceduralTextureLoader::tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    out->pixels.clear();
    out->width = 0;
    out->height = 0;

    // Mirrors TS TextureSourceOperation: flipH=false, brightness=1.0.
    auto r = tryGetPixelsRgb(textureId, sizeHint, false, 1.0f, alloc);
    if (!r.isOk()) {
        return r.status();
    }
    out->pixels = rs::move(r.value());
    out->width = sizeHint;
    out->height = sizeHint;
    return Status::Ok;
}

void ProceduralTextureLoader::clearCache() noexcept {
    generator_.clearCache();

    for (std::size_t i = 0; i < defs_.cached.size(); i++) {
        defs_.cached[i] = 0;
        defs_.status[i] = Status::NotFound;
        defs_.defs[i] = ProceduralTextureDefinition{};
    }
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
