#pragma once

#include <cmath>

#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../types.hpp"
#include "../ModelData.hpp"
#include "../seq/SeqBase.hpp"
#include "SkeletalSeq.hpp"

namespace rs {

struct Quatf final {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    float w = 1.0f;
};

inline void quatIdentity(Quatf* out) noexcept {
    if (!out) return;
    out->x = 0.0f;
    out->y = 0.0f;
    out->z = 0.0f;
    out->w = 1.0f;
}

inline void quatSetAxisAngle(const Vec3f& axis, float angle, Quatf* out) noexcept {
    if (!out) return;
    const double half = static_cast<double>(angle) * 0.5;
    const double s = std::sin(half);
    out->x = static_cast<float>(static_cast<double>(axis.x) * s);
    out->y = static_cast<float>(static_cast<double>(axis.y) * s);
    out->z = static_cast<float>(static_cast<double>(axis.z) * s);
    out->w = static_cast<float>(std::cos(half));
}

inline void quatMul(const Quatf& a, const Quatf& b, Quatf* out) noexcept {
    if (!out) return;
    Quatf r{};
    r.x = static_cast<float>(static_cast<double>(a.x) * static_cast<double>(b.w) +
                             static_cast<double>(a.w) * static_cast<double>(b.x) +
                             static_cast<double>(a.y) * static_cast<double>(b.z) -
                             static_cast<double>(a.z) * static_cast<double>(b.y));
    r.y = static_cast<float>(static_cast<double>(a.y) * static_cast<double>(b.w) +
                             static_cast<double>(a.w) * static_cast<double>(b.y) +
                             static_cast<double>(a.z) * static_cast<double>(b.x) -
                             static_cast<double>(a.x) * static_cast<double>(b.z));
    r.z = static_cast<float>(static_cast<double>(a.z) * static_cast<double>(b.w) +
                             static_cast<double>(a.w) * static_cast<double>(b.z) +
                             static_cast<double>(a.x) * static_cast<double>(b.y) -
                             static_cast<double>(a.y) * static_cast<double>(b.x));
    r.w = static_cast<float>(static_cast<double>(a.w) * static_cast<double>(b.w) -
                             static_cast<double>(a.x) * static_cast<double>(b.x) -
                             static_cast<double>(a.y) * static_cast<double>(b.y) -
                             static_cast<double>(a.z) * static_cast<double>(b.z));
    *out = r;
}

inline void mat4FromQuat(const Quatf& q, Mat4f* out) noexcept {
    if (!out) return;
    const double x = static_cast<double>(q.x);
    const double y = static_cast<double>(q.y);
    const double z = static_cast<double>(q.z);
    const double w = static_cast<double>(q.w);
    const double x2 = x + x;
    const double y2 = y + y;
    const double z2 = z + z;

    const double xx = x * x2;
    const double yx = y * x2;
    const double yy = y * y2;
    const double zx = z * x2;
    const double zy = z * y2;
    const double zz = z * z2;
    const double wx = w * x2;
    const double wy = w * y2;
    const double wz = w * z2;

    out->v[0] = static_cast<float>(1.0 - yy - zz);
    out->v[1] = static_cast<float>(yx + wz);
    out->v[2] = static_cast<float>(zx - wy);
    out->v[3] = 0.0f;

    out->v[4] = static_cast<float>(yx - wz);
    out->v[5] = static_cast<float>(1.0 - xx - zz);
    out->v[6] = static_cast<float>(zy + wx);
    out->v[7] = 0.0f;

    out->v[8] = static_cast<float>(zx + wy);
    out->v[9] = static_cast<float>(zy - wx);
    out->v[10] = static_cast<float>(1.0 - xx - yy);
    out->v[11] = 0.0f;

    out->v[12] = 0.0f;
    out->v[13] = 0.0f;
    out->v[14] = 0.0f;
    out->v[15] = 1.0f;
}

inline void mat4FromScaling(const Vec3f& s, Mat4f* out) noexcept {
    if (!out) return;
    mat4Identity(out);
    out->v[0] = s.x;
    out->v[5] = s.y;
    out->v[10] = s.z;
}

inline Status computeSkeletalFinalMatrices(
    const SeqBase& base,
    const SkeletalSeq& seq,
    i32 frame,
    Vec<Mat4f>* outFinalMatrices,
    Allocator& alloc) noexcept {
    if (!outFinalMatrices) return Status::InvalidArgument;
    outFinalMatrices->clear();
    if (!base.hasSkeletalBase || !base.skeletalBase.hasData()) {
        return Status::NotFound;
    }

    const SkeletalBaseData& sk = base.skeletalBase;
    const i32 boneCount = sk.boneCount();
    const i32 poseId = seq.poseId;
    if (poseId < 0 || poseId >= sk.poseCount) {
        return Status::OutOfRange;
    }

    auto rr = outFinalMatrices->resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();

    Vec<Mat4f> modelMatrices(alloc);
    Vec<Mat4f> invertedModelMatrices(alloc);
    Vec<Mat4f> animMatrices(alloc);
    Vec<Mat4f> animModelMatrices(alloc);
    Vec<u8> hasModel(alloc);
    Vec<u8> hasInverted(alloc);
    Vec<u8> hasAnim(alloc);
    Vec<u8> hasAnimModel(alloc);

    rr = modelMatrices.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = invertedModelMatrices.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = animMatrices.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = animModelMatrices.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = hasModel.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = hasInverted.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = hasAnim.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();
    rr = hasAnimModel.resize(static_cast<std::size_t>(boneCount));
    if (!rr.isOk()) return rr.status();

    for (std::size_t i = 0; i < hasModel.size(); i++) {
        hasModel[i] = 0;
        hasInverted[i] = 0;
        hasAnim[i] = 0;
        hasAnimModel[i] = 0;
        mat4Identity(&modelMatrices[i]);
        mat4Identity(&invertedModelMatrices[i]);
        mat4Identity(&animMatrices[i]);
        mat4Identity(&animModelMatrices[i]);
        mat4Identity(&(*outFinalMatrices)[i]);
    }

    auto computeModelMatrix = [&](auto&& self, i32 boneId) -> Status {
        if (boneId < 0 || boneId >= boneCount) return Status::OutOfRange;
        const std::size_t bi = static_cast<std::size_t>(boneId);
        if (hasModel[bi] != 0) return Status::Ok;

        const i32 parentId = sk.parentIds[bi];
        const Mat4f& local = sk.localMatrices[sk.matrixIndex(boneId, poseId)];
        if (parentId >= 0) {
            Status s = self(self, parentId);
            if (!ok(s)) return s;
            Mat4f combined{};
            mat4Mul(modelMatrices[static_cast<std::size_t>(parentId)], local, &combined);
            modelMatrices[bi] = combined;
        } else {
            modelMatrices[bi] = local;
        }
        hasModel[bi] = 1;
        return Status::Ok;
    };

    auto computeInvertedModelMatrix = [&](auto&& self, i32 boneId) -> Status {
        if (boneId < 0 || boneId >= boneCount) return Status::OutOfRange;
        const std::size_t bi = static_cast<std::size_t>(boneId);
        if (hasInverted[bi] != 0) return Status::Ok;
        Status s = computeModelMatrix(computeModelMatrix, boneId);
        if (!ok(s)) return s;
        if (!mat4Invert(modelMatrices[bi], &invertedModelMatrices[bi])) {
            return Status::BadFormat;
        }
        hasInverted[bi] = 1;
        return Status::Ok;
    };

    auto computeAnimMatrix = [&](i32 boneId) -> Status {
        if (boneId < 0 || boneId >= boneCount) return Status::OutOfRange;
        const std::size_t bi = static_cast<std::size_t>(boneId);
        if (hasAnim[bi] != 0) return Status::Ok;

        Vec3f rotation = sk.rotations[sk.matrixIndex(boneId, poseId)];
        Vec3f scaling = sk.scalings[sk.matrixIndex(boneId, poseId)];
        Vec3f translation = sk.translations[sk.matrixIndex(boneId, poseId)];

        for (std::size_t i = 0; i < seq.bindings.size(); i++) {
            const SkeletalCurveBinding& binding = seq.bindings[i];
            if (binding.transformType != SkeletalTransformType::BONE) {
                continue;
            }
            if (binding.boneIndex != boneId) {
                continue;
            }
            const float v = getSkeletalCurveValue(binding.curve, frame);
            switch (binding.curveIndex) {
                case 0: rotation.x = v; break;
                case 1: rotation.y = v; break;
                case 2: rotation.z = v; break;
                case 3: translation.x = v; break;
                case 4: translation.y = v; break;
                case 5: translation.z = v; break;
                case 6: scaling.x = v; break;
                case 7: scaling.y = v; break;
                case 8: scaling.z = v; break;
                default: break;
            }
        }

        Quatf qx{}, qy{}, qz{}, q{};
        quatSetAxisAngle(Vec3f{1.0f, 0.0f, 0.0f}, rotation.x, &qx);
        quatSetAxisAngle(Vec3f{0.0f, 1.0f, 0.0f}, rotation.y, &qy);
        quatSetAxisAngle(Vec3f{0.0f, 0.0f, 1.0f}, rotation.z, &qz);
        quatIdentity(&q);
        quatMul(qz, q, &q);
        quatMul(qx, q, &q);
        quatMul(qy, q, &q);

        Mat4f rotateM{};
        Mat4f scaleM{};
        mat4FromQuat(q, &rotateM);
        mat4FromScaling(scaling, &scaleM);
        mat4Mul(scaleM, rotateM, &animMatrices[bi]);
        animMatrices[bi].v[12] = translation.x;
        animMatrices[bi].v[13] = translation.y;
        animMatrices[bi].v[14] = translation.z;
        hasAnim[bi] = 1;
        return Status::Ok;
    };

    auto computeAnimModelMatrix = [&](auto&& self, i32 boneId) -> Status {
        if (boneId < 0 || boneId >= boneCount) return Status::OutOfRange;
        const std::size_t bi = static_cast<std::size_t>(boneId);
        if (hasAnimModel[bi] != 0) return Status::Ok;

        Status s = computeAnimMatrix(boneId);
        if (!ok(s)) return s;

        const i32 parentId = sk.parentIds[bi];
        if (parentId >= 0) {
            s = self(self, parentId);
            if (!ok(s)) return s;
            Mat4f combined{};
            mat4Mul(animModelMatrices[static_cast<std::size_t>(parentId)], animMatrices[bi], &combined);
            animModelMatrices[bi] = combined;
        } else {
            animModelMatrices[bi] = animMatrices[bi];
        }
        hasAnimModel[bi] = 1;
        return Status::Ok;
    };

    for (i32 boneId = 0; boneId < boneCount; boneId++) {
        Status s = computeAnimModelMatrix(computeAnimModelMatrix, boneId);
        if (!ok(s)) return s;
        s = computeInvertedModelMatrix(computeInvertedModelMatrix, boneId);
        if (!ok(s)) return s;
        mat4Mul(
            animModelMatrices[static_cast<std::size_t>(boneId)],
            invertedModelMatrices[static_cast<std::size_t>(boneId)],
            &(*outFinalMatrices)[static_cast<std::size_t>(boneId)]);
    }

    return Status::Ok;
}

inline void transformModelVertexWithMatrix(ModelData& model, i32 vertexIndex, const Mat4f& m) noexcept {
    const std::size_t vi = static_cast<std::size_t>(vertexIndex);
    const i32 vx = model.verticesX[vi];
    const i32 vy = -model.verticesY[vi];
    const i32 vz = -model.verticesZ[vi];
    const float fx = static_cast<float>(vx);
    const float fy = static_cast<float>(vy);
    const float fz = static_cast<float>(vz);

    // Match JS Math.round semantics (ties toward +infinity), not std::lround.
    const auto jsRoundToI32 = [](double x) noexcept -> i32 {
        return static_cast<i32>(std::floor(x + 0.5));
    };
    const i32 outX = jsRoundToI32(static_cast<double>(m.v[0]) * fx +
                                  static_cast<double>(m.v[4]) * fy +
                                  static_cast<double>(m.v[8]) * fz +
                                  static_cast<double>(m.v[12]));
    const i32 outY = jsRoundToI32(static_cast<double>(m.v[1]) * fx +
                                  static_cast<double>(m.v[5]) * fy +
                                  static_cast<double>(m.v[9]) * fz +
                                  static_cast<double>(m.v[13]));
    const i32 outZ = jsRoundToI32(static_cast<double>(m.v[2]) * fx +
                                  static_cast<double>(m.v[6]) * fy +
                                  static_cast<double>(m.v[10]) * fz +
                                  static_cast<double>(m.v[14]));

    model.verticesX[vi] = outX;
    model.verticesY[vi] = -outY;
    model.verticesZ[vi] = -outZ;
}

inline Status buildFaceLabelsFromFaceSkins(
    const ModelData& model,
    Vec<Vec<i32>>* outFaceLabels,
    Allocator& alloc) noexcept {
    if (!outFaceLabels) return Status::InvalidArgument;
    outFaceLabels->clear();

    if (!model.hasFaceSkins || model.faceSkins.empty() || model.faceCount <= 0) {
        return Status::Ok;
    }

    const std::size_t faceCount = static_cast<std::size_t>(model.faceCount);
    const std::size_t n = model.faceSkins.size() < faceCount ? model.faceSkins.size() : faceCount;
    i32 maxSkin = -1;
    for (std::size_t i = 0; i < n; i++) {
        const i32 skin = model.faceSkins[i];
        if (skin > maxSkin) maxSkin = skin;
    }
    if (maxSkin < 0) {
        return Status::Ok;
    }

    auto rr = outFaceLabels->resize(static_cast<std::size_t>(maxSkin + 1));
    if (!rr.isOk()) return rr.status();

    Vec<i32> counts(alloc);
    rr = counts.resize(static_cast<std::size_t>(maxSkin + 1));
    if (!rr.isOk()) return rr.status();
    for (std::size_t i = 0; i < counts.size(); i++) counts[i] = 0;

    for (std::size_t fi = 0; fi < n; fi++) {
        const i32 skin = model.faceSkins[fi];
        if (skin < 0 || skin > maxSkin) continue;
        counts[static_cast<std::size_t>(skin)]++;
    }

    for (i32 skin = 0; skin <= maxSkin; skin++) {
        (*outFaceLabels)[static_cast<std::size_t>(skin)] = Vec<i32>(alloc);
        rr = (*outFaceLabels)[static_cast<std::size_t>(skin)].resize(
            static_cast<std::size_t>(counts[static_cast<std::size_t>(skin)]));
        if (!rr.isOk()) return rr.status();
        counts[static_cast<std::size_t>(skin)] = 0;
    }

    for (std::size_t fi = 0; fi < n; fi++) {
        const i32 skin = model.faceSkins[fi];
        if (skin < 0 || skin > maxSkin) continue;
        const std::size_t si = static_cast<std::size_t>(skin);
        const i32 writeIndex = counts[si]++;
        (*outFaceLabels)[si][static_cast<std::size_t>(writeIndex)] = static_cast<i32>(fi);
    }

    return Status::Ok;
}

inline Status applySkeletalAlphaToModel(
    ModelData* model,
    const SeqBase& base,
    const SkeletalSeq& seq,
    i32 frame,
    Allocator& alloc) noexcept {
    if (!model) return Status::InvalidArgument;
    if (!seq.hasAlphaTransform) return Status::Ok;
    if (!model->hasFaceAlphas || model->faceAlphas.empty()) return Status::Ok;
    if (base.types.empty() || base.labels.empty()) return Status::Ok;

    Vec<Vec<i32>> faceLabels(alloc);
    Status s = buildFaceLabelsFromFaceSkins(*model, &faceLabels, alloc);
    if (!ok(s)) return s;
    if (faceLabels.empty()) return Status::Ok;

    for (i32 transformIndex = 0; transformIndex < base.count; transformIndex++) {
        const std::size_t ti = static_cast<std::size_t>(transformIndex);
        if (ti >= base.types.size() || ti >= base.labels.size()) {
            continue;
        }
        if (base.types[ti] != SeqTransformType::ALPHA) {
            continue;
        }

        // TS transformSkeletalAlpha reads skeletalSeq.curves[i][0] for each ALPHA transform index.
        // In TS decode, `curves` stores all non-BONE transforms in a shared table, so last
        // non-BONE curveIndex=0 binding for this transform index wins (not strictly ALPHA-only).
        const SkeletalCurveBinding* selected = nullptr;
        for (std::size_t bi = 0; bi < seq.bindings.size(); bi++) {
            const SkeletalCurveBinding& binding = seq.bindings[bi];
            if (binding.transformType == SkeletalTransformType::BONE) continue;
            if (binding.boneIndex != transformIndex) continue;
            if (binding.curveIndex != 0) continue;
            selected = &binding;
        }
        if (!selected) {
            continue;
        }

        const double deltaAlpha = static_cast<double>(getSkeletalCurveValue(selected->curve, frame)) * 255.0;
        const Vec<i32>& labels = base.labels[ti];
        for (std::size_t li = 0; li < labels.size(); li++) {
            const i32 label = labels[li];
            if (label < 0 || static_cast<std::size_t>(label) >= faceLabels.size()) {
                continue;
            }
            const Vec<i32>& faces = faceLabels[static_cast<std::size_t>(label)];
            for (std::size_t fi = 0; fi < faces.size(); fi++) {
                const i32 faceIndex = faces[fi];
                if (faceIndex < 0 || static_cast<std::size_t>(faceIndex) >= model->faceAlphas.size()) {
                    continue;
                }
                const std::size_t outIndex = static_cast<std::size_t>(faceIndex);
                const int alpha = static_cast<unsigned char>(model->faceAlphas[outIndex]);
                double nextAlpha = static_cast<double>(alpha) + deltaAlpha;
                if (nextAlpha < 0.0) nextAlpha = 0.0;
                else if (nextAlpha > 255.0) nextAlpha = 255.0;
                const int stored = static_cast<int>(nextAlpha); // JS typed-array semantics: trunc toward zero.
                model->faceAlphas[outIndex] = static_cast<i8>(stored & 0xff);
            }
        }
    }

    return Status::Ok;
}

inline Status applySkeletalToModel(
    ModelData* model,
    const SeqBase& base,
    const SkeletalSeq& seq,
    i32 frame,
    Allocator& alloc) noexcept;

inline Status applySkeletalToModelBaseOnly(
    ModelData* model,
    const SeqBase& base,
    const SkeletalSeq& seq,
    i32 frame,
    Allocator& alloc) noexcept {
    if (!model) return Status::InvalidArgument;
    if (!model->hasMayaGroups) return Status::Ok;
    if (seq.curveCount > 0) return Status::Unsupported;

    return applySkeletalToModel(model, base, seq, frame, alloc);
}

inline Status computeSkeletalFinalMatricesBaseOnly(
    const SeqBase& base,
    const SkeletalSeq& seq,
    Vec<Mat4f>* outFinalMatrices,
    Allocator& alloc) noexcept {
    if (seq.curveCount > 0) return Status::Unsupported;
    return computeSkeletalFinalMatrices(base, seq, /*frame=*/0, outFinalMatrices, alloc);
}

inline Status applySkeletalToModel(
    ModelData* model,
    const SeqBase& base,
    const SkeletalSeq& seq,
    i32 frame,
    Allocator& alloc) noexcept {
    if (!model) return Status::InvalidArgument;
    const bool hasMayaGroups = model->hasMayaGroups;

    Vec<Mat4f> finalMatrices(alloc);
    if (hasMayaGroups) {
        Status s = computeSkeletalFinalMatrices(base, seq, frame, &finalMatrices, alloc);
        if (!ok(s)) return s;
        if (finalMatrices.empty()) return Status::Ok;

        for (i32 v = 0; v < model->verticesCount; v++) {
            const std::size_t vi = static_cast<std::size_t>(v);
            if (vi >= model->animMayaGroups.size() || vi >= model->animMayaScales.size()) {
                continue;
            }
            const Vec<i32>& group = model->animMayaGroups[vi];
            const Vec<i32>& scales = model->animMayaScales[vi];
            if (group.empty() || scales.empty()) {
                continue;
            }

            Mat4f transform{};
            for (int k = 0; k < 16; k++) transform.v[k] = 0.0f;
            Mat4f scaleM{};
            Mat4f weightedBone{};

            const std::size_t n = group.size() < scales.size() ? group.size() : scales.size();
            for (std::size_t i = 0; i < n; i++) {
                const i32 boneId = group[i];
                if (boneId < 0 || static_cast<std::size_t>(boneId) >= finalMatrices.size()) {
                    continue;
                }
                const float w = static_cast<float>(scales[i]) / 255.0f;
                mat4FromScaling(Vec3f{w, w, w}, &scaleM);
                mat4Mul(scaleM, finalMatrices[static_cast<std::size_t>(boneId)], &weightedBone);
                for (int e = 0; e < 16; e++) {
                    transform.v[e] += weightedBone.v[e];
                }
            }

            transformModelVertexWithMatrix(*model, v, transform);
        }
    }

    return applySkeletalAlphaToModel(model, base, seq, frame, alloc);
}

} // namespace rs
