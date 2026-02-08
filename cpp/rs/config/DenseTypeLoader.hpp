#pragma once

#include <cstddef>

#include "../cache/CacheIndex.hpp"
#include "../cache/CacheInfo.hpp"
#include "../cache/format/Archive.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/StringArena.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"
#include "TypeDecode.hpp"

namespace rs {

// Dense config/type loader that can decode from either:
// - a single archive where fileId == typeId (Dat2 configs index archive ids)
// - an index where typeId is (archiveId << fileIdBits) | fileId (RS2 "index configs" indices 16+)
//
// Requirements for T:
// - default constructible
// - constructible as `T(i32 id, const CacheInfo& cacheInfo)`
// - method: `Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept`
template <typename T>
class DenseTypeLoader final {
public:
    static Result<DenseTypeLoader> fromArchive(const CacheInfo& cacheInfo, const Archive& archive, Allocator& alloc) noexcept {
        const Span<const ArchiveFile> files = archive.files();
        i32 maxId = -1;
        for (std::size_t i = 0; i < files.size(); i++) {
            const i32 id = files[i].id;
            if (id > maxId) {
                maxId = id;
            }
        }
        const i32 count = (maxId < 0) ? 0 : (maxId + 1);

        Vec<T> types(alloc);
        auto rr = types.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<DenseTypeLoader>::err(rr.status());
        }
        for (i32 i = 0; i < count; i++) {
            types[static_cast<std::size_t>(i)] = T(i, cacheInfo);
        }

        StringArena strings(alloc);
        const TypeDecodeContext ctx{cacheInfo, &strings, &alloc};

        Vec<Status> statusById(alloc);
        rr = statusById.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<DenseTypeLoader>::err(rr.status());
        }
        for (std::size_t i = 0; i < statusById.size(); i++) {
            statusById[i] = Status::NotFound;
        }

        for (std::size_t i = 0; i < files.size(); i++) {
            const ArchiveFile& f = files[i];
            if (f.id < 0) {
                continue;
            }
            const i32 id = f.id;
            if (id >= count) {
                continue;
            }
            Uint8ArrayReader reader(f.data.span(), 0);
            TypeDecodeError err{};
            const Status s = decodeType(types[static_cast<std::size_t>(id)], reader, &err, &ctx);
            statusById[static_cast<std::size_t>(id)] = s;
            if (ok(s)) {
                callPost(types[static_cast<std::size_t>(id)], 0);
            }
        }

        return Result<DenseTypeLoader>::ok(DenseTypeLoader(rs::move(types), rs::move(statusById), rs::move(strings), count));
    }

    static Result<DenseTypeLoader> fromIndex(
        const CacheInfo& cacheInfo,
        const CacheIndex& index,
        i32 fileIdBits,
        Allocator& alloc) noexcept {
        if (fileIdBits <= 0 || fileIdBits >= 31) {
            return Result<DenseTypeLoader>::err(Status::InvalidArgument);
        }

        const i32 filesPerArchive = static_cast<i32>(1u << static_cast<u32>(fileIdBits));
        const i32 lastArchiveId = index.lastArchiveId();
        const i32 count = (lastArchiveId < 0) ? 0 : (lastArchiveId * filesPerArchive + index.fileCount(lastArchiveId));

        Vec<T> types(alloc);
        auto rr = types.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<DenseTypeLoader>::err(rr.status());
        }
        for (i32 i = 0; i < count; i++) {
            types[static_cast<std::size_t>(i)] = T(i, cacheInfo);
        }

        StringArena strings(alloc);
        const TypeDecodeContext ctx{cacheInfo, &strings, &alloc};

        Vec<Status> statusById(alloc);
        rr = statusById.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<DenseTypeLoader>::err(rr.status());
        }
        for (std::size_t i = 0; i < statusById.size(); i++) {
            statusById[i] = Status::NotFound;
        }

        const Span<const i32> archiveIds = index.archiveIds();
        for (std::size_t a = 0; a < archiveIds.size(); a++) {
            const i32 archiveId = archiveIds[a];
            auto archRes = index.getArchive(archiveId, alloc);
            if (!archRes.isOk()) {
                return Result<DenseTypeLoader>::err(archRes.status());
            }
            const Archive archive = rs::move(archRes.value());
            const Span<const ArchiveFile> files = archive.files();

            for (std::size_t i = 0; i < files.size(); i++) {
                const ArchiveFile& f = files[i];
                if (f.id < 0) {
                    continue;
                }
                const i32 id = (archiveId << fileIdBits) | f.id;
                if (id < 0 || id >= count) {
                    continue;
                }
                Uint8ArrayReader reader(f.data.span(), 0);
                TypeDecodeError err{};
                const Status s = decodeType(types[static_cast<std::size_t>(id)], reader, &err, &ctx);
                statusById[static_cast<std::size_t>(id)] = s;
                if (ok(s)) {
                    callPost(types[static_cast<std::size_t>(id)], 0);
                }
            }
        }

        return Result<DenseTypeLoader>::ok(DenseTypeLoader(rs::move(types), rs::move(statusById), rs::move(strings), count));
    }

    DenseTypeLoader() = default;

    [[nodiscard]] i32 count() const noexcept { return count_; }

    Status get(i32 id, const T** out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        if (id < 0) {
            return Status::OutOfRange;
        }
        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= statusById_.size()) {
            *out = nullptr;
            return Status::OutOfRange;
        }
        const Status s = statusById_[idx];
        if (!ok(s)) {
            *out = nullptr;
            return s;
        }
        *out = &types_[idx];
        return Status::Ok;
    }

private:
    template <typename U>
    static auto callPost(U& v, int) noexcept -> decltype(v.post()) {
        v.post();
    }

    template <typename U>
    static void callPost(U&, ...) noexcept {}

    explicit DenseTypeLoader(Vec<T> types, Vec<Status> statusById, StringArena strings, i32 count) noexcept
        : types_(rs::move(types)), statusById_(rs::move(statusById)), strings_(rs::move(strings)), count_(count) {}

    Vec<T> types_;
    Vec<Status> statusById_;
    StringArena strings_{};
    i32 count_ = 0;
};

} // namespace rs

