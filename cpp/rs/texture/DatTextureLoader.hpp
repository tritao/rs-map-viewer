#pragma once

#include <cstddef>

#include "../cache/format/Archive.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../sprite/IndexedSprite.hpp"
#include "../types.hpp"
#include "procedural/ProceduralSources.hpp"

namespace rs {

// C++ port of `src/rs/texture/DatTextureLoader.ts` (legacy cache textures backed by indexed-sprite DAT files).
class DatTextureLoader final : public ITextureSource {
public:
    static constexpr i32 WATER_DROPLETS_TEXTURE_ID = 17;

    static Result<DatTextureLoader> create(
        Archive textureArchive,
        Span<const i32> animatedTextureIds,
        Allocator& alloc) noexcept;

    DatTextureLoader() = default;
    ~DatTextureLoader() = default;

    DatTextureLoader(const DatTextureLoader&) = delete;
    DatTextureLoader& operator=(const DatTextureLoader&) = delete;

    DatTextureLoader(DatTextureLoader&& other) noexcept { *this = rs::move(other); }
    DatTextureLoader& operator=(DatTextureLoader&& other) noexcept;

    [[nodiscard]] Span<const i32> textureIds() const noexcept { return textureIds_.span(); }
    [[nodiscard]] i32 getTextureIndex(i32 id) const noexcept { return id; }
    [[nodiscard]] bool isSd(i32 /*id*/) const noexcept { return true; }

    [[nodiscard]] bool isTransparent(i32 id) const noexcept;
    [[nodiscard]] i32 getAverageHsl(i32 id) const noexcept;

    Result<Vec<i32>> tryGetPixelsRgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;
    Result<Vec<i32>> tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;

    void clearCache() noexcept;

    // ITextureSource
    [[nodiscard]] bool isSmall(i32 textureId) const noexcept override;
    Status tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept override;

private:
    struct SpriteTable final {
        Vec<u8> cached{};
        Vec<Status> status{};
        Vec<IndexedSprite> sprites{};

        SpriteTable() = default;
        explicit SpriteTable(Allocator& alloc) noexcept : cached(alloc), status(alloc), sprites(alloc) {}
    };

    struct BoolTable final {
        Vec<u8> known{};
        Vec<u8> value{};

        BoolTable() = default;
        explicit BoolTable(Allocator& alloc) noexcept : known(alloc), value(alloc) {}
    };

    struct I32Table final {
        Vec<u8> known{};
        Vec<i32> value{};

        I32Table() = default;
        explicit I32Table(Allocator& alloc) noexcept : known(alloc), value(alloc) {}
    };

    DatTextureLoader(
        Archive textureArchive,
        Vec<i32> textureIds,
        Vec<u8> isAnimated,
        SpriteTable sprites,
        BoolTable transparent,
        I32Table averageHsl) noexcept;

    Result<const IndexedSprite*> tryLoadTextureSprite(i32 id, Allocator& alloc) const noexcept;
    Result<Vec<i32>> tryLoadPixelsInternal(i32 id, i32 size, float brightness, bool argb, Allocator& alloc) const noexcept;

    Archive textureArchive_{};
    Vec<i32> textureIds_{};
    Vec<u8> isAnimated_{};

    mutable SpriteTable sprites_{};
    mutable BoolTable transparent_{};
    mutable I32Table averageHsl_{};
};

} // namespace rs
