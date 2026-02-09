#pragma once

#include <cmath>

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "SeqTransformType.hpp"

namespace rs {

struct Vec3f final {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

struct Mat4f final {
    float v[16]{};
};

struct SkeletalBaseData final {
    i32 poseCount = 0;

    Vec<i32> parentIds{};
    Vec<Mat4f> localMatrices{};
    Vec<Vec3f> rotations{};
    Vec<Vec3f> translations{};
    Vec<Vec3f> scalings{};

    explicit SkeletalBaseData(Allocator& alloc = defaultAllocator()) noexcept
        : parentIds(alloc), localMatrices(alloc), rotations(alloc), translations(alloc), scalings(alloc) {}

    [[nodiscard]] i32 boneCount() const noexcept { return static_cast<i32>(parentIds.size()); }
    [[nodiscard]] bool hasData() const noexcept { return poseCount > 0 && boneCount() > 0; }

    [[nodiscard]] std::size_t matrixIndex(i32 boneId, i32 poseId) const noexcept {
        return static_cast<std::size_t>(boneId) * static_cast<std::size_t>(poseCount) + static_cast<std::size_t>(poseId);
    }
};

// Mirrors src/rs/model/seq/SeqBase.ts (Dat2 path).
struct SeqBase final {
    i32 id = -1;
    i32 count = 0;

    Vec<SeqTransformType> types{};
    Vec<u8> transformActor{}; // 0=false, 1=true
    Vec<i32> masks{};
    Vec<Vec<i32>> labels{};

    bool hasSkeletalBase = false;
    i32 skeletalBoneCount = 0;
    SkeletalBaseData skeletalBase{};

    explicit SeqBase(i32 baseId = -1, Allocator& alloc = defaultAllocator()) noexcept
        : id(baseId), types(alloc), transformActor(alloc), masks(alloc), labels(alloc), skeletalBase(alloc) {}
};

inline void mat4Identity(Mat4f* out) noexcept {
    if (!out) return;
    for (int i = 0; i < 16; i++) out->v[i] = 0.0f;
    out->v[0] = 1.0f;
    out->v[5] = 1.0f;
    out->v[10] = 1.0f;
    out->v[15] = 1.0f;
}

inline void mat4Copy(const Mat4f& in, Mat4f* out) noexcept {
    if (!out) return;
    for (int i = 0; i < 16; i++) out->v[i] = in.v[i];
}

inline void mat4Mul(const Mat4f& a, const Mat4f& b, Mat4f* out) noexcept {
    if (!out) return;
    Mat4f r{};

    const double a00 = static_cast<double>(a.v[0]);
    const double a01 = static_cast<double>(a.v[1]);
    const double a02 = static_cast<double>(a.v[2]);
    const double a03 = static_cast<double>(a.v[3]);
    const double a10 = static_cast<double>(a.v[4]);
    const double a11 = static_cast<double>(a.v[5]);
    const double a12 = static_cast<double>(a.v[6]);
    const double a13 = static_cast<double>(a.v[7]);
    const double a20 = static_cast<double>(a.v[8]);
    const double a21 = static_cast<double>(a.v[9]);
    const double a22 = static_cast<double>(a.v[10]);
    const double a23 = static_cast<double>(a.v[11]);
    const double a30 = static_cast<double>(a.v[12]);
    const double a31 = static_cast<double>(a.v[13]);
    const double a32 = static_cast<double>(a.v[14]);
    const double a33 = static_cast<double>(a.v[15]);

    double b0 = static_cast<double>(b.v[0]);
    double b1 = static_cast<double>(b.v[1]);
    double b2 = static_cast<double>(b.v[2]);
    double b3 = static_cast<double>(b.v[3]);
    r.v[0] = static_cast<float>(b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30);
    r.v[1] = static_cast<float>(b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31);
    r.v[2] = static_cast<float>(b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32);
    r.v[3] = static_cast<float>(b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33);

    b0 = static_cast<double>(b.v[4]);
    b1 = static_cast<double>(b.v[5]);
    b2 = static_cast<double>(b.v[6]);
    b3 = static_cast<double>(b.v[7]);
    r.v[4] = static_cast<float>(b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30);
    r.v[5] = static_cast<float>(b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31);
    r.v[6] = static_cast<float>(b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32);
    r.v[7] = static_cast<float>(b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33);

    b0 = static_cast<double>(b.v[8]);
    b1 = static_cast<double>(b.v[9]);
    b2 = static_cast<double>(b.v[10]);
    b3 = static_cast<double>(b.v[11]);
    r.v[8] = static_cast<float>(b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30);
    r.v[9] = static_cast<float>(b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31);
    r.v[10] = static_cast<float>(b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32);
    r.v[11] = static_cast<float>(b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33);

    b0 = static_cast<double>(b.v[12]);
    b1 = static_cast<double>(b.v[13]);
    b2 = static_cast<double>(b.v[14]);
    b3 = static_cast<double>(b.v[15]);
    r.v[12] = static_cast<float>(b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30);
    r.v[13] = static_cast<float>(b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31);
    r.v[14] = static_cast<float>(b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32);
    r.v[15] = static_cast<float>(b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33);

    *out = r;
}

inline bool mat4Invert(const Mat4f& in, Mat4f* out) noexcept {
    if (!out) return false;

    const double a00 = static_cast<double>(in.v[0]);
    const double a01 = static_cast<double>(in.v[1]);
    const double a02 = static_cast<double>(in.v[2]);
    const double a03 = static_cast<double>(in.v[3]);
    const double a10 = static_cast<double>(in.v[4]);
    const double a11 = static_cast<double>(in.v[5]);
    const double a12 = static_cast<double>(in.v[6]);
    const double a13 = static_cast<double>(in.v[7]);
    const double a20 = static_cast<double>(in.v[8]);
    const double a21 = static_cast<double>(in.v[9]);
    const double a22 = static_cast<double>(in.v[10]);
    const double a23 = static_cast<double>(in.v[11]);
    const double a30 = static_cast<double>(in.v[12]);
    const double a31 = static_cast<double>(in.v[13]);
    const double a32 = static_cast<double>(in.v[14]);
    const double a33 = static_cast<double>(in.v[15]);

    const double b00 = a00 * a11 - a01 * a10;
    const double b01 = a00 * a12 - a02 * a10;
    const double b02 = a00 * a13 - a03 * a10;
    const double b03 = a01 * a12 - a02 * a11;
    const double b04 = a01 * a13 - a03 * a11;
    const double b05 = a02 * a13 - a03 * a12;
    const double b06 = a20 * a31 - a21 * a30;
    const double b07 = a20 * a32 - a22 * a30;
    const double b08 = a20 * a33 - a23 * a30;
    const double b09 = a21 * a32 - a22 * a31;
    const double b10 = a21 * a33 - a23 * a31;
    const double b11 = a22 * a33 - a23 * a32;

    double det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det == 0.0f) {
        return false;
    }
    det = 1.0f / det;

