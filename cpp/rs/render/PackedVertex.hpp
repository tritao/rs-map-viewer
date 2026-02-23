#pragma once

#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

struct PackedVertexU32 final {
    u32 v0 = 0;
    u32 v1 = 0;
    u32 v2 = 0;
    u32 v3 = 0;
};

// Packed vertex format matches `src/renderer/buffer/VertexBuffer.ts`.
struct PackedVertex final {
    static Status packU32(
        i32 x,
        i32 y,
        i32 z,
        i32 hsl,
        i32 alpha,
        float u,
        float v,
        i32 priority,
        i32 textureId,
        i32 textureId1,
        float textureBlend,
        PackedVertexU32* out) noexcept;

    static Status append(
        Vec<u8>* outVertices,
        i32 x,
        i32 y,
        i32 z,
        i32 hsl,
        i32 alpha,
        float u,
        float v,
        i32 priority,
        i32 textureId = -1,
        i32 textureId1 = -1,
        float textureBlend = 0.0f) noexcept;
};

} // namespace rs
