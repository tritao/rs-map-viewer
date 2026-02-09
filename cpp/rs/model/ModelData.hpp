#pragma once

#include <cstddef>

#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"

namespace rs {

// Typed C++ model surface aligned with TS ModelData.decode.
struct ModelData final {
    Allocator* alloc = nullptr;

    i32 version = -1;
    i32 verticesCount = 0;
    i32 usedVertexCount = 0;
    i32 faceCount = 0;
    i32 textureFaceCount = 0;
    i32 priority = 0;

    Vec<i32> verticesX{};
    Vec<i32> verticesY{};
    Vec<i32> verticesZ{};

    Vec<i32> indices1{};
    Vec<i32> indices2{};
    Vec<i32> indices3{};

    Vec<u16> faceColors{};

    bool hasFaceRenderTypes = false;
    Vec<i8> faceRenderTypes{};
    bool hasFaceRenderPriorities = false;
    Vec<i8> faceRenderPriorities{};
    bool hasFaceAlphas = false;
    Vec<i8> faceAlphas{};
    bool hasTextureCoords = false;
    Vec<i8> textureCoords{};
    bool hasFaceTextures = false;
    Vec<i16> faceTextures{};

    Vec<i8> textureRenderTypes{};
    Vec<i16> textureMappingP{};
    Vec<i16> textureMappingM{};
    Vec<i16> textureMappingN{};
    Vec<i32> textureScaleX{};
    Vec<i32> textureScaleY{};
    Vec<i32> textureScaleZ{};
    Vec<i8> textureRotation{};
    Vec<i8> textureDirection{};
    Vec<i32> textureSpeed{};
    Vec<i32> textureTransU{};
    Vec<i32> textureTransV{};

    bool hasVertexSkins = false;
    Vec<i32> vertexSkins{};
    bool hasFaceSkins = false;
    Vec<i32> faceSkins{};

    bool hasMayaGroups = false;
    Vec<Vec<i32>> animMayaGroups{};
    Vec<Vec<i32>> animMayaScales{};

    explicit ModelData(Allocator& alloc_ = defaultAllocator()) noexcept
        : alloc(&alloc_),
          verticesX(alloc_),
          verticesY(alloc_),
          verticesZ(alloc_),
          indices1(alloc_),
          indices2(alloc_),
          indices3(alloc_),
          faceColors(alloc_),
          faceRenderTypes(alloc_),
          faceRenderPriorities(alloc_),
          faceAlphas(alloc_),
          textureCoords(alloc_),
          faceTextures(alloc_),
          textureRenderTypes(alloc_),
          textureMappingP(alloc_),
          textureMappingM(alloc_),
          textureMappingN(alloc_),
          textureScaleX(alloc_),
          textureScaleY(alloc_),
          textureScaleZ(alloc_),
          textureRotation(alloc_),
          textureDirection(alloc_),
          textureSpeed(alloc_),
          textureTransU(alloc_),
          textureTransV(alloc_),
          vertexSkins(alloc_),
          faceSkins(alloc_),
          animMayaGroups(alloc_),
          animMayaScales(alloc_) {}
};

inline Allocator& modelAllocator(ModelData* out) noexcept {
    if (!out || !out->alloc) {
        return defaultAllocator();
    }
    return *out->alloc;
}

template <typename T>
inline void clearVec(Vec<T>* v) noexcept {
    if (!v) return;
    v->clear();
    v->releaseMemory();
}

template <typename T>
inline Status initRequiredVec(Vec<T>* v, std::size_t size) noexcept {
    if (!v) return Status::InvalidArgument;
    v->clear();
    auto rr = v->resize(size);
    if (!rr.isOk()) return rr.status();
    return Status::Ok;
}

template <typename T>
inline Status initOptionalVec(bool present, Vec<T>* v, std::size_t size, bool* outPresent) noexcept {
    if (!v || !outPresent) return Status::InvalidArgument;
    *outPresent = present;
    if (!present) {
        clearVec(v);
        return Status::Ok;
    }
    return initRequiredVec(v, size);
}

inline Status initOptionalNestedIntVec(
    bool present,
    i32 count,
    Vec<Vec<i32>>* groups,
    Vec<Vec<i32>>* scales,
    ModelData* out) noexcept {
    if (!groups || !scales || !out) return Status::InvalidArgument;
    if (count < 0) return Status::BadFormat;
    out->hasMayaGroups = present;
    if (!present) {
        clearVec(groups);
        clearVec(scales);
        return Status::Ok;
    }

    auto rr = groups->resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) return rr.status();
    rr = scales->resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) return rr.status();

    Allocator& alloc = modelAllocator(out);
    for (i32 i = 0; i < count; i++) {
        (*groups)[static_cast<std::size_t>(i)] = Vec<i32>(alloc);
        (*scales)[static_cast<std::size_t>(i)] = Vec<i32>(alloc);
    }
    return Status::Ok;
}

