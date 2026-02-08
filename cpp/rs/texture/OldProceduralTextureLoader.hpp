#pragma once

#include <cstddef>

#include "../cache/format/Archive.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"
#include "ProceduralTextureLoader.hpp"
#include "procedural/ProceduralSources.hpp"
#include "procedural/ProceduralTexture.hpp"
#include "procedural/TextureGenerator.hpp"

namespace rs {

// C++ port of `src/rs/texture/OldProceduralTextureLoader.ts`.

struct OldProceduralTextureDefinition final {
    i32 id = -1;
    mutable ProceduralTexture procedural{};

    bool flag1 = false;
    bool valid = false;

    u8 size = 0; // 64 or 128
    i32 averageHsl = 0;
    i32 unused = 0; // 0xFF => 256
    u8 animDirU = 0; // 0..3
    u8 animDirV = 0; // 0..3
    i32 animSpeed = 0;

    static Result<OldProceduralTextureDefinition> decodeFromBytes(i32 id, Span<const u8> bytes, Allocator& alloc) noexcept;
};

class OldProceduralTextureLoader final : public ITextureSource {
public:
    static Result<OldProceduralTextureLoader> create(
        const Archive* textureDefinitionArchive,
        const CacheIndex& spriteIndex,
        Allocator& alloc) noexcept;

    OldProceduralTextureLoader() = default;
    ~OldProceduralTextureLoader() = default;

    OldProceduralTextureLoader(const OldProceduralTextureLoader&) = delete;
    OldProceduralTextureLoader& operator=(const OldProceduralTextureLoader&) = delete;

    OldProceduralTextureLoader(OldProceduralTextureLoader&& other) noexcept { *this = rs::move(other); }
    OldProceduralTextureLoader& operator=(OldProceduralTextureLoader&& other) noexcept;

    [[nodiscard]] Span<const i32> textureIds() const noexcept { return textureIds_.span(); }
    [[nodiscard]] i32 getTextureIndex(i32 id) const noexcept;
    [[nodiscard]] bool isSd(i32 id) const noexcept;
    [[nodiscard]] i32 getAverageHsl(i32 id) const noexcept;

    Status getDefinition(i32 id, const OldProceduralTextureDefinition** out) const noexcept;

    Result<Vec<i32>> tryGetPixelsRgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;
    Result<Vec<i32>> tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;

    void clearCache() noexcept;

    // ITextureSource
    [[nodiscard]] bool isSmall(i32 textureId) const noexcept override;
    Status tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept override;

private:
    struct DefTable final {
        Vec<u8> cached{};
        Vec<Status> status{};
        Vec<OldProceduralTextureDefinition> defs{};

        DefTable() = default;
        explicit DefTable(Allocator& alloc) noexcept : cached(alloc), status(alloc), defs(alloc) {}
    };

    struct TransparentTable final {
        Vec<u8> known{};
        Vec<u8> value{};

        TransparentTable() = default;
        explicit TransparentTable(Allocator& alloc) noexcept : known(alloc), value(alloc) {}
    };

    OldProceduralTextureLoader(
        CacheSpriteSource spriteSource,
        Vec<i32> textureIds,
        Vec<i32> idToIndex,
        DefTable defs,
        TransparentTable transparent,
        TextureGenerator generator) noexcept;

    void fixupGeneratorPointers() noexcept;

    CacheSpriteSource spriteSource_{};
    Vec<i32> textureIds_{};
    Vec<i32> idToIndex_{};

    mutable DefTable defs_{};
    mutable TransparentTable transparent_{};

    mutable Vec<u8> pixelCached_{};
    mutable Vec<Status> pixelStatus_{};

    mutable TextureGenerator generator_{};
};

} // namespace rs

