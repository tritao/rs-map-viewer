#pragma once

#include <cstddef>

#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "TextureGenerator.hpp"
#include "operation/TextureOperation.hpp"

namespace rs {

class ProceduralTexture final {
public:
    ProceduralTexture() = default;
    ~ProceduralTexture();

    ProceduralTexture(const ProceduralTexture&) = delete;
    ProceduralTexture& operator=(const ProceduralTexture&) = delete;

    ProceduralTexture(ProceduralTexture&& other) noexcept { *this = rs::move(other); }
    ProceduralTexture& operator=(ProceduralTexture&& other) noexcept;

    static Result<ProceduralTexture> decode(Uint8ArrayReader& reader, bool hasAlphaOperation, Allocator& alloc) noexcept;

    // Debug/porting helpers: expose decoded operation list (owned by this texture).
    [[nodiscard]] Span<TextureOperation* const> operations() const noexcept { return operations_.span(); }

    Result<Vec<i32>> getPixelsRgb(TextureGenerator& textureGenerator, i32 width, i32 height, bool flipH, bool flipV, float brightness, Allocator& alloc) noexcept;
    Result<Vec<i32>> getPixelsArgb(TextureGenerator& textureGenerator, i32 width, i32 height, bool flipH, bool flipV, float brightness, Allocator& alloc) noexcept;

private:
    void release() noexcept;

    Allocator* alloc_ = nullptr;
    Vec<TextureOperation*> operations_{};

    TextureOperation* colourOperation_ = nullptr;
    TextureOperation* monochromeOperation_ = nullptr;
    TextureOperation* alphaOperation_ = nullptr;
};

} // namespace rs
