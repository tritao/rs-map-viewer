#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "IndexedSprite.hpp"

namespace rs {

struct SpriteArchive final {
    i32 width = 0;
    i32 height = 0;

    Vec<i32> palette{};
    Vec<IndexedSprite> sprites{};

    SpriteArchive() = default;
    explicit SpriteArchive(Allocator& alloc) noexcept : palette(alloc), sprites(alloc) {}
};

} // namespace rs