inline Status initModelCoreArrays(ModelData* out, i32 vertexCount, i32 faceCount) noexcept {
    if (!out) return Status::InvalidArgument;
    if (vertexCount < 0 || faceCount < 0) return Status::BadFormat;

    auto s = initRequiredVec(&out->verticesX, static_cast<std::size_t>(vertexCount));
    if (!ok(s)) return s;
    s = initRequiredVec(&out->verticesY, static_cast<std::size_t>(vertexCount));
    if (!ok(s)) return s;
    s = initRequiredVec(&out->verticesZ, static_cast<std::size_t>(vertexCount));
    if (!ok(s)) return s;

    s = initRequiredVec(&out->indices1, static_cast<std::size_t>(faceCount));
    if (!ok(s)) return s;
    s = initRequiredVec(&out->indices2, static_cast<std::size_t>(faceCount));
    if (!ok(s)) return s;
    s = initRequiredVec(&out->indices3, static_cast<std::size_t>(faceCount));
    if (!ok(s)) return s;
    s = initRequiredVec(&out->faceColors, static_cast<std::size_t>(faceCount));
    if (!ok(s)) return s;

    out->verticesCount = vertexCount;
    out->faceCount = faceCount;
    return Status::Ok;
}

inline Status decodeModelVerticesDelta(
    Span<const u8> data,
    std::size_t flagsOffset,
    std::size_t xOffset,
    std::size_t yOffset,
    std::size_t zOffset,
    i32 vertexCount,
    ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;

    Uint8ArrayReader flags(data, 0);
    Uint8ArrayReader xReader(data, 0);
    Uint8ArrayReader yReader(data, 0);
    Uint8ArrayReader zReader(data, 0);

    Status s = flags.seek(flagsOffset);
    if (!ok(s)) return s;
    s = xReader.seek(xOffset);
    if (!ok(s)) return s;
    s = yReader.seek(yOffset);
    if (!ok(s)) return s;
    s = zReader.seek(zOffset);
    if (!ok(s)) return s;

    i32 lastX = 0;
    i32 lastY = 0;
    i32 lastZ = 0;

    for (i32 i = 0; i < vertexCount; i++) {
        u8 flag = 0;
        s = flags.readUnsignedByte(&flag);
        if (!ok(s)) return s;

        i32 dx = 0;
        i32 dy = 0;
        i32 dz = 0;
        if ((flag & 0x1) != 0) {
            s = xReader.readSmart2(&dx);
            if (!ok(s)) return s;
        }
        if ((flag & 0x2) != 0) {
            s = yReader.readSmart2(&dy);
            if (!ok(s)) return s;
        }
        if ((flag & 0x4) != 0) {
            s = zReader.readSmart2(&dz);
            if (!ok(s)) return s;
        }

        const std::size_t vi = static_cast<std::size_t>(i);
        out->verticesX[vi] = lastX + dx;
        out->verticesY[vi] = lastY + dy;
        out->verticesZ[vi] = lastZ + dz;
        lastX = out->verticesX[vi];
        lastY = out->verticesY[vi];
        lastZ = out->verticesZ[vi];
    }

    return Status::Ok;
}

