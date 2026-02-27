#pragma once

#include <cstring>

#include "../cache/format/Archive.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"
#include "../util/StringHash.hpp"
#include "ModelData.hpp"

namespace rs {

struct LegacyModelMetadata final {
    i32 vertexCount = 0;
    i32 triangleCount = 0;
    i32 texturedTriangleCount = 0;
    i32 vertexFlagsOffset = 0;
    i32 vertexXOffset = 0;
    i32 vertexYOffset = 0;
    i32 vertexZOffset = 0;
    i32 faceVerticesOffset = 0;
    i32 faceOrientationsOffset = 0;
    i32 faceColorsOffset = 0;
    i32 faceInfosOffset = 0;
    i32 facePrioritiesOffset = 0;
    i32 faceAlphasOffset = 0;
    i32 faceLabelsOffset = 0;
    i32 vertexLabelsOffset = 0;
    i32 faceTextureAxisOffset = 0;
};

class LegacyModelLoader final {
public:
    LegacyModelLoader() noexcept
        : alloc_(&defaultAllocator()),
          metadatas_(defaultAllocator()),
          hasMetadata_(defaultAllocator()),
          face1Bytes_(defaultAllocator()),
          face2Bytes_(defaultAllocator()),
          face3Bytes_(defaultAllocator()),
          face4Bytes_(defaultAllocator()),
          face5Bytes_(defaultAllocator()),
          point1Bytes_(defaultAllocator()),
          point2Bytes_(defaultAllocator()),
          point3Bytes_(defaultAllocator()),
          point4Bytes_(defaultAllocator()),
          point5Bytes_(defaultAllocator()),
          vertex1Bytes_(defaultAllocator()),
          vertex2Bytes_(defaultAllocator()),
          axisBytes_(defaultAllocator()),
          errorStatusById_(defaultAllocator()),
          hasErrorById_(defaultAllocator()) {}

    [[nodiscard]] i32 getCount() const noexcept { return count_; }

