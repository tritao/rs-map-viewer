#pragma once

#include <cstddef>

#include "../../core/Allocator.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../types.hpp"

namespace rs {

// Minimal “edge” interfaces for procedural ops that need external pixels.
// This mirrors how TS `TextureGenerator` carries `spriteSource` and `textureLoader`.

struct SpritePixels final {
    Vec<i32> pixels{};
    i32 width = 0;
    i32 height = 0;
};

class ISpriteSource {
public:
    virtual ~ISpriteSource() = default;
    virtual Status tryLoadSpritePixelsArgb(i32 spriteId, SpritePixels* out, Allocator& alloc) const noexcept = 0;
};

struct TexturePixels final {
    Vec<i32> pixels{};
    i32 width = 0;
    i32 height = 0;
};

class ITextureSource {
public:
    virtual ~ITextureSource() = default;
    [[nodiscard]] virtual bool isSmall(i32 textureId) const noexcept = 0;
    virtual Status tryLoadTexturePixelsRgb(i32 textureId, i32 sizeHint, TexturePixels* out, Allocator& alloc) const noexcept = 0;
};

} // namespace rs

