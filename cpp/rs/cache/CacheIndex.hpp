#pragma once

#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../crypto/Xtea.hpp"
#include "../types.hpp"
#include "CacheType.hpp"
#include "format/Archive.hpp"
#include "reference/ReferenceTable.hpp"
#include "store/CacheStore.hpp"

namespace rs {

class CacheIndex {
public:
    static constexpr i32 META_INDEX_ID = 255;

    static Result<CacheIndex> fromStore(
        CacheType cacheType,
        i32 id,
        const CacheStore& store,
        const CompressionHandler& compressionHandler,
        Allocator& alloc) noexcept;

    CacheIndex() = default;

    [[nodiscard]] i32 id() const noexcept { return id_; }
    [[nodiscard]] CacheType cacheType() const noexcept { return cacheType_; }

    [[nodiscard]] Span<const i32> archiveIds() const noexcept;
    [[nodiscard]] i32 archiveCount() const noexcept;
    [[nodiscard]] i32 lastArchiveId() const noexcept;

    [[nodiscard]] bool archiveExists(i32 archiveId) const noexcept;
    [[nodiscard]] i32 fileCount(i32 archiveId) const noexcept;

    Status getArchiveMeta(i32 archiveId, ArchiveMeta* out) const noexcept;

    Result<Archive> getArchiveKey(i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept;
    Result<Archive> getArchive(i32 archiveId, Allocator& alloc) const noexcept { return getArchiveKey(archiveId, nullptr, alloc); }

private:
    CacheIndex(
        CacheType cacheType,
        i32 id,
        const CacheStore& store,
        const CompressionHandler& compressionHandler,
        i32 archiveCount,
        ReferenceTable table,
        Vec<i32> archiveIds) noexcept;

    CacheType cacheType_ = CacheType::Dat2;
    i32 id_ = -1;
    const CacheStore* store_ = nullptr;
    const CompressionHandler* compressionHandler_ = nullptr;

    // Dat-only.
    i32 archiveCount_ = 0;
    mutable Vec<i32> archiveIds_;
    mutable bool archiveIdsBuilt_ = false;

    // Dat2-only.
    ReferenceTable table_;
};

} // namespace rs
