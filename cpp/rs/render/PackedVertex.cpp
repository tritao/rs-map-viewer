#include "PackedVertex.hpp"

namespace rs {

namespace {

static i32 clampI32(i32 value, i32 minValue, i32 maxValue) noexcept {
    if (value < minValue) {
        return minValue;
    }
    if (value > maxValue) {
        return maxValue;
    }
    return value;
}

// Matches `FloatUtil.packFloat11`.
static i32 packFloat11Js(float v) noexcept {
    return static_cast<i32>(1024 - static_cast<i32>(v * 64.0f + (v >= 0.0f ? 0.5f : -0.5f)));
}

static Status appendPackedVertexU32(Vec<u8>* outVertices, const PackedVertexU32& v) noexcept {
    if (!outVertices) {
        return Status::InvalidArgument;
    }
    if (outVertices->size() > static_cast<std::size_t>(2147483647 - 16)) {
        return Status::OutOfRange;
    }

    const std::size_t off = outVertices->size();
    auto rr = outVertices->resize(off + 16);
    if (!rr.isOk()) {
        return rr.status();
    }

    auto writeU32LE = [&](std::size_t byteOff, u32 value) {
        (*outVertices)[byteOff + 0] = static_cast<u8>(value & 0xffu);
        (*outVertices)[byteOff + 1] = static_cast<u8>((value >> 8) & 0xffu);
        (*outVertices)[byteOff + 2] = static_cast<u8>((value >> 16) & 0xffu);
        (*outVertices)[byteOff + 3] = static_cast<u8>((value >> 24) & 0xffu);
    };

    writeU32LE(off + 0, v.v0);
    writeU32LE(off + 4, v.v1);
    writeU32LE(off + 8, v.v2);
    writeU32LE(off + 12, v.v3);
    return Status::Ok;
}

} // namespace

Status PackedVertex::packU32(
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
    PackedVertexU32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }

    // Texture ids are indices into the runtime `textureIds` list.
    if (textureId >= 2048) {
        textureId = -1;
    }
    if (textureId1 >= 2048) {
        textureId1 = -1;
    }

    float blendClamped = textureBlend;
    if (blendClamped < 0.0f) blendClamped = 0.0f;
    if (blendClamped > 1.0f) blendClamped = 1.0f;

    const bool isTextured = textureId != -1;
    if (isTextured) {
        hsl &= 127;
        hsl |= (textureId & 0x1ff) << 7;
    }

    const bool hasBlend =
        isTextured &&
        textureId1 != -1 &&
        textureId1 != textureId &&
        blendClamped > 0.0f;

    const i32 xPos = clampI32(x + 0x4000, 0, 0x8000);
    const i32 yPos = clampI32(-y + 0x4000, 0, 0x8000);
    const i32 zPos = clampI32(z + 0x4000, 0, 0x8000);
    const i32 alphaClamped = clampI32(alpha, 0, 0xff);
    const i32 priorityClamped = (priority & 0x7);

    const i32 uPacked = clampI32(packFloat11Js(u), 0, 0x7ff);
    const i32 vPacked = clampI32(packFloat11Js(v), 0, 0x7ff);

    const i32 blend8 =
        hasBlend ? clampI32(static_cast<i32>(blendClamped * 255.0f + 0.5f), 0, 0xff) : 0;

    // TS quirk: these bits are derived unconditionally from the texture ids even when not used.
    const i32 tex1Lo = hasBlend ? clampI32(textureId1, 0, 0x3ff) : 0;
    const i32 tex0Hi = (textureId >> 10) & 0x1;
    const i32 tex1Hi = (textureId1 >> 10) & 0x1;

    out->v0 =
        (static_cast<u32>(xPos) << 17) |
        ((static_cast<u32>(uPacked) & 0x3fu) << 11) |
        static_cast<u32>(vPacked);
    out->v1 =
        static_cast<u32>(yPos) |
        (static_cast<u32>(hsl & 0xffff) << 15) |
        (static_cast<u32>(isTextured ? 1 : 0) << 31);
    out->v2 =
        (static_cast<u32>(zPos) << 17) |
        (static_cast<u32>(alphaClamped) << 9) |
        (static_cast<u32>(priorityClamped) << 6) |
        (static_cast<u32>((textureId >> 9) & 0x1) << 5) |
        static_cast<u32>(uPacked >> 6);
    out->v3 =
        static_cast<u32>(tex1Lo) |
        (static_cast<u32>(hasBlend ? 1 : 0) << 10) |
        (static_cast<u32>(blend8) << 11) |
        (static_cast<u32>(tex0Hi) << 19) |
        (static_cast<u32>(tex1Hi) << 20);

    return Status::Ok;
}

Status PackedVertex::append(
    Vec<u8>* outVertices,
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
    float textureBlend) noexcept {
    if (!outVertices) {
        return Status::InvalidArgument;
    }

    PackedVertexU32 packed{};
    const Status ps = packU32(
        x,
        y,
        z,
        hsl,
        alpha,
        u,
        v,
        priority,
        textureId,
        textureId1,
        textureBlend,
        &packed);
    if (!ok(ps)) {
        return ps;
    }

    return appendPackedVertexU32(outVertices, packed);
}

} // namespace rs