inline Status decodeModelFaceColors(
    Span<const u8> data,
    std::size_t faceColorOffset,
    i32 faceCount,
    ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;

    Uint8ArrayReader reader(data, 0);
    Status s = reader.seek(faceColorOffset);
    if (!ok(s)) return s;

    for (i32 i = 0; i < faceCount; i++) {
        u16 c = 0;
        s = reader.readUnsignedShort(&c);
        if (!ok(s)) return s;
        out->faceColors[static_cast<std::size_t>(i)] = c;
    }
    return Status::Ok;
}

inline Status decodeModelFaceIndices(
    Span<const u8> data,
    std::size_t faceIndexDataOffset,
    std::size_t faceIndexTypeOffset,
    i32 faceCount,
    bool trackUsedVertexCount,
    ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;

    Uint8ArrayReader dataReader(data, 0);
    Uint8ArrayReader typeReader(data, 0);
    Status s = dataReader.seek(faceIndexDataOffset);
    if (!ok(s)) return s;
    s = typeReader.seek(faceIndexTypeOffset);
    if (!ok(s)) return s;

    i32 index1 = 0;
    i32 index2 = 0;
    i32 index3 = 0;
    i32 lastIndex = 0;
    i32 used = -1;

    for (i32 i = 0; i < faceCount; i++) {
        u8 type = 0;
        s = typeReader.readUnsignedByte(&type);
        if (!ok(s)) return s;

        if (type == 1) {
            s = dataReader.readSmart2(&index1);
            if (!ok(s)) return s;
            index1 += lastIndex;
            s = dataReader.readSmart2(&index2);
            if (!ok(s)) return s;
            index2 += index1;
            s = dataReader.readSmart2(&index3);
            if (!ok(s)) return s;
            index3 += index2;
            lastIndex = index3;
        } else if (type == 2) {
            index2 = index3;
            s = dataReader.readSmart2(&index3);
            if (!ok(s)) return s;
            index3 += lastIndex;
            lastIndex = index3;
        } else if (type == 3) {
            index1 = index3;
            s = dataReader.readSmart2(&index3);
            if (!ok(s)) return s;
            index3 += lastIndex;
            lastIndex = index3;
        } else if (type == 4) {
            const i32 tmp = index1;
            index1 = index2;
            index2 = tmp;
            s = dataReader.readSmart2(&index3);
            if (!ok(s)) return s;
            index3 += lastIndex;
            lastIndex = index3;
        } else {
            return Status::BadFormat;
        }

        const std::size_t fi = static_cast<std::size_t>(i);
        out->indices1[fi] = index1;
        out->indices2[fi] = index2;
        out->indices3[fi] = index3;

        if (trackUsedVertexCount) {
            if (index1 > used) used = index1;
            if (index2 > used) used = index2;
            if (index3 > used) used = index3;
        }
    }

    if (trackUsedVertexCount) {
        out->usedVertexCount = used + 1;
    }
    return Status::Ok;
}

inline void scaleDownVertices(ModelData* out, i32 shift) noexcept {
    if (!out || shift <= 0) return;
    for (std::size_t i = 0; i < out->verticesX.size(); i++) {
        out->verticesX[i] >>= shift;
        out->verticesY[i] >>= shift;
        out->verticesZ[i] >>= shift;
    }
}

