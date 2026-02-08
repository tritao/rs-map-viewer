#pragma once

#include <cstddef>

#include "../cache/format/Archive.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../cache/CacheInfo.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/StringArena.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"
#include "../util/StringHash.hpp"
#include "TypeDecode.hpp"

namespace rs {

// Loader for indexed legacy dat config files stored in `<name>.dat` + `<name>.idx`:
// idx: [u16 count][u16 len0][u16 len1]...
// dat: [u16 count][entry0 bytes][entry1 bytes]...
template <typename T>
class IndexedDatTypeLoader final {
public:
    static Result<IndexedDatTypeLoader> fromNamedFiles(
        const CacheInfo& cacheInfo,
        const Archive& configArchive,
        const char* name,
        Allocator& alloc) noexcept {
        if (!name) {
            return Result<IndexedDatTypeLoader>::err(Status::InvalidArgument);
        }

        auto getFile = [&](const char* ext) noexcept -> const ArchiveFile* {
            std::size_t nameLen = 0;
            while (name[nameLen] != 0) nameLen++;
            std::size_t extLen = 0;
            while (ext[extLen] != 0) extLen++;
            char buf[64];
            if (nameLen + extLen >= sizeof(buf)) {
                return nullptr;
            }
            for (std::size_t i = 0; i < nameLen; i++) buf[i] = name[i];
            for (std::size_t i = 0; i < extLen; i++) buf[nameLen + i] = ext[i];
            const i32 h = hashOld(buf, nameLen + extLen);
            return configArchive.getFileByNameHash(h);
        };

        const ArchiveFile* datFile = getFile(".dat");
        const ArchiveFile* idxFile = getFile(".idx");
        if (!datFile || !idxFile) {
            return Result<IndexedDatTypeLoader>::err(Status::NotFound);
        }

        const Span<const u8> datBytes(datFile->data.data(), datFile->data.size());
        const Span<const u8> idxBytes(idxFile->data.data(), idxFile->data.size());

        Uint8ArrayReader idxReader(idxBytes, 0);
        u16 countU16 = 0;
        Status s = idxReader.readUnsignedShort(&countU16);
        if (!ok(s)) {
            return Result<IndexedDatTypeLoader>::err(s);
        }
        const i32 count = static_cast<i32>(countU16);
        if (count < 0) {
            return Result<IndexedDatTypeLoader>::err(Status::BadFormat);
        }

        // Optional: validate dat header (count).
        if (datBytes.size() >= 2) {
            Uint8ArrayReader datReader(datBytes, 0);
            u16 datCountU16 = 0;
            if (ok(datReader.readUnsignedShort(&datCountU16))) {
                if (static_cast<i32>(datCountU16) < count) {
                    return Result<IndexedDatTypeLoader>::err(Status::BadFormat);
                }
            }
        }

        Vec<i32> offsets(alloc);
        Vec<i32> lengths(alloc);
        auto rr = offsets.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<IndexedDatTypeLoader>::err(rr.status());
        }
        rr = lengths.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<IndexedDatTypeLoader>::err(rr.status());
        }

        i32 off = static_cast<i32>(idxReader.tell()); // 2, matches dat payload start after u16 count.
        for (i32 i = 0; i < count; i++) {
            u16 lenU16 = 0;
            s = idxReader.readUnsignedShort(&lenU16);
            if (!ok(s)) {
                return Result<IndexedDatTypeLoader>::err(s);
            }
            const i32 len = static_cast<i32>(lenU16);
            offsets[static_cast<std::size_t>(i)] = off;
            lengths[static_cast<std::size_t>(i)] = len;
            off += len;
        }

        Vec<T> types(alloc);
        rr = types.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<IndexedDatTypeLoader>::err(rr.status());
        }
        for (i32 i = 0; i < count; i++) {
            types[static_cast<std::size_t>(i)] = T(i, cacheInfo);
        }

        Vec<u8> cached(alloc);
        Vec<Status> statusById(alloc);
        rr = cached.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) return Result<IndexedDatTypeLoader>::err(rr.status());
        rr = statusById.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) return Result<IndexedDatTypeLoader>::err(rr.status());
        for (std::size_t i = 0; i < cached.size(); i++) {
            cached[i] = 0;
            statusById[i] = Status::NotFound;
        }

        StringArena strings(alloc);

        return Result<IndexedDatTypeLoader>::ok(
            IndexedDatTypeLoader(datBytes, rs::move(offsets), rs::move(lengths), rs::move(types), rs::move(cached), rs::move(statusById), rs::move(strings), count, cacheInfo, &alloc));
    }

    IndexedDatTypeLoader() = default;

    [[nodiscard]] i32 count() const noexcept { return count_; }

    Status get(i32 id, const T** out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        *out = nullptr;
        if (id < 0) {
            return Status::OutOfRange;
        }
        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= cached_.size()) {
            return Status::OutOfRange;
        }

        if (cached_[idx] != 0) {
            const Status s = statusById_[idx];
            if (!ok(s)) {
                return s;
            }
            *out = &types_[idx];
            return Status::Ok;
        }

        const i32 start = offsets_[idx];
        const i32 len = lengths_[idx];
        if (start < 0 || len < 0) {
            cached_[idx] = 1;
            statusById_[idx] = Status::BadFormat;
            return statusById_[idx];
        }
        const std::size_t sStart = static_cast<std::size_t>(start);
        const std::size_t sLen = static_cast<std::size_t>(len);
        if (sStart + sLen > datBytes_.size()) {
            cached_[idx] = 1;
            statusById_[idx] = Status::Truncated;
            return statusById_[idx];
        }

        const TypeDecodeContext ctx{cacheInfo_, &strings_, alloc_};
        Uint8ArrayReader reader(datBytes_.subspan(sStart, sLen), 0);
        TypeDecodeError err{};
        const Status ds = decodeType(types_[idx], reader, &err, &ctx);
        statusById_[idx] = ds;
        cached_[idx] = 1;
        if (!ok(ds)) {
            return ds;
        }
        callPost(types_[idx], 0);
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

    explicit IndexedDatTypeLoader(
        Span<const u8> datBytes,
        Vec<i32> offsets,
        Vec<i32> lengths,
        Vec<T> types,
        Vec<u8> cached,
        Vec<Status> statusById,
        StringArena strings,
        i32 count,
        CacheInfo cacheInfo,
        Allocator* alloc) noexcept
        : datBytes_(datBytes),
          offsets_(rs::move(offsets)),
          lengths_(rs::move(lengths)),
          types_(rs::move(types)),
          cached_(rs::move(cached)),
          statusById_(rs::move(statusById)),
          strings_(rs::move(strings)),
          count_(count),
          cacheInfo_(cacheInfo),
          alloc_(alloc) {}

    Span<const u8> datBytes_{};
    mutable Vec<i32> offsets_{};
    mutable Vec<i32> lengths_{};

    mutable Vec<T> types_{};
    mutable Vec<u8> cached_{};
    mutable Vec<Status> statusById_{};
    mutable StringArena strings_{};
    i32 count_ = 0;

    CacheInfo cacheInfo_{};
    Allocator* alloc_ = nullptr;
};

} // namespace rs
