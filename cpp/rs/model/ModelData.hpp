#pragma once

#include <cstddef>
#include <cmath>

#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"
#include "../util/HeightCalc.hpp"

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
    // TS parity: ModelData.merge allocates vertex arrays to the *sum* of input verticesCount,
    // then increments verticesCount only for unique vertices (dedupe). Trailing entries remain 0.
    // TS hashing/grouping (ModelHashBuffer) uses the full array length, so we track that length
    // here to allow padding with zeros during hashing without inflating vertex iteration elsewhere.
    i32 tsVerticesAllocCount = 0;

    Vec<i32> verticesX{};
    Vec<i32> verticesY{};
    Vec<i32> verticesZ{};
    // TS parity: ModelData.contourGround keeps base verticesY and stores warped heights in contourVerticesY.
    // When present, mergeNormals/bounds/normals should use contourVerticesY, but model hashing uses verticesY.
    Vec<i32> contourVerticesY{};

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
          contourVerticesY(alloc_),
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

    void rotate90() noexcept {
        for (std::size_t i = 0; i < verticesX.size(); i++) {
            const i32 x = verticesX[i];
            verticesX[i] = verticesZ[i];
            verticesZ[i] = -x;
        }
    }

    void rotate180() noexcept {
        for (std::size_t i = 0; i < verticesX.size(); i++) {
            verticesX[i] = -verticesX[i];
            verticesZ[i] = -verticesZ[i];
        }
    }

    void rotate270() noexcept {
        for (std::size_t i = 0; i < verticesX.size(); i++) {
            const i32 z = verticesZ[i];
            verticesZ[i] = verticesX[i];
            verticesX[i] = -z;
        }
    }

    void rotate(i32 angle) noexcept {
        if (verticesX.empty()) {
            return;
        }
        // TS parity: ModelData.rotate uses fixed Q16 trig tables (SINE/COSINE) with 32-bit wrapping
        // numerators before shifting. Using floating trig introduces +/-1 drift that affects contour sampling.
        const i32 normalized = angle & 2047;
        const Span<const i32> cosine = HeightCalc::cosine65536();
        const i64 sinQ16 = static_cast<i64>(cosine[static_cast<std::size_t>((normalized - 512) & 2047)]);
        const i64 cosQ16 = static_cast<i64>(cosine[static_cast<std::size_t>(normalized)]);

        std::size_t count = static_cast<std::size_t>(verticesCount < 0 ? 0 : verticesCount);
        if (verticesX.size() < count) count = verticesX.size();
        if (verticesZ.size() < count) count = verticesZ.size();

        auto wrapI32 = [](i64 v) noexcept -> i32 {
            const u32 uv = static_cast<u32>(v);
            return static_cast<i32>(uv);
        };

        for (std::size_t i = 0; i < count; i++) {
            const i64 x = static_cast<i64>(verticesX[i]);
            const i64 z = static_cast<i64>(verticesZ[i]);
            const i32 tempNumerator = wrapI32(sinQ16 * z + cosQ16 * x);
            const i32 zNumerator = wrapI32(cosQ16 * z - sinQ16 * x);
            verticesZ[i] = zNumerator >> 16;
            verticesX[i] = tempNumerator >> 16;
        }
    }

    void translate(i32 x, i32 y, i32 z) noexcept {
        for (std::size_t i = 0; i < verticesX.size(); i++) {
            verticesX[i] += x;
            verticesY[i] += y;
            verticesZ[i] += z;
        }
    }

    void recolor(i32 from, i32 to) noexcept {
        const u16 fromColor = static_cast<u16>(from & 0xffff);
        const u16 toColor = static_cast<u16>(to & 0xffff);
        for (std::size_t i = 0; i < faceColors.size(); i++) {
            if (faceColors[i] == fromColor) {
                faceColors[i] = toColor;
            }
        }
    }

    void retexture(i32 from, i32 to) noexcept {
        if (!hasFaceTextures) {
            return;
        }
        const i16 fromTex = static_cast<i16>(from);
        const i16 toTex = static_cast<i16>(to);
        for (std::size_t i = 0; i < faceTextures.size(); i++) {
            if (faceTextures[i] == fromTex) {
                faceTextures[i] = toTex;
            }
        }
    }

    void mirror() noexcept {
        for (std::size_t i = 0; i < verticesZ.size(); i++) {
            verticesZ[i] = -verticesZ[i];
        }
        for (std::size_t i = 0; i < indices1.size() && i < indices3.size(); i++) {
            const i32 t = indices1[i];
            indices1[i] = indices3[i];
            indices3[i] = t;
        }
    }

    void resize(i32 resizeX, i32 resizeY, i32 resizeZ) noexcept {
        for (std::size_t i = 0; i < verticesX.size(); i++) {
            verticesX[i] =
                static_cast<i32>((static_cast<i64>(verticesX[i]) * resizeX) / 128);
            verticesY[i] =
                static_cast<i32>((static_cast<i64>(verticesY[i]) * resizeY) / 128);
            verticesZ[i] =
                static_cast<i32>((static_cast<i64>(verticesZ[i]) * resizeZ) / 128);
        }
    }

    // TS parity: ModelData.decodeV1 calls scaleDown(2) for version >= 13.
    // This shifts decoded vertex coordinates and (some) texture scale params by 4.
    void scaleDown(i32 n) noexcept {
        if (n <= 0) return;

        std::size_t vCount = static_cast<std::size_t>(verticesCount < 0 ? 0 : verticesCount);
        if (verticesX.size() < vCount) vCount = verticesX.size();
        if (verticesY.size() < vCount) vCount = verticesY.size();
        if (verticesZ.size() < vCount) vCount = verticesZ.size();
        for (std::size_t i = 0; i < vCount; i++) {
            verticesX[i] >>= n;
            verticesY[i] >>= n;
            verticesZ[i] >>= n;
        }

        if (textureFaceCount <= 0) return;
        if (textureScaleX.empty() || textureScaleY.empty()) return;

        std::size_t tCount = static_cast<std::size_t>(textureFaceCount);
        if (textureScaleX.size() < tCount) tCount = textureScaleX.size();
        if (textureScaleY.size() < tCount) tCount = textureScaleY.size();
        for (std::size_t i = 0; i < tCount; i++) {
            textureScaleX[i] >>= n;
            textureScaleY[i] >>= n;

            // TS parity: only shift Z when renderType != 1.
            if (!textureScaleZ.empty() && i < textureScaleZ.size()) {
                i8 type = 0;
                if (!textureRenderTypes.empty() && i < textureRenderTypes.size()) {
                    type = textureRenderTypes[i];
                }
                if (type != 1) {
                    textureScaleZ[i] >>= n;
                }
            }
        }
    }
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

    for (i32 i = 0; i < out->textureFaceCount; i++) {
        const std::size_t ti = static_cast<std::size_t>(i);
        const u8 type = static_cast<u8>(out->textureRenderTypes[ti]);
        if (type == 0) {
            u16 p = 0, m = 0, n = 0;
            s = simple.readUnsignedShort(&p);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&m);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&n);
            if (!ok(s)) return s;
            out->textureMappingP[ti] = static_cast<i16>(p);
            out->textureMappingM[ti] = static_cast<i16>(m);
            out->textureMappingN[ti] = static_cast<i16>(n);
            continue;
        }

        if (type < 1 || type > 3) {
            continue;
        }

        u16 p = 0, m = 0, n = 0;
        s = complex.readUnsignedShort(&p);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&m);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&n);
        if (!ok(s)) return s;
        out->textureMappingP[ti] = static_cast<i16>(p);
        out->textureMappingM[ti] = static_cast<i16>(m);
        out->textureMappingN[ti] = static_cast<i16>(n);

        u16 sx = 0, sy = 0, sz = 0;
        s = scale.readUnsignedShort(&sx);
        if (!ok(s)) return s;
        s = scale.readUnsignedShort(&sy);
        if (!ok(s)) return s;
        s = scale.readUnsignedShort(&sz);
        if (!ok(s)) return s;
        i8 rot = 0;
        i8 dir = 0;
        i8 speed = 0;
        s = rotation.readByte(&rot);
        if (!ok(s)) return s;
        s = direction.readByte(&dir);
        if (!ok(s)) return s;
        // TS parity: textureSpeed is a signed byte.
        s = translation.readByte(&speed);
        if (!ok(s)) return s;

        // TS parity: these arrays are indexed by texture-face index (same index as textureRenderTypes).
        out->textureScaleX[ti] = static_cast<i32>(sx);
        out->textureScaleY[ti] = static_cast<i32>(sy);
        out->textureScaleZ[ti] = static_cast<i32>(sz);
        out->textureRotation[ti] = rot;
        out->textureDirection[ti] = dir;
        out->textureSpeed[ti] = static_cast<i32>(speed);

        if (type == 2) {
            i8 u = 0;
            i8 v = 0;
            s = translation.readByte(&u);
            if (!ok(s)) return s;
            s = translation.readByte(&v);
            if (!ok(s)) return s;
            out->textureTransU[ti] = static_cast<i32>(u);
            out->textureTransV[ti] = static_cast<i32>(v);
        }
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

    for (i32 i = 0; i < out->textureFaceCount; i++) {
        const std::size_t ti = static_cast<std::size_t>(i);
        const u8 type = static_cast<u8>(out->textureRenderTypes[ti]);
        if (type == 0) {
            u16 p = 0, m = 0, n = 0;
            s = simple.readUnsignedShort(&p);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&m);
            if (!ok(s)) return s;
            s = simple.readUnsignedShort(&n);
            if (!ok(s)) return s;
            out->textureMappingP[ti] = static_cast<i16>(p);
            out->textureMappingM[ti] = static_cast<i16>(m);
            out->textureMappingN[ti] = static_cast<i16>(n);
            continue;
        }

        if (type < 1 || type > 3) {
            continue;
        }

        u16 p = 0, m = 0, n = 0;
        s = complex.readUnsignedShort(&p);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&m);
        if (!ok(s)) return s;
        s = complex.readUnsignedShort(&n);
        if (!ok(s)) return s;
        out->textureMappingP[ti] = static_cast<i16>(p);
        out->textureMappingM[ti] = static_cast<i16>(m);
        out->textureMappingN[ti] = static_cast<i16>(n);

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

        // TS parity: per-texture-face indexing (same index as textureRenderTypes).
        out->textureScaleX[ti] = sx;
        out->textureScaleY[ti] = sy;
        out->textureScaleZ[ti] = sz;
        out->textureRotation[ti] = rot;
        out->textureDirection[ti] = dir;
        out->textureSpeed[ti] = static_cast<i32>(speed);

        if (type == 2) {
            i8 u = 0;
            i8 v = 0;
            s = translation.readByte(&u);
            if (!ok(s)) return s;
            s = translation.readByte(&v);
            if (!ok(s)) return s;
            out->textureTransU[ti] = static_cast<i32>(u);
            out->textureTransV[ti] = static_cast<i32>(v);
        }
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

    // Decoded models have no TS merge padding; array length matches verticesCount.
    decoded.tsVerticesAllocCount = decoded.verticesCount;

    *out = rs::move(decoded);
    return Status::Ok;
}

