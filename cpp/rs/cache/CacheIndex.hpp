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

    CacheIndex() noexcept;
    ~CacheIndex();

    CacheIndex(const CacheIndex&) = delete;
    CacheIndex& operator=(const CacheIndex&) = delete;

    CacheIndex(CacheIndex&& other) noexcept;
    CacheIndex& operator=(CacheIndex&& other) noexcept;

    [[nodiscard]] i32 id() const noexcept { return id_; }
    [[nodiscard]] CacheType cacheType() const noexcept { return cacheType_; }

    [[nodiscard]] Span<const i32> archiveIds() const noexcept;
    [[nodiscard]] i32 archiveCount() const noexcept;
    [[nodiscard]] i32 lastArchiveId() const noexcept;

    [[nodiscard]] bool archiveExists(i32 archiveId) const noexcept;
    [[nodiscard]] i32 fileCount(i32 archiveId) const noexcept;

    Status getArchiveMeta(i32 archiveId, ArchiveMeta* out) const noexcept;

    // Reads the raw archive bytes (container/packed format as stored on disk) into `out`.
    Status readArchiveBytes(i32 archiveId, Vec<u8>* out, Allocator& alloc) const noexcept;

    // Dat2-only: decodes the container and returns the payload bytes (archive format bytes).
    Status readContainerPayload(i32 archiveId, const XteaKey* key, Vec<u8>* out, Allocator& alloc) const noexcept;

    Result<Archive> getArchiveKey(i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept;
    Result<Archive> getArchive(i32 archiveId, Allocator& alloc) const noexcept { return getArchiveKey(archiveId, nullptr, alloc); }

private:
    struct DatIndexImpl {
        i32 archiveCount = 0;
        mutable Vec<i32> archiveIds;
        mutable bool archiveIdsBuilt = false;

        DatIndexImpl() = default;
        explicit DatIndexImpl(Allocator& alloc) noexcept : archiveIds(alloc) {}
    };

    struct Dat2IndexImpl {
        ReferenceTable table;
    };

    union Storage {
        DatIndexImpl dat;
        Dat2IndexImpl dat2;

        Storage() {}
        ~Storage() {}
    };

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

    Storage storage_;
};

} // namespace rs
