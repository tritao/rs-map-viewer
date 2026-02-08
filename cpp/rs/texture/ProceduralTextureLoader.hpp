#pragma once

#include <cstddef>

#include "../cache/CacheIndex.hpp"
#include "../cache/format/Archive.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../sprite/SpriteLoader.hpp"
#include "../types.hpp"
#include "procedural/ProceduralSources.hpp"
#include "procedural/ProceduralTexture.hpp"
#include "procedural/TextureGenerator.hpp"

namespace rs {

// C++ port of `src/rs/texture/ProceduralTextureLoader.ts` (materials-based procedural textures).

struct ProcTextureMaterial final {
    bool valid = false;
    bool alpha = false;
    bool small = false;
    bool disabled = false;

    i8 brightness = 0;
    i8 blanch = 0;
    i8 shaderId = 0;
    i8 shaderParam = 0;
    i32 averageHsl = 0;

    i8 animU = 0;
    i8 animV = 0;

    bool flipV = false;
    i8 mipmap = 0;
    bool repeatS = false;
    bool repeatT = false;
    bool floatTexture = false;
    u8 combineMode = 0;
    i32 shaderParam2 = 0;
    u8 alphaMode = 0;
};

struct ProceduralTextureDefinition final {
    i32 id = -1;
    mutable ProceduralTexture procedural{};

    bool bool1 = false;
    bool flipV = false;
    bool repeatS = false;
    bool repeatT = false;

    i8 animU = 0;
    i8 animV = 0;

    // Raw combine mode bits (0..3) from the definition stream.
    u8 combineMode = 0;

    static Result<ProceduralTextureDefinition> decodeFromBytes(
        i32 id,
        Span<const u8> bytes,
        bool hasAlphaOperation,
        Allocator& alloc) noexcept;
};

// Cache-backed `ISpriteSource` for procedural operations.
class CacheSpriteSource final : public ISpriteSource {
public:
    explicit CacheSpriteSource(const CacheIndex& spriteIndex) noexcept : spriteIndex_(&spriteIndex) {}
    CacheSpriteSource() = default;

    Status tryLoadSpritePixelsArgb(i32 spriteId, SpritePixels* out, Allocator& alloc) const noexcept override;

private:
    const CacheIndex* spriteIndex_ = nullptr;
};

class ProceduralTextureLoader final : public ITextureSource {
public:
    static Result<ProceduralTextureLoader> createFromMaterialsBytes(
        bool hasAlphaMaterialField,
        bool hasAlphaOperation,
        Span<const u8> materialsBytes,
        const CacheIndex& textureIndex,
        const CacheIndex& spriteIndex,
        Allocator& alloc) noexcept;

    ProceduralTextureLoader() = default;
    ~ProceduralTextureLoader() = default;

    ProceduralTextureLoader(const ProceduralTextureLoader&) = delete;
    ProceduralTextureLoader& operator=(const ProceduralTextureLoader&) = delete;

    ProceduralTextureLoader(ProceduralTextureLoader&& other) noexcept { *this = rs::move(other); }
    ProceduralTextureLoader& operator=(ProceduralTextureLoader&& other) noexcept;

    [[nodiscard]] Span<const i32> textureIds() const noexcept { return textureIds_.span(); }

    // ITextureSource
    [[nodiscard]] bool isSmall(i32 textureId) const noexcept override;
    Status tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept override;

    // Higher-level helpers (match TS public API shape).
    Status getTextureDefinition(i32 id, const ProceduralTextureDefinition** out) const noexcept;
    Result<Vec<i32>> tryGetPixelsRgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;
    Result<Vec<i32>> tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;

    void clearCache() noexcept;

private:
    struct MaterialTable final {
        Vec<u8> exists{};
        Vec<ProcTextureMaterial> materials{};

        MaterialTable() = default;
        explicit MaterialTable(Allocator& alloc) noexcept : exists(alloc), materials(alloc) {}
    };

    struct DefTable final {
        Vec<u8> cached{};
        Vec<Status> status{};
        Vec<ProceduralTextureDefinition> defs{};

        DefTable() = default;
        explicit DefTable(Allocator& alloc) noexcept : cached(alloc), status(alloc), defs(alloc) {}
    };

    struct TransparentTable final {
        Vec<u8> known{};
        Vec<u8> value{};

        TransparentTable() = default;
        explicit TransparentTable(Allocator& alloc) noexcept : known(alloc), value(alloc) {}
    };

    ProceduralTextureLoader(
        bool hasAlphaOperation,
        const CacheIndex* textureIndex,
        Archive textureArchive0,
        bool hasTextureArchive0,
        CacheSpriteSource spriteSource,
        Vec<i32> textureIds,
        MaterialTable materials,
        DefTable defs,
        TransparentTable transparent,
        TextureGenerator generator) noexcept;

    Result<const ProceduralTextureDefinition*> tryLoadTextureDefinition(i32 id) const noexcept;

    // Static helpers.
    static Result<MaterialTable> decodeMaterials(
        bool hasAlphaMaterialField,
        Span<const u8> bytes,
        Allocator& alloc) noexcept;

    static Result<Vec<i32>> enumerateTextureIdsSmart(
        const CacheIndex& textureIndex,
        Allocator& alloc) noexcept;

    static Result<i32> computeMaxTextureIdSmart(
        const CacheIndex& textureIndex) noexcept;

    void fixupGeneratorPointers() noexcept;

    bool hasAlphaOperation_ = false;

    const CacheIndex* textureIndex_ = nullptr;
    Archive textureArchive0_{};
    bool hasTextureArchive0_ = false;

    CacheSpriteSource spriteSource_{};

    Vec<i32> textureIds_{};
    MaterialTable materials_{};

    // Cached decoded definitions and their statuses (dense by id up to max id).
    mutable DefTable defs_{};

    // Per-texture transparency cache.
    mutable TransparentTable transparent_{};

    // Cached pixel decode failures (to avoid repeating expensive renders on permanently-bad definitions).
    mutable Vec<u8> pixelCached_{};
    mutable Vec<Status> pixelStatus_{};

    // Mutable because rendering init mutates tables and caches.
    mutable TextureGenerator generator_{};
};

} // namespace rs
