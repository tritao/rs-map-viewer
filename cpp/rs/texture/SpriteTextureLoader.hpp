#pragma once

#include "../cache/CacheIndex.hpp"
#include "../cache/format/Archive.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

struct SpriteTextureDefinition final {
    i32 id = -1;
    i32 averageHsl = 0;
    bool opaque = false;

    u8 spriteCount = 0;
    i32 spriteIds[4]{-1, -1, -1, -1};
    i32 transforms[4]{0, 0, 0, 0};
    u8 animationDirection = 0;
    u8 animationSpeed = 0;

    bool hasSpriteTypes = false;
    u8 spriteTypes[3]{0, 0, 0};

    static Status decode(i32 id, Span<const u8> bytes, SpriteTextureDefinition* out) noexcept;
};

class SpriteTextureLoader final {
public:
    static Result<SpriteTextureLoader> create(const Archive& definitionArchive, const CacheIndex& spriteIndex, Allocator& alloc) noexcept;
    static Result<SpriteTextureLoader> createEmpty(const CacheIndex& spriteIndex, Allocator& alloc) noexcept;

    SpriteTextureLoader() = default;

    Result<Vec<i32>> tryGetPixelsArgb(i32 id, i32 size, bool flipH, float brightness, Allocator& alloc) const noexcept;

    Status getDefinition(i32 id, const SpriteTextureDefinition** out) const noexcept;

private:
    explicit SpriteTextureLoader(const CacheIndex* spriteIndex, Vec<SpriteTextureDefinition> defs, Vec<Status> statusById, i32 count) noexcept
        : spriteIndex_(spriteIndex), defs_(rs::move(defs)), statusById_(rs::move(statusById)), count_(count) {}

    const CacheIndex* spriteIndex_ = nullptr;
    Vec<SpriteTextureDefinition> defs_{};
    Vec<Status> statusById_{};
    i32 count_ = 0;
};

} // namespace rs