inline Status decodeTextureMappingV3(
    Span<const u8> data,
    std::size_t simpleTextureMappingOffset,
    std::size_t complexTextureMappingOffset,
    std::size_t complexTextureScaleOffset,
    std::size_t complexTextureRotationOffset,
    std::size_t complexTextureDirectionOffset,
    std::size_t complexTextureTranslationOffset,
    ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;
    if (out->textureFaceCount <= 0) return Status::Ok;

    Uint8ArrayReader simple(data, 0);
    Uint8ArrayReader complex(data, 0);
    Uint8ArrayReader scale(data, 0);
    Uint8ArrayReader rotation(data, 0);
    Uint8ArrayReader direction(data, 0);
    Uint8ArrayReader translation(data, 0);
    Status s = simple.seek(simpleTextureMappingOffset);
    if (!ok(s)) return s;
    s = complex.seek(complexTextureMappingOffset);
    if (!ok(s)) return s;
    s = scale.seek(complexTextureScaleOffset);
    if (!ok(s)) return s;
    s = rotation.seek(complexTextureRotationOffset);
    if (!ok(s)) return s;
    s = direction.seek(complexTextureDirectionOffset);
    if (!ok(s)) return s;
    s = translation.seek(complexTextureTranslationOffset);
    if (!ok(s)) return s;

    i32 complexIndex = 0;
    i32 cubeIndex = 0;
    for (i32 i = 0; i < out->textureFaceCount; i++) {
        const u8 type = static_cast<u8>(out->textureRenderTypes[static_cast<std::size_t>(i)]);
        if (type == 0) {
            u16 p = 0, m = 0, n = 0;
            s = simple.readUnsignedShort(&p);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&m);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&n);
            if (!ok(s)) return s;
            out->textureMappingP[static_cast<std::size_t>(i)] = static_cast<i16>(p);
            out->textureMappingM[static_cast<std::size_t>(i)] = static_cast<i16>(m);
            out->textureMappingN[static_cast<std::size_t>(i)] = static_cast<i16>(n);
            continue;
        }

        if (type < 1 || type > 3) {
            continue;
        }

        if (complexIndex < 0 || static_cast<std::size_t>(complexIndex) >= out->textureScaleX.size()) {
            return Status::BadFormat;
        }

        u16 p = 0, m = 0, n = 0;
        s = complex.readUnsignedShort(&p);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&m);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&n);
        if (!ok(s)) return s;
        out->textureMappingP[static_cast<std::size_t>(i)] = static_cast<i16>(p);
        out->textureMappingM[static_cast<std::size_t>(i)] = static_cast<i16>(m);
        out->textureMappingN[static_cast<std::size_t>(i)] = static_cast<i16>(n);

        u16 sx = 0, sy = 0, sz = 0;
        s = scale.readUnsignedShort(&sx);
        if (!ok(s)) return s;
        s = scale.readUnsignedShort(&sy);
        if (!ok(s)) return s;
        s = scale.readUnsignedShort(&sz);
        if (!ok(s)) return s;
        i8 rot = 0;
        i8 dir = 0;
        u8 speed = 0;
        s = rotation.readByte(&rot);
        if (!ok(s)) return s;
        s = direction.readByte(&dir);
        if (!ok(s)) return s;
        s = translation.readUnsignedByte(&speed);
        if (!ok(s)) return s;

        const std::size_t ci = static_cast<std::size_t>(complexIndex);
        out->textureScaleX[ci] = static_cast<i32>(sx);
        out->textureScaleY[ci] = static_cast<i32>(sy);
        out->textureScaleZ[ci] = static_cast<i32>(sz);
        out->textureRotation[ci] = rot;
        out->textureDirection[ci] = dir;
        out->textureSpeed[ci] = static_cast<i32>(speed);

        if (type == 2) {
            if (cubeIndex < 0 || static_cast<std::size_t>(cubeIndex) >= out->textureTransU.size()) {
                return Status::BadFormat;
            }
            u8 u = 0;
            u8 v = 0;
            s = translation.readUnsignedByte(&u);
            if (!ok(s)) return s;
            s = translation.readUnsignedByte(&v);
            if (!ok(s)) return s;
            out->textureTransU[static_cast<std::size_t>(cubeIndex)] = static_cast<i32>(u);
            out->textureTransV[static_cast<std::size_t>(cubeIndex)] = static_cast<i32>(v);
            cubeIndex++;
        }

        complexIndex++;
    }
    return Status::Ok;
}