    static Result<LegacyModelLoader> create(const Archive& archive, Allocator& alloc = defaultAllocator()) noexcept {
        LegacyModelLoader out;
        out.alloc_ = &alloc;
        out.metadatas_ = Vec<LegacyModelMetadata>(alloc);
        out.hasMetadata_ = Vec<u8>(alloc);
        out.face1Bytes_ = Vec<u8>(alloc);
        out.face2Bytes_ = Vec<u8>(alloc);
        out.face3Bytes_ = Vec<u8>(alloc);
        out.face4Bytes_ = Vec<u8>(alloc);
        out.face5Bytes_ = Vec<u8>(alloc);
        out.point1Bytes_ = Vec<u8>(alloc);
        out.point2Bytes_ = Vec<u8>(alloc);
        out.point3Bytes_ = Vec<u8>(alloc);
        out.point4Bytes_ = Vec<u8>(alloc);
        out.point5Bytes_ = Vec<u8>(alloc);
        out.vertex1Bytes_ = Vec<u8>(alloc);
        out.vertex2Bytes_ = Vec<u8>(alloc);
        out.axisBytes_ = Vec<u8>(alloc);
        out.errorStatusById_ = Vec<Status>(alloc);
        out.hasErrorById_ = Vec<u8>(alloc);

        Vec<u8> headBytes(alloc);
        Status s = copyNamedFile(archive, "ob_head.dat", &headBytes);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_face1.dat", &out.face1Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_face2.dat", &out.face2Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_face3.dat", &out.face3Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_face4.dat", &out.face4Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_face5.dat", &out.face5Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_point1.dat", &out.point1Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_point2.dat", &out.point2Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_point3.dat", &out.point3Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_point4.dat", &out.point4Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_point5.dat", &out.point5Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_vertex1.dat", &out.vertex1Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_vertex2.dat", &out.vertex2Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copyNamedFile(archive, "ob_axis.dat", &out.axisBytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);

        Uint8ArrayReader head(Span<const u8>(headBytes.data(), headBytes.size()), 0);
        u16 countU16 = 0;
        s = head.readUnsignedShort(&countU16);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        out.count_ = static_cast<i32>(countU16);

        const std::size_t metadataCap = static_cast<std::size_t>(out.count_ + 100);
        auto rr = out.metadatas_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        rr = out.hasMetadata_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        for (std::size_t i = 0; i < metadataCap; i++) {
            out.hasMetadata_[i] = 0;
            out.metadatas_[i] = LegacyModelMetadata{};
        }
        rr = out.errorStatusById_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        rr = out.hasErrorById_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        for (std::size_t i = 0; i < metadataCap; i++) {
            out.errorStatusById_[i] = Status::NotFound;
            out.hasErrorById_[i] = 0;
        }

        Uint8ArrayReader point1(Span<const u8>(out.point1Bytes_.data(), out.point1Bytes_.size()), 0);
        Uint8ArrayReader point2(Span<const u8>(out.point2Bytes_.data(), out.point2Bytes_.size()), 0);
        Uint8ArrayReader point3(Span<const u8>(out.point3Bytes_.data(), out.point3Bytes_.size()), 0);
        Uint8ArrayReader point4(Span<const u8>(out.point4Bytes_.data(), out.point4Bytes_.size()), 0);
        Uint8ArrayReader vertex1(Span<const u8>(out.vertex1Bytes_.data(), out.vertex1Bytes_.size()), 0);
        Uint8ArrayReader vertex2(Span<const u8>(out.vertex2Bytes_.data(), out.vertex2Bytes_.size()), 0);

        i32 vertexTextureDataOffset = 0;
        i32 labelDataOffset = 0;
        i32 triangleColorDataOffset = 0;
        i32 triangleInfoDataOffset = 0;
        i32 trianglePriorityDataOffset = 0;
        i32 triangleAlphaDataOffset = 0;
        i32 triangleSkinDataOffset = 0;

        for (i32 i = 0; i < out.count_; i++) {
            u16 indexU16 = 0;
            s = head.readUnsignedShort(&indexU16);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            const i32 index = static_cast<i32>(indexU16);
            if (index < 0) return Result<LegacyModelLoader>::err(Status::BadFormat);

            if (static_cast<std::size_t>(index) >= out.metadatas_.size()) {
                const std::size_t nextSize = static_cast<std::size_t>(index + 1);
                rr = out.metadatas_.resize(nextSize);
                if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
                rr = out.hasMetadata_.resize(nextSize);
                if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
                rr = out.errorStatusById_.resize(nextSize);
                if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
                rr = out.hasErrorById_.resize(nextSize);
                if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
                for (std::size_t j = metadataCap; j < nextSize; j++) {
                    out.hasMetadata_[j] = 0;
                    out.errorStatusById_[j] = Status::NotFound;
                    out.hasErrorById_[j] = 0;
                }
            }

            LegacyModelMetadata& meta = out.metadatas_[static_cast<std::size_t>(index)];
            out.hasMetadata_[static_cast<std::size_t>(index)] = 1;

            u16 vertexCountMeta = 0;
            u16 triangleCountMeta = 0;
            u8 texturedTriangleCountMeta = 0;
            s = head.readUnsignedShort(&vertexCountMeta);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedShort(&triangleCountMeta);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&texturedTriangleCountMeta);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            meta.vertexCount = static_cast<i32>(vertexCountMeta);
            meta.triangleCount = static_cast<i32>(triangleCountMeta);
            meta.texturedTriangleCount = static_cast<i32>(texturedTriangleCountMeta);
            meta.vertexFlagsOffset = static_cast<i32>(point1.tell());
            meta.vertexXOffset = static_cast<i32>(point2.tell());
            meta.vertexYOffset = static_cast<i32>(point3.tell());
            meta.vertexZOffset = static_cast<i32>(point4.tell());
            meta.faceVerticesOffset = static_cast<i32>(vertex1.tell());
            meta.faceOrientationsOffset = static_cast<i32>(vertex2.tell());

            u8 hasInfo = 0;
            u8 hasPriorities = 0;
            u8 hasAlpha = 0;
            u8 hasSkins = 0;
            u8 hasLabels = 0;
            s = head.readUnsignedByte(&hasInfo);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasPriorities);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasAlpha);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasSkins);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasLabels);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);

            for (i32 v = 0; v < meta.vertexCount; v++) {
                u8 flagsByte = 0;
                s = point1.readUnsignedByte(&flagsByte);
                if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                i32 tmp = 0;
                if ((flagsByte & 0x1) != 0) {
                    s = point2.readSmart2(&tmp);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
                if ((flagsByte & 0x2) != 0) {
                    s = point3.readSmart2(&tmp);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
                if ((flagsByte & 0x4) != 0) {
                    s = point4.readSmart2(&tmp);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
            }

            for (i32 t = 0; t < meta.triangleCount; t++) {
                u8 type = 0;
                s = vertex2.readUnsignedByte(&type);
                if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                i32 tmp = 0;
                if (type == 1) {
                    s = vertex1.readSmart2(&tmp);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                    s = vertex1.readSmart2(&tmp);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
                s = vertex1.readSmart2(&tmp);
                if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            }

            meta.faceColorsOffset = triangleColorDataOffset;
            triangleColorDataOffset += meta.triangleCount * 2;

            if (hasInfo == 1) {
                meta.faceInfosOffset = triangleInfoDataOffset;
                triangleInfoDataOffset += meta.triangleCount;
            } else {
                meta.faceInfosOffset = -1;
            }

            if (hasPriorities == 255) {
                meta.facePrioritiesOffset = trianglePriorityDataOffset;
                trianglePriorityDataOffset += meta.triangleCount;
            } else {
                meta.facePrioritiesOffset = -static_cast<i32>(hasPriorities) - 1;
            }

            if (hasAlpha == 1) {
                meta.faceAlphasOffset = triangleAlphaDataOffset;
                triangleAlphaDataOffset += meta.triangleCount;
            } else {
                meta.faceAlphasOffset = -1;
            }

            if (hasSkins == 1) {
                meta.faceLabelsOffset = triangleSkinDataOffset;
                triangleSkinDataOffset += meta.triangleCount;
            } else {
                meta.faceLabelsOffset = -1;
            }

            if (hasLabels == 1) {
                meta.vertexLabelsOffset = labelDataOffset;
                labelDataOffset += meta.vertexCount;
            } else {
                meta.vertexLabelsOffset = -1;
            }

            meta.faceTextureAxisOffset = vertexTextureDataOffset;
            vertexTextureDataOffset += meta.texturedTriangleCount;
        }

        return Result<LegacyModelLoader>::ok(rs::move(out));
    }

    static Result<LegacyModelLoader> createFromBytes(
        Span<const u8> headBytes,
        Span<const u8> face1Bytes,
        Span<const u8> face2Bytes,
        Span<const u8> face3Bytes,
        Span<const u8> face4Bytes,
        Span<const u8> face5Bytes,
        Span<const u8> point1Bytes,
        Span<const u8> point2Bytes,
        Span<const u8> point3Bytes,
        Span<const u8> point4Bytes,
        Span<const u8> point5Bytes,
        Span<const u8> vertex1Bytes,
        Span<const u8> vertex2Bytes,
        Span<const u8> axisBytes,
        Allocator& alloc = defaultAllocator()) noexcept {
        LegacyModelLoader out;
        out.alloc_ = &alloc;
        out.metadatas_ = Vec<LegacyModelMetadata>(alloc);
        out.hasMetadata_ = Vec<u8>(alloc);
        out.face1Bytes_ = Vec<u8>(alloc);
        out.face2Bytes_ = Vec<u8>(alloc);
        out.face3Bytes_ = Vec<u8>(alloc);
        out.face4Bytes_ = Vec<u8>(alloc);
        out.face5Bytes_ = Vec<u8>(alloc);
        out.point1Bytes_ = Vec<u8>(alloc);
        out.point2Bytes_ = Vec<u8>(alloc);
        out.point3Bytes_ = Vec<u8>(alloc);
        out.point4Bytes_ = Vec<u8>(alloc);
        out.point5Bytes_ = Vec<u8>(alloc);
        out.vertex1Bytes_ = Vec<u8>(alloc);
        out.vertex2Bytes_ = Vec<u8>(alloc);
        out.axisBytes_ = Vec<u8>(alloc);
        out.errorStatusById_ = Vec<Status>(alloc);
        out.hasErrorById_ = Vec<u8>(alloc);

        auto copy = [&](Span<const u8> src, Vec<u8>* dst) noexcept -> Status {
            if (!dst) return Status::InvalidArgument;
            auto rr = dst->resize(src.size());
            if (!rr.isOk()) return rr.status();
            if (!src.empty()) {
                std::memcpy(dst->data(), src.data(), src.size());
            }
            return Status::Ok;
        };

        Status s = copy(face1Bytes, &out.face1Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(face2Bytes, &out.face2Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(face3Bytes, &out.face3Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(face4Bytes, &out.face4Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(face5Bytes, &out.face5Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(point1Bytes, &out.point1Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(point2Bytes, &out.point2Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(point3Bytes, &out.point3Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(point4Bytes, &out.point4Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(point5Bytes, &out.point5Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(vertex1Bytes, &out.vertex1Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(vertex2Bytes, &out.vertex2Bytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        s = copy(axisBytes, &out.axisBytes_);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);

        Uint8ArrayReader head(headBytes, 0);
        u16 countU16 = 0;
        s = head.readUnsignedShort(&countU16);
        if (!ok(s)) return Result<LegacyModelLoader>::err(s);
        out.count_ = static_cast<i32>(countU16);

        const std::size_t metadataCap = static_cast<std::size_t>(out.count_ + 100);
        auto rr = out.metadatas_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        rr = out.hasMetadata_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        rr = out.errorStatusById_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        rr = out.hasErrorById_.resize(metadataCap);
        if (!rr.isOk()) return Result<LegacyModelLoader>::err(rr.status());
        for (std::size_t i = 0; i < metadataCap; i++) {
            out.hasMetadata_[i] = 0;
            out.hasErrorById_[i] = 0;
            out.errorStatusById_[i] = Status::NotFound;
        }

        // Decode metadata using local cursors (mirrors TS LegacyModelLoader metadata scan).
        Uint8ArrayReader point1(Span<const u8>(out.point1Bytes_.data(), out.point1Bytes_.size()), 0);
        Uint8ArrayReader point2(Span<const u8>(out.point2Bytes_.data(), out.point2Bytes_.size()), 0);
        Uint8ArrayReader point3(Span<const u8>(out.point3Bytes_.data(), out.point3Bytes_.size()), 0);
        Uint8ArrayReader point4(Span<const u8>(out.point4Bytes_.data(), out.point4Bytes_.size()), 0);
        Uint8ArrayReader vertex1(Span<const u8>(out.vertex1Bytes_.data(), out.vertex1Bytes_.size()), 0);
        Uint8ArrayReader vertex2(Span<const u8>(out.vertex2Bytes_.data(), out.vertex2Bytes_.size()), 0);

        i32 vertexTextureDataOffset = 0;
        i32 labelDataOffset = 0;
        i32 triangleColorDataOffset = 0;
        i32 triangleInfoDataOffset = 0;
        i32 trianglePriorityDataOffset = 0;
        i32 triangleAlphaDataOffset = 0;
        i32 triangleSkinDataOffset = 0;

        for (i32 i = 0; i < out.count_; i++) {
            u16 indexU16 = 0;
            u16 vertexCountU16 = 0;
            u16 triangleCountU16 = 0;
            u8 texturedTriangleCountU8 = 0;
            u8 hasInfo = 0;
            u8 hasPriorities = 0;
            u8 hasAlpha = 0;
            u8 hasSkins = 0;
            u8 hasLabels = 0;

            s = head.readUnsignedShort(&indexU16);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedShort(&vertexCountU16);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedShort(&triangleCountU16);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&texturedTriangleCountU8);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);

            const std::size_t index = static_cast<std::size_t>(indexU16);
            if (index >= out.metadatas_.size()) {
                return Result<LegacyModelLoader>::err(Status::BadFormat);
            }
            LegacyModelMetadata meta{};
            meta.vertexCount = static_cast<i32>(vertexCountU16);
            meta.triangleCount = static_cast<i32>(triangleCountU16);
            meta.texturedTriangleCount = static_cast<i32>(texturedTriangleCountU8);
            meta.vertexFlagsOffset = static_cast<i32>(point1.tell());
            meta.vertexXOffset = static_cast<i32>(point2.tell());
            meta.vertexYOffset = static_cast<i32>(point3.tell());
            meta.vertexZOffset = static_cast<i32>(point4.tell());
            meta.faceVerticesOffset = static_cast<i32>(vertex1.tell());
            meta.faceOrientationsOffset = static_cast<i32>(vertex2.tell());

            s = head.readUnsignedByte(&hasInfo);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasPriorities);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasAlpha);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasSkins);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            s = head.readUnsignedByte(&hasLabels);
            if (!ok(s)) return Result<LegacyModelLoader>::err(s);

            // Skip vertex coordinate streams by flags (smart2).
            for (i32 v = 0; v < meta.vertexCount; v++) {
                u8 flags = 0;
                s = point1.readUnsignedByte(&flags);
                if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                if ((flags & 0x1) != 0) {
                    i32 ignored = 0;
                    s = point2.readSmart2(&ignored);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
                if ((flags & 0x2) != 0) {
                    i32 ignored = 0;
                    s = point3.readSmart2(&ignored);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
                if ((flags & 0x4) != 0) {
                    i32 ignored = 0;
                    s = point4.readSmart2(&ignored);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
            }

            // Skip face vertex indices streams.
            for (i32 t = 0; t < meta.triangleCount; t++) {
                u8 type = 0;
                s = vertex2.readUnsignedByte(&type);
                if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                if (type == 1) {
                    i32 ignored = 0;
                    s = vertex1.readSmart2(&ignored);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                    s = vertex1.readSmart2(&ignored);
                    if (!ok(s)) return Result<LegacyModelLoader>::err(s);
                }
                i32 ignored = 0;
                s = vertex1.readSmart2(&ignored);
                if (!ok(s)) return Result<LegacyModelLoader>::err(s);
            }

            meta.faceColorsOffset = triangleColorDataOffset;
            triangleColorDataOffset += meta.triangleCount * 2;
            if (hasInfo == 1) {
                meta.faceInfosOffset = triangleInfoDataOffset;
                triangleInfoDataOffset += meta.triangleCount;
            } else {
                meta.faceInfosOffset = -1;
            }
            if (hasPriorities == 255) {
                meta.facePrioritiesOffset = trianglePriorityDataOffset;
                trianglePriorityDataOffset += meta.triangleCount;
            } else {
                meta.facePrioritiesOffset = -static_cast<i32>(hasPriorities) - 1;
            }
            if (hasAlpha == 1) {
                meta.faceAlphasOffset = triangleAlphaDataOffset;
                triangleAlphaDataOffset += meta.triangleCount;
            } else {
                meta.faceAlphasOffset = -1;
            }
            if (hasSkins == 1) {
                meta.faceLabelsOffset = triangleSkinDataOffset;
                triangleSkinDataOffset += meta.triangleCount;
            } else {
                meta.faceLabelsOffset = -1;
            }
            if (hasLabels == 1) {
                meta.vertexLabelsOffset = labelDataOffset;
                labelDataOffset += meta.vertexCount;
            } else {
                meta.vertexLabelsOffset = -1;
            }
            meta.faceTextureAxisOffset = vertexTextureDataOffset;
            vertexTextureDataOffset += meta.texturedTriangleCount;

            out.metadatas_[index] = meta;
            out.hasMetadata_[index] = 1;
        }

        return Result<LegacyModelLoader>::ok(rs::move(out));
    }

    Status tryLoad(i32 id, ModelData* out) const noexcept {
        if (!out) return Status::InvalidArgument;
        if (id < 0) return Status::OutOfRange;

        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx < hasErrorById_.size() && hasErrorById_[idx] != 0) {
            return errorStatusById_[idx];
        }

        if (idx >= hasMetadata_.size() || hasMetadata_[idx] == 0) {
            if (idx < hasErrorById_.size()) {
                hasErrorById_[idx] = 1;
                errorStatusById_[idx] = Status::NotFound;
            }
            return Status::NotFound;
        }

        ModelData decoded(modelAllocator(out));
        const Status s = decodeLegacyModel(metadatas_[idx], &decoded);
        if (!ok(s)) {
            if (idx < hasErrorById_.size()) {
                hasErrorById_[idx] = 1;
                errorStatusById_[idx] = s;
            }
            return s;
        }

        *out = rs::move(decoded);
        return Status::Ok;
    }

    Status tryGet(i32 id, ModelData* out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {
        for (std::size_t i = 0; i < hasErrorById_.size(); i++) {
            hasErrorById_[i] = 0;
            errorStatusById_[i] = Status::NotFound;
        }
    }

private:
    static Status copyNamedFile(const Archive& archive, const char* name, Vec<u8>* out) noexcept {
        if (!name || !out) return Status::InvalidArgument;
        const ArchiveFile* f = archive.getFileByNameHash(hashOld(name));
        if (!f) return Status::NotFound;

        auto rr = out->resize(f->data.size());
        if (!rr.isOk()) return rr.status();
        if (f->data.size() > 0) {
            std::memcpy(out->data(), f->data.data(), f->data.size());
        }
        return Status::Ok;
    }

    Status decodeLegacyModel(const LegacyModelMetadata& meta, ModelData* out) const noexcept {
        if (!out) return Status::InvalidArgument;

        bool hasRenderType = false;
        bool isTextured = false;

        Status s = initModelCoreArrays(out, meta.vertexCount, meta.triangleCount);
        if (!ok(s)) return s;
        out->textureFaceCount = meta.texturedTriangleCount;
        out->usedVertexCount = -1;
        out->version = -1;

        if (out->textureFaceCount > 0) {
            s = initRequiredVec(&out->textureRenderTypes, static_cast<std::size_t>(out->textureFaceCount));
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureMappingP, static_cast<std::size_t>(out->textureFaceCount));
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureMappingM, static_cast<std::size_t>(out->textureFaceCount));
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureMappingN, static_cast<std::size_t>(out->textureFaceCount));
            if (!ok(s)) return s;
        } else {
            clearVec(&out->textureRenderTypes);
            clearVec(&out->textureMappingP);
            clearVec(&out->textureMappingM);
            clearVec(&out->textureMappingN);
        }
        clearVec(&out->textureScaleX);
        clearVec(&out->textureScaleY);
        clearVec(&out->textureScaleZ);
        clearVec(&out->textureRotation);
        clearVec(&out->textureDirection);
        clearVec(&out->textureSpeed);
        clearVec(&out->textureTransU);
        clearVec(&out->textureTransV);

        s = initOptionalVec(meta.vertexLabelsOffset >= 0, &out->vertexSkins, static_cast<std::size_t>(out->verticesCount), &out->hasVertexSkins);
        if (!ok(s)) return s;
        s = initOptionalVec(meta.faceInfosOffset >= 0, &out->faceRenderTypes, static_cast<std::size_t>(out->faceCount), &out->hasFaceRenderTypes);
        if (!ok(s)) return s;
        s = initOptionalVec(meta.faceInfosOffset >= 0, &out->textureCoords, static_cast<std::size_t>(out->faceCount), &out->hasTextureCoords);
        if (!ok(s)) return s;
        s = initOptionalVec(meta.faceInfosOffset >= 0, &out->faceTextures, static_cast<std::size_t>(out->faceCount), &out->hasFaceTextures);
        if (!ok(s)) return s;
        s = initOptionalVec(meta.facePrioritiesOffset >= 0, &out->faceRenderPriorities, static_cast<std::size_t>(out->faceCount), &out->hasFaceRenderPriorities);
        if (!ok(s)) return s;
        s = initOptionalVec(meta.faceAlphasOffset >= 0, &out->faceAlphas, static_cast<std::size_t>(out->faceCount), &out->hasFaceAlphas);
        if (!ok(s)) return s;
        s = initOptionalVec(meta.faceLabelsOffset >= 0, &out->faceSkins, static_cast<std::size_t>(out->faceCount), &out->hasFaceSkins);
        if (!ok(s)) return s;
        s = initOptionalNestedIntVec(false, 0, &out->animMayaGroups, &out->animMayaScales, out);
        if (!ok(s)) return s;

        if (meta.facePrioritiesOffset < 0) {
            out->priority = -meta.facePrioritiesOffset - 1;
        }

        Uint8ArrayReader point1(Span<const u8>(point1Bytes_.data(), point1Bytes_.size()), 0);
        Uint8ArrayReader point2(Span<const u8>(point2Bytes_.data(), point2Bytes_.size()), 0);
        Uint8ArrayReader point3(Span<const u8>(point3Bytes_.data(), point3Bytes_.size()), 0);
        Uint8ArrayReader point4(Span<const u8>(point4Bytes_.data(), point4Bytes_.size()), 0);
        Uint8ArrayReader point5(Span<const u8>(point5Bytes_.data(), point5Bytes_.size()), 0);
        Uint8ArrayReader face1(Span<const u8>(face1Bytes_.data(), face1Bytes_.size()), 0);
        Uint8ArrayReader face2(Span<const u8>(face2Bytes_.data(), face2Bytes_.size()), 0);
        Uint8ArrayReader face3(Span<const u8>(face3Bytes_.data(), face3Bytes_.size()), 0);
        Uint8ArrayReader face4(Span<const u8>(face4Bytes_.data(), face4Bytes_.size()), 0);
        Uint8ArrayReader face5(Span<const u8>(face5Bytes_.data(), face5Bytes_.size()), 0);
        Uint8ArrayReader vertex1(Span<const u8>(vertex1Bytes_.data(), vertex1Bytes_.size()), 0);
        Uint8ArrayReader vertex2(Span<const u8>(vertex2Bytes_.data(), vertex2Bytes_.size()), 0);
        Uint8ArrayReader axis(Span<const u8>(axisBytes_.data(), axisBytes_.size()), 0);

        s = point1.seek(static_cast<std::size_t>(meta.vertexFlagsOffset));
        if (!ok(s)) return s;
        s = point2.seek(static_cast<std::size_t>(meta.vertexXOffset));
        if (!ok(s)) return s;
        s = point3.seek(static_cast<std::size_t>(meta.vertexYOffset));
        if (!ok(s)) return s;
        s = point4.seek(static_cast<std::size_t>(meta.vertexZOffset));
        if (!ok(s)) return s;
        if (out->hasVertexSkins) {
            s = point5.seek(static_cast<std::size_t>(meta.vertexLabelsOffset));
            if (!ok(s)) return s;
        }

        i32 lastVertX = 0;
        i32 lastVertY = 0;
        i32 lastVertZ = 0;
        for (i32 i = 0; i < out->verticesCount; i++) {
            u8 flag = 0;
            s = point1.readUnsignedByte(&flag);
            if (!ok(s)) return s;
            i32 dx = 0;
            i32 dy = 0;
            i32 dz = 0;
            if ((flag & 0x1) != 0) {
                s = point2.readSmart2(&dx);
                if (!ok(s)) return s;
            }
            if ((flag & 0x2) != 0) {
                s = point3.readSmart2(&dy);
                if (!ok(s)) return s;
            }
            if ((flag & 0x4) != 0) {
                s = point4.readSmart2(&dz);
                if (!ok(s)) return s;
            }

            const std::size_t vi = static_cast<std::size_t>(i);
            out->verticesX[vi] = lastVertX + dx;
            out->verticesY[vi] = lastVertY + dy;
            out->verticesZ[vi] = lastVertZ + dz;
            lastVertX = out->verticesX[vi];
            lastVertY = out->verticesY[vi];
            lastVertZ = out->verticesZ[vi];
            if (out->hasVertexSkins) {
                u8 skin = 0;
                s = point5.readUnsignedByte(&skin);
                if (!ok(s)) return s;
                out->vertexSkins[vi] = static_cast<i32>(skin);
            }
        }

        s = face1.seek(static_cast<std::size_t>(meta.faceColorsOffset));
        if (!ok(s)) return s;
        if (out->hasFaceRenderTypes && out->hasTextureCoords && out->hasFaceTextures) {
            s = face2.seek(static_cast<std::size_t>(meta.faceInfosOffset));
            if (!ok(s)) return s;
        }
        if (out->hasFaceRenderPriorities) {
            s = face3.seek(static_cast<std::size_t>(meta.facePrioritiesOffset));
            if (!ok(s)) return s;
        }
        if (out->hasFaceAlphas) {
            s = face4.seek(static_cast<std::size_t>(meta.faceAlphasOffset));
            if (!ok(s)) return s;
        }
        if (out->hasFaceSkins) {
            s = face5.seek(static_cast<std::size_t>(meta.faceLabelsOffset));
            if (!ok(s)) return s;
        }

        for (i32 i = 0; i < out->faceCount; i++) {
            const std::size_t fi = static_cast<std::size_t>(i);
            u16 c = 0;
            s = face1.readUnsignedShort(&c);
            if (!ok(s)) return s;
            out->faceColors[fi] = c;

            if (out->hasFaceRenderTypes && out->hasTextureCoords && out->hasFaceTextures) {
                u8 flag = 0;
                s = face2.readUnsignedByte(&flag);
                if (!ok(s)) return s;
                if ((flag & 0x1) == 1) {
                    out->faceRenderTypes[fi] = 1;
                    hasRenderType = true;
                } else {
                    out->faceRenderTypes[fi] = 0;
                }
                if ((flag & 0x2) == 2) {
                    out->textureCoords[fi] = static_cast<i8>(flag >> 2);
                    out->faceTextures[fi] = static_cast<i16>(out->faceColors[fi]);
                    out->faceColors[fi] = 127;
                    if (out->faceTextures[fi] != -1) {
                        isTextured = true;
                    }
                } else {
                    out->textureCoords[fi] = static_cast<i8>(-1);
                    out->faceTextures[fi] = static_cast<i16>(-1);
                }
            }
            if (out->hasFaceRenderPriorities) {
                i8 p = 0;
                s = face3.readByte(&p);
                if (!ok(s)) return s;
                out->faceRenderPriorities[fi] = p;
            }
            if (out->hasFaceAlphas) {
                i8 a = 0;
                s = face4.readByte(&a);
                if (!ok(s)) return s;
                out->faceAlphas[fi] = a;
            }
            if (out->hasFaceSkins) {
                u8 skin = 0;
                s = face5.readUnsignedByte(&skin);
                if (!ok(s)) return s;
                out->faceSkins[fi] = static_cast<i32>(skin);
            }
        }

        s = vertex1.seek(static_cast<std::size_t>(meta.faceVerticesOffset));
        if (!ok(s)) return s;
        s = vertex2.seek(static_cast<std::size_t>(meta.faceOrientationsOffset));
        if (!ok(s)) return s;

        i32 index1 = 0;
        i32 index2 = 0;
        i32 index3 = 0;
        i32 lastIndex = 0;
        out->usedVertexCount = -1;
        for (i32 i = 0; i < out->faceCount; i++) {
            u8 type = 0;
            s = vertex2.readUnsignedByte(&type);
            if (!ok(s)) return s;

            if (type == 1) {
                s = vertex1.readSmart2(&index1);
                if (!ok(s)) return s;
                index1 += lastIndex;
                s = vertex1.readSmart2(&index2);
                if (!ok(s)) return s;
                index2 += index1;
                s = vertex1.readSmart2(&index3);
                if (!ok(s)) return s;
                index3 += index2;
                lastIndex = index3;
            } else if (type == 2) {
                index2 = index3;
                s = vertex1.readSmart2(&index3);
                if (!ok(s)) return s;
                index3 += lastIndex;
                lastIndex = index3;
            } else if (type == 3) {
                index1 = index3;
                s = vertex1.readSmart2(&index3);
                if (!ok(s)) return s;
                index3 += lastIndex;
                lastIndex = index3;
            } else if (type == 4) {
                const i32 temp = index1;
                index1 = index2;
                index2 = temp;
                s = vertex1.readSmart2(&index3);
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
            if (index1 > out->usedVertexCount) out->usedVertexCount = index1;
            if (index2 > out->usedVertexCount) out->usedVertexCount = index2;
            if (index3 > out->usedVertexCount) out->usedVertexCount = index3;
        }
        out->usedVertexCount++;

        s = axis.seek(static_cast<std::size_t>(meta.faceTextureAxisOffset) * 6u);
        if (!ok(s)) return s;
        for (i32 i = 0; i < out->textureFaceCount; i++) {
            const std::size_t ti = static_cast<std::size_t>(i);
            out->textureRenderTypes[ti] = 0;
            u16 p = 0, m = 0, n = 0;
            s = axis.readUnsignedShort(&p);
            if (!ok(s)) return s;
            s = axis.readUnsignedShort(&m);
            if (!ok(s)) return s;
            s = axis.readUnsignedShort(&n);
            if (!ok(s)) return s;
            out->textureMappingP[ti] = static_cast<i16>(p);
            out->textureMappingM[ti] = static_cast<i16>(m);
            out->textureMappingN[ti] = static_cast<i16>(n);
        }

        cleanupLegacyTextureFlags(out, isTextured, hasRenderType);
        return Status::Ok;
    }

    Allocator* alloc_ = nullptr;
    i32 count_ = 0;

    Vec<LegacyModelMetadata> metadatas_{};
    Vec<u8> hasMetadata_{};

    Vec<u8> face1Bytes_{};
    Vec<u8> face2Bytes_{};
    Vec<u8> face3Bytes_{};
    Vec<u8> face4Bytes_{};
    Vec<u8> face5Bytes_{};
    Vec<u8> point1Bytes_{};
    Vec<u8> point2Bytes_{};
    Vec<u8> point3Bytes_{};
    Vec<u8> point4Bytes_{};
    Vec<u8> point5Bytes_{};
    Vec<u8> vertex1Bytes_{};
    Vec<u8> vertex2Bytes_{};
    Vec<u8> axisBytes_{};

    mutable Vec<Status> errorStatusById_{};
    mutable Vec<u8> hasErrorById_{};
};

} // namespace rs
