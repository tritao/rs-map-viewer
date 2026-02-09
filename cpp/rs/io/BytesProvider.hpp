#pragma once

#include <cstring>

#include "../cache/CacheIndex.hpp"
#include "../cache/format/Archive.hpp"
#include "../cache/format/ArchiveFile.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

// C++ equivalent of TS IndexFileBytesProvider(index, fileId):
// each id is an archive id, bytes come from archive[fileId].
class IndexFileBytesProvider final {
public:
    IndexFileBytesProvider() = default;
    explicit IndexFileBytesProvider(const CacheIndex* index, i32 fileId = 0) noexcept
        : index_(index), fileId_(fileId) {}

    [[nodiscard]] bool available() const noexcept { return index_ != nullptr; }
    [[nodiscard]] Status status() const noexcept { return available() ? Status::Ok : Status::Unsupported; }
    [[nodiscard]] const CacheIndex* index() const noexcept { return index_; }
    [[nodiscard]] i32 fileId() const noexcept { return fileId_; }

    Status tryGetBytes(i32 id, Vec<u8>* out, Allocator& alloc) const noexcept {
        if (!out) return Status::InvalidArgument;
        out->clear();
        if (!available()) return Status::Unsupported;
        if (id < 0) return Status::OutOfRange;

        auto archRes = index_->getArchive(id, alloc);
        if (!archRes.isOk()) return archRes.status();
        const Archive archive = rs::move(archRes.value());
        const ArchiveFile* file = archive.getFile(fileId_);
        if (!file) return Status::NotFound;

        auto rr = out->resize(file->data.size());
        if (!rr.isOk()) return rr.status();
        if (file->data.size() > 0) {
            std::memcpy(out->data(), file->data.data(), file->data.size());
        }
        return Status::Ok;
    }

    void clearCache() noexcept {}

private:
    const CacheIndex* index_ = nullptr;
    i32 fileId_ = 0;
};

// C++ equivalent for TS group-provider usage where id packs archive/file:
// archiveId = id >> 16, fileId = id & 0xffff.
class PackedIdGroupBytesProvider final {
public:
    PackedIdGroupBytesProvider() = default;
    explicit PackedIdGroupBytesProvider(const CacheIndex* index) noexcept : index_(index) {}

    [[nodiscard]] bool available() const noexcept { return index_ != nullptr; }
    [[nodiscard]] Status status() const noexcept { return available() ? Status::Ok : Status::Unsupported; }
    [[nodiscard]] const CacheIndex* index() const noexcept { return index_; }

    Status tryGetBytes(i32 packedId, Vec<u8>* out, Allocator& alloc) const noexcept {
        if (!out) return Status::InvalidArgument;
        out->clear();
        if (!available()) return Status::Unsupported;
        if (packedId < 0) return Status::OutOfRange;

        const i32 archiveId = (packedId >> 16) & 0xffff;
        const i32 fileId = packedId & 0xffff;

        auto archRes = index_->getArchive(archiveId, alloc);
        if (!archRes.isOk()) return archRes.status();
        const Archive archive = rs::move(archRes.value());
        const ArchiveFile* file = archive.getFile(fileId);
        if (!file) return Status::NotFound;

        auto rr = out->resize(file->data.size());
        if (!rr.isOk()) return rr.status();
        if (file->data.size() > 0) {
            std::memcpy(out->data(), file->data.data(), file->data.size());
        }
        return Status::Ok;
    }

    void clearCache() noexcept {}

private:
    const CacheIndex* index_ = nullptr;
};

} // namespace rs