inline Status decodeTextureMappingV1(
    Span<const u8> data,
    std::size_t simpleTexturesOffset,
    std::size_t complexTexturesOffset,
    std::size_t texturesScalesOffset,
    std::size_t texturesRotationOffset,
    std::size_t texturesDirectionOffset,
    std::size_t texturesTranslationOffset,
    i32 version,
    ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;
    if (out->textureFaceCount <= 0) return Status::Ok;

    Uint8ArrayReader simple(data, 0);
    Uint8ArrayReader complex(data, 0);
    Uint8ArrayReader scale(data, 0);
    Uint8ArrayReader rotation(data, 0);
    Uint8ArrayReader direction(data, 0);
    Uint8ArrayReader translation(data, 0);
    Status s = simple.seek(simpleTexturesOffset);
    if (!ok(s)) return s;
    s = complex.seek(complexTexturesOffset);
    if (!ok(s)) return s;
    s = scale.seek(texturesScalesOffset);
    if (!ok(s)) return s;
    s = rotation.seek(texturesRotationOffset);
    if (!ok(s)) return s;
    s = direction.seek(texturesDirectionOffset);
    if (!ok(s)) return s;
    s = translation.seek(texturesTranslationOffset);
    if (!ok(s)) return s;

    i32 complexIndex = 0;
    i32 cubeIndex = 0;
    for (i32 i = 0; i < out->textureFaceCount; i++) {
        const u8 type = static_cast<u8>(out->textureRenderTypes[static_cast<std::size_t>(i)]);
        if (type == 0) {
            u16 p = 0, m = 0, n = 0;
            s = simple.readUnsignedShort(&p);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&m);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&n);
            if (!ok(s)) return s;
            out->textureMappingP[static_cast<std::size_t>(i)] = static_cast<i16>(p);
            out->textureMappingM[static_cast<std::size_t>(i)] = static_cast<i16>(m);
            out->textureMappingN[static_cast<std::size_t>(i)] = static_cast<i16>(n);
            continue;
        }

        if (type < 1 || type > 3) {
            continue;
        }

        if (complexIndex < 0 || static_cast<std::size_t>(complexIndex) >= out->textureScaleX.size()) {
            return Status::BadFormat;
        }

        u16 p = 0, m = 0, n = 0;
        s = complex.readUnsignedShort(&p);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&m);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&n);
        if (!ok(s)) return s;
        out->textureMappingP[static_cast<std::size_t>(i)] = static_cast<i16>(p);
        out->textureMappingM[static_cast<std::size_t>(i)] = static_cast<i16>(m);
        out->textureMappingN[static_cast<std::size_t>(i)] = static_cast<i16>(n);

        i32 sx = 0;
        i32 sy = 0;
        i32 sz = 0;
        if (version < 15) {
            u16 sx16 = 0;
            s = scale.readUnsignedShort(&sx16);
            if (!ok(s)) return s;
            sx = static_cast<i32>(sx16);

            if (version >= 14) {
                u32 m24 = 0;
                s = scale.readMedium(&m24);
                if (!ok(s)) return s;
                sy = static_cast<i32>(m24);
            } else {
                u16 sy16 = 0;
                s = scale.readUnsignedShort(&sy16);
                if (!ok(s)) return s;
                sy = static_cast<i32>(sy16);
            }

            u16 sz16 = 0;
            s = scale.readUnsignedShort(&sz16);
            if (!ok(s)) return s;
            sz = static_cast<i32>(sz16);
        } else {
            u32 sx24 = 0, sy24 = 0, sz24 = 0;
            s = scale.readMedium(&sx24);
            if (!ok(s)) return s;
            s = scale.readMedium(&sy24);
            if (!ok(s)) return s;
            s = scale.readMedium(&sz24);
            if (!ok(s)) return s;
            sx = static_cast<i32>(sx24);
            sy = static_cast<i32>(sy24);
            sz = static_cast<i32>(sz24);
        }

        i8 rot = 0;
        i8 dir = 0;
        i8 speed = 0;
        s = rotation.readByte(&rot);
        if (!ok(s)) return s;
        s = direction.readByte(&dir);
        if (!ok(s)) return s;
        s = translation.readByte(&speed);
        if (!ok(s)) return s;

        const std::size_t ci = static_cast<std::size_t>(complexIndex);
        out->textureScaleX[ci] = sx;
        out->textureScaleY[ci] = sy;
        out->textureScaleZ[ci] = sz;
        out->textureRotation[ci] = rot;
        out->textureDirection[ci] = dir;
        out->textureSpeed[ci] = static_cast<i32>(speed);

        if (type == 2) {
            if (cubeIndex < 0 || static_cast<std::size_t>(cubeIndex) >= out->textureTransU.size()) {
                return Status::BadFormat;
            }
            i8 u = 0;
            i8 v = 0;
            s = translation.readByte(&u);
            if (!ok(s)) return s;
            s = translation.readByte(&v);
            if (!ok(s)) return s;
            out->textureTransU[static_cast<std::size_t>(cubeIndex)] = static_cast<i32>(u);
            out->textureTransV[static_cast<std::size_t>(cubeIndex)] = static_cast<i32>(v);
            cubeIndex++;
        }

        complexIndex++;
    }
    return Status::Ok;
}