    out->v[0] = static_cast<float>((a11 * b11 - a12 * b10 + a13 * b09) * det);
    out->v[1] = static_cast<float>((-a01 * b11 + a02 * b10 - a03 * b09) * det);
    out->v[2] = static_cast<float>((a31 * b05 - a32 * b04 + a33 * b03) * det);
    out->v[3] = static_cast<float>((-a21 * b05 + a22 * b04 - a23 * b03) * det);
    out->v[4] = static_cast<float>((-a10 * b11 + a12 * b08 - a13 * b07) * det);
    out->v[5] = static_cast<float>((a00 * b11 - a02 * b08 + a03 * b07) * det);
    out->v[6] = static_cast<float>((-a30 * b05 + a32 * b02 - a33 * b01) * det);
    out->v[7] = static_cast<float>((a20 * b05 - a22 * b02 + a23 * b01) * det);
    out->v[8] = static_cast<float>((a10 * b10 - a11 * b08 + a13 * b06) * det);
    out->v[9] = static_cast<float>((-a00 * b10 + a01 * b08 - a03 * b06) * det);
    out->v[10] = static_cast<float>((a30 * b04 - a31 * b02 + a33 * b00) * det);
    out->v[11] = static_cast<float>((-a20 * b04 + a21 * b02 - a23 * b00) * det);
    out->v[12] = static_cast<float>((-a10 * b09 + a11 * b07 - a12 * b06) * det);
    out->v[13] = static_cast<float>((a00 * b09 - a01 * b07 + a02 * b06) * det);
    out->v[14] = static_cast<float>((-a30 * b03 + a31 * b01 - a32 * b00) * det);
    out->v[15] = static_cast<float>((a20 * b03 - a21 * b01 + a22 * b00) * det);
    return true;
}

inline void mat4GetTranslation(const Mat4f& m, Vec3f* out) noexcept {
    if (!out) return;
    out->x = m.v[12];
    out->y = m.v[13];
    out->z = m.v[14];
}

inline void mat4GetScaling(const Mat4f& m, Vec3f* out) noexcept {
    if (!out) return;
    const double sx2 = static_cast<double>(m.v[0]) * static_cast<double>(m.v[0]) +
                       static_cast<double>(m.v[1]) * static_cast<double>(m.v[1]) +
                       static_cast<double>(m.v[2]) * static_cast<double>(m.v[2]);
    const double sy2 = static_cast<double>(m.v[4]) * static_cast<double>(m.v[4]) +
                       static_cast<double>(m.v[5]) * static_cast<double>(m.v[5]) +
                       static_cast<double>(m.v[6]) * static_cast<double>(m.v[6]);
    const double sz2 = static_cast<double>(m.v[8]) * static_cast<double>(m.v[8]) +
                       static_cast<double>(m.v[9]) * static_cast<double>(m.v[9]) +
                       static_cast<double>(m.v[10]) * static_cast<double>(m.v[10]);
    out->x = sx2 > 0.0 ? static_cast<float>(std::sqrt(sx2)) : 0.0f;
    out->y = sy2 > 0.0 ? static_cast<float>(std::sqrt(sy2)) : 0.0f;
    out->z = sz2 > 0.0 ? static_cast<float>(std::sqrt(sz2)) : 0.0f;
}

inline void mat4GetRotationTs(const Mat4f& m, Vec3f* out) noexcept {
    if (!out) return;
    out->x = static_cast<float>(-std::asin(static_cast<double>(m.v[6])));
    out->y = 0.0f;
    out->z = 0.0f;
    const double cosRotationX = std::cos(static_cast<double>(out->x));
    if (std::fabs(cosRotationX) > 0.005) {
        out->y = static_cast<float>(std::atan2(static_cast<double>(m.v[2]), static_cast<double>(m.v[10])));
        out->z = static_cast<float>(std::atan2(static_cast<double>(m.v[4]), static_cast<double>(m.v[5])));
    } else {
        const double sinRotationY = static_cast<double>(m.v[1]);
        const double cosRotationY = static_cast<double>(m.v[0]);
        if (m.v[6] < 0.0f) {
            out->y = static_cast<float>(std::atan2(sinRotationY, cosRotationY));
        } else {
            out->y = static_cast<float>(-std::atan2(sinRotationY, cosRotationY));
        }
        out->z = 0.0f;
    }
}

inline void decodeSkeletalBaseTransforms(
    const SkeletalBaseData& skeletalBase,
    i32 boneId,
    i32 poseId,
    Vec3f* outRotation,
    Vec3f* outTranslation,
    Vec3f* outScaling) noexcept {
    if (!outRotation || !outTranslation || !outScaling) return;
    const std::size_t idx = skeletalBase.matrixIndex(boneId, poseId);
    const Mat4f& local = skeletalBase.localMatrices[idx];
    Mat4f inverted{};
    if (!mat4Invert(local, &inverted)) {
        mat4Identity(&inverted);
    }
    mat4GetRotationTs(inverted, outRotation);
    mat4GetTranslation(local, outTranslation);
    mat4GetScaling(local, outScaling);
}

inline Status decodeDat2SeqBase(
    const CacheInfo& cacheInfo,
    i32 id,
    Span<const u8> data,
    SeqBase* out,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }

