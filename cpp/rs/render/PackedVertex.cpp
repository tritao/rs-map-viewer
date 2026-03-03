#include "PackedVertex.hpp"

#include <cmath>

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
    // TS parity: `Math.round(v * 64)` is `floor(v * 64 + 0.5)` even for negative values.
    //
    // JS allows NaN/Infinity here and later bitwise ops coerce NaN to 0. Avoid UB from casting
    // NaN/Infinity or huge doubles to i32 in C++ by clamping in double space first.
    if (!std::isfinite(static_cast<double>(v))) {
        // +inf/NaN behaves like producing 0 after clamp+bitwise; -inf clamps to max.
        return v < 0.0f ? 0x7ff : 0;
    }
    const double scaled = static_cast<double>(v) * 64.0;
    const double rounded = std::floor(scaled + 0.5);
    double packed = 1024.0 - rounded;
    if (!std::isfinite(packed)) {
        return packed < 0.0 ? 0 : 0x7ff;
    }
    if (packed < 0.0) packed = 0.0;
    if (packed > 2047.0) packed = 2047.0;
    return static_cast<i32>(packed);
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

    // Packed format stores raw cache texture ids as 16-bit `textureIdPlus1` (0 reserved).
    // Raw ids must fit in 0..65534 so `textureIdPlus1` fits in u16 (0..65535).
    if (textureId > 0xfffe) {
        textureId = -1;
    }
    if (textureId1 > 0xfffe) {
        textureId1 = -1;
    }

    float blendClamped = textureBlend;
    if (blendClamped < 0.0f) blendClamped = 0.0f;
    if (blendClamped > 1.0f) blendClamped = 1.0f;

    const i32 tex0 = textureId != -1 ? (textureId + 1) : 0;
    const i32 tex1 = textureId1 != -1 ? (textureId1 + 1) : 0;

    const bool isTextured = tex0 != 0;
    if (isTextured) {
        hsl &= 127;
        hsl |= (tex0 & 0x1ff) << 7;
    }

    const bool hasBlend =
        isTextured &&
        tex1 != 0 &&
        tex1 != tex0 &&
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

    const i32 tex0High7 = isTextured ? ((tex0 >> 9) & 0x7f) : 0;
    const i32 tex1Low10 = hasBlend ? clampI32(tex1, 0, 0xffff) & 0x3ff : 0;
    const i32 tex1High6 = hasBlend ? ((tex1 >> 10) & 0x3f) : 0;

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
        static_cast<u32>(uPacked >> 6);
    out->v3 =
        static_cast<u32>(tex1Low10) |
        (static_cast<u32>(hasBlend ? 1 : 0) << 10) |
        (static_cast<u32>(blend8) << 11) |
        (static_cast<u32>(tex0High7) << 19) |
        (static_cast<u32>(tex1High6) << 26);

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