// TS parity: `ModelData.merge(models, count)` used for multi-part locs/NPCs.
// This performs vertex dedupe by exact XYZ match and copies optional face attributes.
// Important: TS merges on base verticesY (not contourVerticesY).
inline Status mergeModelDataTS(
    Span<const ModelData> models,
    i32 count,
    ModelData* out,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (count < 0) {
        return Status::BadFormat;
    }
    if (static_cast<std::size_t>(count) > models.size()) {
        return Status::SizeMismatch;
    }

    out->version = 12;
    out->verticesCount = 0;
    out->usedVertexCount = 0;
    out->faceCount = 0;
    out->textureFaceCount = 0;
    out->priority = -1;

    bool hasRenderTypes = false;
    bool hasRenderPriorities = false;
    bool hasAlphas = false;
    bool hasFaceSkins = false;
    bool hasTextures = false;
    bool hasTextureCoords = false;
    bool hasMayaGroups = false;
    bool hasVertexSkins = false;

    i32 totalVertices = 0;
    i32 totalFaces = 0;
    i32 totalTextureFaces = 0;

    for (i32 i = 0; i < count; i++) {
        const ModelData& m = models[static_cast<std::size_t>(i)];
        totalVertices += m.verticesCount;
        totalFaces += m.faceCount;
        totalTextureFaces += m.textureFaceCount;

        if (m.hasFaceRenderPriorities) {
            hasRenderPriorities = true;
        } else {
            if (out->priority == -1) {
                out->priority = m.priority;
            }
            if (out->priority != m.priority) {
                hasRenderPriorities = true;
            }
        }

        hasRenderTypes = hasRenderTypes || m.hasFaceRenderTypes;
        hasAlphas = hasAlphas || m.hasFaceAlphas;
        hasFaceSkins = hasFaceSkins || m.hasFaceSkins;
        hasTextures = hasTextures || m.hasFaceTextures;
        hasTextureCoords = hasTextureCoords || m.hasTextureCoords;
        hasMayaGroups = hasMayaGroups || m.hasMayaGroups;
        hasVertexSkins = hasVertexSkins || m.hasVertexSkins;
    }

    // Reset output buffers.
    out->verticesX.clear();
    out->verticesY.clear();
    out->verticesZ.clear();
    out->contourVerticesY.clear();
    out->vertexSkins.clear();
    out->indices1.clear();
    out->indices2.clear();
    out->indices3.clear();
    out->faceColors.clear();
    out->faceRenderTypes.clear();
    out->faceRenderPriorities.clear();
    out->faceAlphas.clear();
    out->faceSkins.clear();
    out->faceTextures.clear();
    out->textureCoords.clear();
    out->textureRenderTypes.clear();
    out->textureMappingP.clear();
    out->textureMappingM.clear();
    out->textureMappingN.clear();
    out->textureScaleX.clear();
    out->textureScaleY.clear();
    out->textureScaleZ.clear();
    out->textureRotation.clear();
    out->textureDirection.clear();
    out->textureSpeed.clear();
    out->textureTransU.clear();
    out->textureTransV.clear();
    out->animMayaGroups.clear();
    out->animMayaScales.clear();

    // Reserve (size stays 0; we track used counts like TS does via verticesCount/faceCount).
    if (totalVertices < 0) totalVertices = 0;
    if (totalFaces < 0) totalFaces = 0;
    if (totalTextureFaces < 0) totalTextureFaces = 0;

    auto rr = out->verticesX.reserve(static_cast<std::size_t>(totalVertices));
    if (!rr.isOk()) return rr.status();
    rr = out->verticesY.reserve(static_cast<std::size_t>(totalVertices));
    if (!rr.isOk()) return rr.status();
    rr = out->verticesZ.reserve(static_cast<std::size_t>(totalVertices));
    if (!rr.isOk()) return rr.status();

    // TS always allocates vertexSkins; use the same behavior and fill -1 when absent.
    out->hasVertexSkins = true;
    rr = out->vertexSkins.reserve(static_cast<std::size_t>(totalVertices));
    if (!rr.isOk()) return rr.status();

    rr = out->indices1.reserve(static_cast<std::size_t>(totalFaces));
    if (!rr.isOk()) return rr.status();
    rr = out->indices2.reserve(static_cast<std::size_t>(totalFaces));
    if (!rr.isOk()) return rr.status();
    rr = out->indices3.reserve(static_cast<std::size_t>(totalFaces));
    if (!rr.isOk()) return rr.status();
    rr = out->faceColors.reserve(static_cast<std::size_t>(totalFaces));
    if (!rr.isOk()) return rr.status();

    out->hasFaceRenderTypes = hasRenderTypes;
    if (hasRenderTypes) {
        rr = out->faceRenderTypes.reserve(static_cast<std::size_t>(totalFaces));
        if (!rr.isOk()) return rr.status();
    }

    out->hasFaceRenderPriorities = hasRenderPriorities;
    if (hasRenderPriorities) {
        rr = out->faceRenderPriorities.reserve(static_cast<std::size_t>(totalFaces));
        if (!rr.isOk()) return rr.status();
    }

    out->hasFaceAlphas = hasAlphas;
    if (hasAlphas) {
        rr = out->faceAlphas.reserve(static_cast<std::size_t>(totalFaces));
        if (!rr.isOk()) return rr.status();
    }

    out->hasFaceSkins = hasFaceSkins;
    if (hasFaceSkins) {
        rr = out->faceSkins.reserve(static_cast<std::size_t>(totalFaces));
        if (!rr.isOk()) return rr.status();
    }

    out->hasFaceTextures = hasTextures;
    if (hasTextures) {
        rr = out->faceTextures.reserve(static_cast<std::size_t>(totalFaces));
        if (!rr.isOk()) return rr.status();
    }

    out->hasTextureCoords = hasTextureCoords;
    if (hasTextureCoords) {
        rr = out->textureCoords.reserve(static_cast<std::size_t>(totalFaces));
        if (!rr.isOk()) return rr.status();
    }

    out->hasMayaGroups = hasMayaGroups;
    if (hasMayaGroups) {
        // We'll append groups per newly-created vertex in copyVertex.
        rr = out->animMayaGroups.reserve(static_cast<std::size_t>(totalVertices));
        if (!rr.isOk()) return rr.status();
        rr = out->animMayaScales.reserve(static_cast<std::size_t>(totalVertices));
        if (!rr.isOk()) return rr.status();
    }

    if (totalTextureFaces > 0) {
        rr = out->textureRenderTypes.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureMappingP.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureMappingM.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureMappingN.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureScaleX.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureScaleY.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureScaleZ.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureRotation.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureDirection.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureSpeed.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureTransU.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
        rr = out->textureTransV.reserve(static_cast<std::size_t>(totalTextureFaces));
        if (!rr.isOk()) return rr.status();
    }

    auto copyVertex = [&](const ModelData& model, i32 index, i32* outIndex) noexcept -> Status {
        if (!outIndex) return Status::InvalidArgument;
        *outIndex = -1;
        if (index < 0) return Status::BadFormat;
        const std::size_t si = static_cast<std::size_t>(index);
        if (si >= model.verticesX.size() || si >= model.verticesY.size() || si >= model.verticesZ.size()) {
            return Status::OutOfRange;
        }
        const i32 x = model.verticesX[si];
        const i32 y = model.verticesY[si];
        const i32 z = model.verticesZ[si];

        for (i32 vi = 0; vi < out->verticesCount; vi++) {
            const std::size_t svi = static_cast<std::size_t>(vi);
            if (svi < out->verticesX.size() &&
                svi < out->verticesY.size() &&
                svi < out->verticesZ.size() &&
                out->verticesX[svi] == x &&
                out->verticesY[svi] == y &&
                out->verticesZ[svi] == z) {
                *outIndex = vi;
                return Status::Ok;
            }
        }

        // New vertex.
        auto r0 = out->verticesX.pushBack(x);
        if (!r0.isOk()) return r0.status();
        r0 = out->verticesY.pushBack(y);
        if (!r0.isOk()) return r0.status();
        r0 = out->verticesZ.pushBack(z);
        if (!r0.isOk()) return r0.status();

        i32 skin = -1;
        if (hasVertexSkins && model.hasVertexSkins && si < model.vertexSkins.size()) {
            skin = model.vertexSkins[si];
        }
        r0 = out->vertexSkins.pushBack(skin);
        if (!r0.isOk()) return r0.status();

        if (out->hasMayaGroups) {
            Vec<i32> g(alloc);
            Vec<i32> s(alloc);
            if (model.hasMayaGroups &&
                si < model.animMayaGroups.size() &&
                si < model.animMayaScales.size()) {
                // Deep-copy group arrays.
                const Vec<i32>& mg = model.animMayaGroups[si];
                const Vec<i32>& ms = model.animMayaScales[si];
                auto rg = g.resize(mg.size());
                if (!rg.isOk()) return rg.status();
                auto rs_ = s.resize(ms.size());
                if (!rs_.isOk()) return rs_.status();
                for (std::size_t gi = 0; gi < mg.size(); gi++) g[gi] = mg[gi];
                for (std::size_t gi = 0; gi < ms.size(); gi++) s[gi] = ms[gi];
            }
            auto rg2 = out->animMayaGroups.pushBack(rs::move(g));
            if (!rg2.isOk()) return rg2.status();
            auto rs2 = out->animMayaScales.pushBack(rs::move(s));
            if (!rs2.isOk()) return rs2.status();
        }

        *outIndex = out->verticesCount;
        out->verticesCount++;
        return Status::Ok;
    };

    // Merge faces and texture faces.
    for (i32 mi = 0; mi < count; mi++) {
        const ModelData& model = models[static_cast<std::size_t>(mi)];

        for (i32 f = 0; f < model.faceCount; f++) {
            const std::size_t sf = static_cast<std::size_t>(f);

            if (hasRenderTypes) {
                i8 v = 0;
                if (model.hasFaceRenderTypes && sf < model.faceRenderTypes.size()) {
                    v = model.faceRenderTypes[sf];
                }
                auto r = out->faceRenderTypes.pushBack(v);
                if (!r.isOk()) return r.status();
            }

            if (hasRenderPriorities) {
                i8 v = static_cast<i8>(model.priority);
                if (model.hasFaceRenderPriorities && sf < model.faceRenderPriorities.size()) {
                    v = model.faceRenderPriorities[sf];
                }
                auto r = out->faceRenderPriorities.pushBack(v);
                if (!r.isOk()) return r.status();
            }

            if (hasAlphas) {
                i8 v = 0;
                if (model.hasFaceAlphas && sf < model.faceAlphas.size()) {
                    v = model.faceAlphas[sf];
                }
                auto r = out->faceAlphas.pushBack(v);
                if (!r.isOk()) return r.status();
            }

            if (hasFaceSkins) {
                i32 v = -1;
                if (model.hasFaceSkins && sf < model.faceSkins.size()) {
                    v = model.faceSkins[sf];
                }
                auto r = out->faceSkins.pushBack(v);
                if (!r.isOk()) return r.status();
            }

            if (hasTextures) {
                i16 v = static_cast<i16>(-1);
                if (model.hasFaceTextures && sf < model.faceTextures.size()) {
                    v = model.faceTextures[sf];
                }
                auto r = out->faceTextures.pushBack(v);
                if (!r.isOk()) return r.status();
            }

            if (hasTextureCoords) {
                i8 v = static_cast<i8>(-1);
                if (model.hasTextureCoords && sf < model.textureCoords.size()) {
                    const i8 raw = model.textureCoords[sf];
                    if (raw != static_cast<i8>(-1)) {
                        const i32 mapped = out->textureFaceCount + static_cast<i32>(raw);
                        v = static_cast<i8>(mapped);
                    }
                }
                auto r = out->textureCoords.pushBack(v);
                if (!r.isOk()) return r.status();
            }

            u16 color = 0;
            if (sf < model.faceColors.size()) {
                color = model.faceColors[sf];
            }
            auto rc = out->faceColors.pushBack(color);
            if (!rc.isOk()) return rc.status();

            if (sf >= model.indices1.size() || sf >= model.indices2.size() || sf >= model.indices3.size()) {
                return Status::OutOfRange;
            }
            i32 ia = -1;
            i32 ib = -1;
            i32 ic = -1;
            Status cs = copyVertex(model, model.indices1[sf], &ia);
            if (!ok(cs)) return cs;
            cs = copyVertex(model, model.indices2[sf], &ib);
            if (!ok(cs)) return cs;
            cs = copyVertex(model, model.indices3[sf], &ic);
            if (!ok(cs)) return cs;

            auto r1 = out->indices1.pushBack(ia);
            if (!r1.isOk()) return r1.status();
            r1 = out->indices2.pushBack(ib);
            if (!r1.isOk()) return r1.status();
            r1 = out->indices3.pushBack(ic);
            if (!r1.isOk()) return r1.status();

            out->faceCount++;
        }

        for (i32 f = 0; f < model.textureFaceCount; f++) {
            const std::size_t sf = static_cast<std::size_t>(f);
            if (sf >= model.textureRenderTypes.size() ||
                sf >= model.textureMappingP.size() ||
                sf >= model.textureMappingM.size() ||
                sf >= model.textureMappingN.size()) {
                return Status::OutOfRange;
            }
            const i8 type = model.textureRenderTypes[sf];

            auto r = out->textureRenderTypes.pushBack(type);
            if (!r.isOk()) return r.status();

            i16 p = 0;
            i16 m = 0;
            i16 n = 0;
            if (type == 0) {
                i32 op = -1;
                i32 om = -1;
                i32 on = -1;
                Status cs = copyVertex(model, static_cast<i32>(model.textureMappingP[sf]), &op);
                if (!ok(cs)) return cs;
                cs = copyVertex(model, static_cast<i32>(model.textureMappingM[sf]), &om);
                if (!ok(cs)) return cs;
                cs = copyVertex(model, static_cast<i32>(model.textureMappingN[sf]), &on);
                if (!ok(cs)) return cs;
                p = static_cast<i16>(op);
                m = static_cast<i16>(om);
                n = static_cast<i16>(on);
            } else if (type >= 1 && type <= 3) {
                p = model.textureMappingP[sf];
                m = model.textureMappingM[sf];
                n = model.textureMappingN[sf];
            }

            r = out->textureMappingP.pushBack(p);
            if (!r.isOk()) return r.status();
            r = out->textureMappingM.pushBack(m);
            if (!r.isOk()) return r.status();
            r = out->textureMappingN.pushBack(n);
            if (!r.isOk()) return r.status();

            i32 scaleX = 0;
            i32 scaleY = 0;
            i32 scaleZ = 0;
            i8 rot = 0;
            i8 dir = 0;
            i32 speed = 0;
            i32 transU = 0;
            i32 transV = 0;
            if (type >= 1 && type <= 3) {
                if (sf >= model.textureScaleX.size() ||
                    sf >= model.textureScaleY.size() ||
                    sf >= model.textureScaleZ.size() ||
                    sf >= model.textureRotation.size() ||
                    sf >= model.textureDirection.size() ||
                    sf >= model.textureSpeed.size()) {
                    return Status::OutOfRange;
                }
                scaleX = model.textureScaleX[sf];
                scaleY = model.textureScaleY[sf];
                scaleZ = model.textureScaleZ[sf];
                rot = model.textureRotation[sf];
                dir = model.textureDirection[sf];
                speed = model.textureSpeed[sf];
            }
            if (type == 2) {
                if (sf >= model.textureTransU.size() || sf >= model.textureTransV.size()) {
                    return Status::OutOfRange;
                }
                transU = model.textureTransU[sf];
                transV = model.textureTransV[sf];
            }

            r = out->textureScaleX.pushBack(scaleX);
            if (!r.isOk()) return r.status();
            r = out->textureScaleY.pushBack(scaleY);
            if (!r.isOk()) return r.status();
            r = out->textureScaleZ.pushBack(scaleZ);
            if (!r.isOk()) return r.status();
            r = out->textureRotation.pushBack(rot);
            if (!r.isOk()) return r.status();
            r = out->textureDirection.pushBack(dir);
            if (!r.isOk()) return r.status();
            r = out->textureSpeed.pushBack(speed);
            if (!r.isOk()) return r.status();
            r = out->textureTransU.pushBack(transU);
            if (!r.isOk()) return r.status();
            r = out->textureTransV.pushBack(transV);
            if (!r.isOk()) return r.status();

            out->textureFaceCount++;
        }
    }

    // TS: usedVertexCount follows the final deduped vertex count.
    out->usedVertexCount = out->verticesCount;
    // TS: vertex arrays were allocated to the sum of input verticesCount, and trailing entries are 0.
    out->tsVerticesAllocCount = totalVertices;
    (void)alloc;
    return Status::Ok;
}

} // namespace rs