inline void cleanupLegacyTextureFlags(ModelData* out, bool isTextured, bool hasRenderType) noexcept {
    if (!out) return;

    if (out->hasTextureCoords) {
        bool hasValidTexFace = false;
        for (i32 i = 0; i < out->faceCount; i++) {
            const std::size_t fi = static_cast<std::size_t>(i);
            const u8 index = static_cast<u8>(out->textureCoords[fi]);
            if (index != 255) {
                const std::size_t ti = static_cast<std::size_t>(index);
                if (ti < out->textureMappingP.size() &&
                    out->indices1[fi] == static_cast<i32>(static_cast<u16>(out->textureMappingP[ti])) &&
                    out->indices2[fi] == static_cast<i32>(static_cast<u16>(out->textureMappingM[ti])) &&
                    out->indices3[fi] == static_cast<i32>(static_cast<u16>(out->textureMappingN[ti]))) {
                    out->textureCoords[fi] = static_cast<i8>(-1);
                } else {
                    hasValidTexFace = true;
                }
            }
        }
        if (!hasValidTexFace) {
            out->hasTextureCoords = false;
            clearVec(&out->textureCoords);
        }
    }

    if (!isTextured) {
        out->hasFaceTextures = false;
        clearVec(&out->faceTextures);
    }

    if (!hasRenderType) {
        out->hasFaceRenderTypes = false;
        clearVec(&out->faceRenderTypes);
    }
}


#include "ModelDataDecodeV3.hpp"
#include "ModelDataDecodeV2.hpp"
#include "ModelDataDecodeV1.hpp"
#include "ModelDataDecodeOld.hpp"

inline Status decodeModelData(Span<const u8> data, ModelData* out, Allocator& alloc) noexcept {
    if (!out) return Status::InvalidArgument;
    if (data.size() < 2) return Status::BadFormat;

    ModelData decoded(alloc);
    const u8 b1 = data[data.size() - 1];
    const u8 b2 = data[data.size() - 2];

    Status s = Status::BadFormat;
    if (b1 == 0xFD && b2 == 0xFF) {
        s = decodeModelDataV3(data, &decoded);
    } else if (b1 == 0xFE && b2 == 0xFF) {
        s = decodeModelDataV2(data, &decoded);
    } else if (b1 == 0xFF && b2 == 0xFF) {
        s = decodeModelDataV1(data, &decoded);
    } else {
        s = decodeModelDataOld(data, &decoded);
    }
    if (!ok(s)) {
        return s;
    }

    *out = rs::move(decoded);
    return Status::Ok;
}

} // namespace rs
