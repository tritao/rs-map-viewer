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

// Loader for legacy dat config streams stored in `<name>.dat`:
// [u16 count][type0 stream][type1 stream]...
template <typename T>
class DatTypeLoader final {
public:
    static Result<DatTypeLoader> fromNamedFiles(
        const CacheInfo& cacheInfo,
        const Archive& configArchive,
        const char* name,
        Allocator& alloc) noexcept {
        if (!name) {
            return Result<DatTypeLoader>::err(Status::InvalidArgument);
        }

        // Build "<name>.dat" hash without STL.
        const char* suffix = ".dat";
        std::size_t nameLen = 0;
        while (name[nameLen] != 0) nameLen++;
        std::size_t suffixLen = 0;
        while (suffix[suffixLen] != 0) suffixLen++;
        char buf[64];
        if (nameLen + suffixLen >= sizeof(buf)) {
            return Result<DatTypeLoader>::err(Status::InvalidArgument);
        }
        for (std::size_t i = 0; i < nameLen; i++) buf[i] = name[i];
        for (std::size_t i = 0; i < suffixLen; i++) buf[nameLen + i] = suffix[i];

        const i32 hash = hashOld(buf, nameLen + suffixLen);
        const ArchiveFile* file = configArchive.getFileByNameHash(hash);
        if (!file) {
            return Result<DatTypeLoader>::err(Status::NotFound);
        }

        Uint8ArrayReader reader(Span<const u8>(file->data.data(), file->data.size()), 0);
        u16 countU16 = 0;
        Status s = reader.readUnsignedShort(&countU16);
        if (!ok(s)) {
            return Result<DatTypeLoader>::err(s);
        }
        const i32 count = static_cast<i32>(countU16);
        if (count < 0) {
            return Result<DatTypeLoader>::err(Status::BadFormat);
        }

        Vec<T> types(alloc);
        auto rr = types.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<DatTypeLoader>::err(rr.status());
        }
        for (i32 i = 0; i < count; i++) {
            types[static_cast<std::size_t>(i)] = T(i, cacheInfo);
        }

        Vec<Status> statusById(alloc);
        rr = statusById.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) {
            return Result<DatTypeLoader>::err(rr.status());
        }
        for (std::size_t i = 0; i < statusById.size(); i++) {
            statusById[i] = Status::NotFound;
        }

        StringArena strings(alloc);
        const TypeDecodeContext ctx{cacheInfo, &strings, &alloc};

        for (i32 id = 0; id < count; id++) {
            TypeDecodeError err{};
            const Status ds = decodeType(types[static_cast<std::size_t>(id)], reader, &err, &ctx);
            statusById[static_cast<std::size_t>(id)] = ds;
            if (!ok(ds)) {
                return Result<DatTypeLoader>::err(ds);
            }
            callPost(types[static_cast<std::size_t>(id)], 0);
        }

        return Result<DatTypeLoader>::ok(DatTypeLoader(rs::move(types), rs::move(statusById), rs::move(strings), count));
    }

    DatTypeLoader() = default;

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
        if (idx >= statusById_.size()) {
            return Status::OutOfRange;
        }
        const Status s = statusById_[idx];
        if (!ok(s)) {
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

    explicit DatTypeLoader(Vec<T> types, Vec<Status> statusById, StringArena strings, i32 count) noexcept
        : types_(rs::move(types)), statusById_(rs::move(statusById)), strings_(rs::move(strings)), count_(count) {}

    Vec<T> types_{};
    Vec<Status> statusById_{};
    StringArena strings_{};
    i32 count_ = 0;
};

} // namespace rs
