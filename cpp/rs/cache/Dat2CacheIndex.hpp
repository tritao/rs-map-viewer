#pragma once

#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "ArchiveMeta.hpp"
#include "format/Container.hpp"
#include "reference/ReferenceTable.hpp"
#include "store/CacheStore.hpp"

namespace rs {

class Dat2CacheIndex {
public:
    static Result<Dat2CacheIndex> fromDat2Store(
        i32 id,
        const CacheStore& store,
        const CompressionHandler& compressionHandler,
        Allocator& alloc) noexcept;

    Dat2CacheIndex(
        i32 id,
        ReferenceTable table,
        const CacheStore& store,
        const CompressionHandler& compressionHandler) noexcept
        : id_(id), table_(rs::move(table)), store_(store), compressionHandler_(compressionHandler) {}

    [[nodiscard]] i32 id() const noexcept { return id_; }
    [[nodiscard]] Span<const i32> archiveIds() const noexcept { return table_.archiveIds(); }
    [[nodiscard]] i32 archiveCount() const noexcept { return table_.archiveCount(); }
    [[nodiscard]] i32 lastArchiveId() const noexcept { return table_.lastArchiveId(); }

    Status getArchiveMeta(i32 archiveId, ArchiveMeta* out) const noexcept { return table_.getArchiveMeta(archiveId, out); }

private:
    i32 id_;
    ReferenceTable table_;
    const CacheStore& store_;
    const CompressionHandler& compressionHandler_;
};

} // namespace rs