    SeqBase decoded(id, alloc);
    Uint8ArrayReader reader(data, 0);

    u8 countU8 = 0;
    Status s = reader.readUnsignedByte(&countU8);
    if (!ok(s)) {
        return s;
    }
    const i32 count = static_cast<i32>(countU8);
    decoded.count = count;

    auto rr = decoded.types.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = decoded.transformActor.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = decoded.masks.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = decoded.labels.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return rr.status();
    }

    for (i32 i = 0; i < count; i++) {
        u8 rawType = 0;
        s = reader.readUnsignedByte(&rawType);
        if (!ok(s)) {
            return s;
        }
        SeqTransformType type = static_cast<SeqTransformType>(static_cast<i32>(rawType));
        if (type == SeqTransformType::TYPE_6) {
            type = SeqTransformType::ROTATE;
        }
        decoded.types[static_cast<std::size_t>(i)] = type;
    }

    const bool hasTransformActor =
        cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 481;
    if (hasTransformActor) {
        for (i32 i = 0; i < count; i++) {
            u8 flag = 0;
            s = reader.readUnsignedByte(&flag);
            if (!ok(s)) {
                return s;
            }
            decoded.transformActor[static_cast<std::size_t>(i)] = (flag == 1) ? 1 : 0;
        }
    } else {
        for (i32 i = 0; i < count; i++) {
            decoded.transformActor[static_cast<std::size_t>(i)] = 1;
        }
    }

    const bool hasMasks =
        cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 530;
    if (hasMasks) {
        for (i32 i = 0; i < count; i++) {
            u16 mask = 0;
            s = reader.readUnsignedShort(&mask);
            if (!ok(s)) {
                return s;
            }
            decoded.masks[static_cast<std::size_t>(i)] = static_cast<i32>(mask);
        }
    } else {
        for (i32 i = 0; i < count; i++) {
            decoded.masks[static_cast<std::size_t>(i)] = -1;
        }
    }

    for (i32 i = 0; i < count; i++) {
        u8 labelCountU8 = 0;
        s = reader.readUnsignedByte(&labelCountU8);
        if (!ok(s)) {
            return s;
        }

        Vec<i32> label(alloc);
        rr = label.resize(static_cast<std::size_t>(labelCountU8));
        if (!rr.isOk()) {
            return rr.status();
        }
        decoded.labels[static_cast<std::size_t>(i)] = rs::move(label);
    }

    for (i32 i = 0; i < count; i++) {
        Vec<i32>& label = decoded.labels[static_cast<std::size_t>(i)];
        for (std::size_t j = 0; j < label.size(); j++) {
            u8 v = 0;
            s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            label[j] = static_cast<i32>(v);
        }
    }

    decoded.hasSkeletalBase = false;
    decoded.skeletalBoneCount = 0;
    decoded.skeletalBase.poseCount = 0;
    decoded.skeletalBase.parentIds.clear();
    decoded.skeletalBase.localMatrices.clear();
    decoded.skeletalBase.rotations.clear();
    decoded.skeletalBase.translations.clear();
    decoded.skeletalBase.scalings.clear();

    if (reader.remaining() > 0) {
        u16 boneCountU16 = 0;
        s = reader.readUnsignedShort(&boneCountU16);
        if (!ok(s)) {
            return s;
        }
        const i32 boneCount = static_cast<i32>(boneCountU16);
        decoded.hasSkeletalBase = boneCount > 0;
        decoded.skeletalBoneCount = boneCount;
        if (boneCount > 0) {
            u8 poseCountU8 = 0;
            s = reader.readUnsignedByte(&poseCountU8);
            if (!ok(s)) {
                return s;
            }
            const i32 poseCount = static_cast<i32>(poseCountU8);
            decoded.skeletalBase.poseCount = poseCount;

            auto rr2 = decoded.skeletalBase.parentIds.resize(static_cast<std::size_t>(boneCount));
            if (!rr2.isOk()) return rr2.status();
            rr2 = decoded.skeletalBase.localMatrices.resize(static_cast<std::size_t>(boneCount) * static_cast<std::size_t>(poseCount));
            if (!rr2.isOk()) return rr2.status();
            rr2 = decoded.skeletalBase.rotations.resize(static_cast<std::size_t>(boneCount) * static_cast<std::size_t>(poseCount));
            if (!rr2.isOk()) return rr2.status();
            rr2 = decoded.skeletalBase.translations.resize(static_cast<std::size_t>(boneCount) * static_cast<std::size_t>(poseCount));
            if (!rr2.isOk()) return rr2.status();
            rr2 = decoded.skeletalBase.scalings.resize(static_cast<std::size_t>(boneCount) * static_cast<std::size_t>(poseCount));
            if (!rr2.isOk()) return rr2.status();

            for (i32 bone = 0; bone < boneCount; bone++) {
                i16 parentId = -1;
                s = reader.readShort(&parentId);
                if (!ok(s)) {
                    return s;
                }
                decoded.skeletalBase.parentIds[static_cast<std::size_t>(bone)] = static_cast<i32>(parentId);

                for (i32 pose = 0; pose < poseCount; pose++) {
                    const std::size_t idx = decoded.skeletalBase.matrixIndex(bone, pose);
                    Mat4f& m = decoded.skeletalBase.localMatrices[idx];
                    for (int e = 0; e < 16; e++) {
                        float f = 0.0f;
                        s = reader.readFloat(&f);
                        if (!ok(s)) {
                            return s;
                        }
                        m.v[e] = f;
                    }
                    float unused = 0.0f;
                    s = reader.readFloat(&unused);
                    if (!ok(s)) return s;
                    s = reader.readFloat(&unused);
                    if (!ok(s)) return s;
                    s = reader.readFloat(&unused);
                    if (!ok(s)) return s;
                }
            }

            for (i32 bone = 0; bone < boneCount; bone++) {
                for (i32 pose = 0; pose < poseCount; pose++) {
                    const std::size_t idx = decoded.skeletalBase.matrixIndex(bone, pose);
                    decodeSkeletalBaseTransforms(
                        decoded.skeletalBase,
                        bone,
                        pose,
                        &decoded.skeletalBase.rotations[idx],
                        &decoded.skeletalBase.translations[idx],
                        &decoded.skeletalBase.scalings[idx]);
                }
            }
        }
    }

    *out = rs::move(decoded);
    return Status::Ok;
}

} // namespace rs
