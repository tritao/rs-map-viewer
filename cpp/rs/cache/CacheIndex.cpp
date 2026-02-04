#include "CacheIndex.hpp"

#include <cstddef>

#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../crypto/Xtea.hpp"
#include "../types.hpp"
#include "CacheType.hpp"
#include "format/Archive.hpp"
#include "../cache/ArchiveMeta.hpp"
#include "../cache/format/Container.hpp"
#include "reference/ReferenceTable.hpp"
#include "store/CacheStore.hpp"
#include "../cache/store/DatLayout.hpp"
#include "../io/ByteSourceReader.hpp"
#include "../io/Uint8ArrayByteSource.hpp"

namespace rs {

CacheIndex::CacheIndex(
    CacheType cacheType,
    i32 id,
    const CacheStore& store,
    const CompressionHandler& compressionHandler,
    i32 archiveCount,
    ReferenceTable table,
    Vec<i32> archiveIds) noexcept
    : cacheType_(cacheType),
      id_(id),
      store_(&store),
      compressionHandler_(&compressionHandler),
      archiveCount_(archiveCount),
      archiveIds_(rs::move(archiveIds)),
      table_(rs::move(table)) {
}

Result<CacheIndex> CacheIndex::fromStore(
    CacheType cacheType,
    i32 id,
    const CacheStore& store,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    if (cacheType != CacheType::Dat && cacheType != CacheType::Dat2) {
        return Result<CacheIndex>::err(Status::Unsupported);
    }

    if (cacheType == CacheType::Dat) {
        std::size_t indexSize = 0;
        const Status s = store.getIndexFileSize(id, &indexSize);
        if (!ok(s)) {
            return Result<CacheIndex>::err(s);
        }
        if ((indexSize % IDX_ENTRY_SIZE) != 0) {
            return Result<CacheIndex>::err(Status::BadFormat);
        }
        const i32 archiveCount = static_cast<i32>(indexSize / IDX_ENTRY_SIZE);
        Vec<i32> ids(alloc);
        ReferenceTable emptyTable;
        return Result<CacheIndex>::ok(CacheIndex(cacheType, id, store, compressionHandler, archiveCount, rs::move(emptyTable), rs::move(ids)));
    }

    // Dat2: meta index 255 contains a reference-table container per index id.
    Vec<u8> metaBytes(alloc);
    const Status s = store.readArchive(META_INDEX_ID, id, &metaBytes);
    if (!ok(s)) {
        return Result<CacheIndex>::err(s);
    }
    if (metaBytes.size() == 0) {
        // Mirror TS behavior: empty reference-table source => "invalid" (empty) table.
        Vec<i32> ids(alloc);
        ReferenceTable emptyTable;
        return Result<CacheIndex>::ok(CacheIndex(cacheType, id, store, compressionHandler, 0, rs::move(emptyTable), rs::move(ids)));
    }

    Uint8ArrayByteSource metaSource(metaBytes.data(), metaBytes.size());
    auto containerRes = Container::decodeFromSource(metaSource, nullptr, compressionHandler, alloc);
    if (!containerRes.isOk()) {
        return Result<CacheIndex>::err(containerRes.status());
    }
    Container container = rs::move(containerRes.value());

    Uint8ArrayByteSource tableSource(container.data.data(), container.data.size());
    ByteSourceReader reader(&tableSource);
    auto tableRes = ReferenceTable::decodeFromReader(reader, alloc);
    if (!tableRes.isOk()) {
        return Result<CacheIndex>::err(tableRes.status());
    }

    Vec<i32> ids(alloc);
    return Result<CacheIndex>::ok(CacheIndex(cacheType, id, store, compressionHandler, 0, rs::move(tableRes.value()), rs::move(ids)));
}

Span<const i32> CacheIndex::archiveIds() const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return table_.archiveIds();
    }
    if (!archiveIdsBuilt_) {
        archiveIds_.clear();
        auto r = archiveIds_.reserve(static_cast<std::size_t>(archiveCount_));
        if (r.isOk()) {
            for (i32 i = 0; i < archiveCount_; i++) {
                (void)archiveIds_.pushBack(i);
            }
        }
        archiveIdsBuilt_ = true;
    }
    return Span<const i32>(archiveIds_.data(), archiveIds_.size());
}

i32 CacheIndex::archiveCount() const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return table_.archiveCount();
    }
    return archiveCount_;
}

i32 CacheIndex::lastArchiveId() const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return table_.lastArchiveId();
    }
    return archiveCount_ > 0 ? (archiveCount_ - 1) : -1;
}

bool CacheIndex::archiveExists(i32 archiveId) const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return table_.archiveExists(archiveId);
    }
    return archiveId >= 0 && archiveId < archiveCount_;
}

i32 CacheIndex::fileCount(i32 archiveId) const noexcept {
    if (cacheType_ != CacheType::Dat2) {
        return 0;
    }
    ArchiveMeta meta;
    const Status s = table_.getArchiveMeta(archiveId, &meta);
    if (!ok(s)) {
        return 0;
    }
    return meta.fileCount;
}

Status CacheIndex::getArchiveMeta(i32 archiveId, ArchiveMeta* out) const noexcept {
    if (cacheType_ != CacheType::Dat2) {
        return Status::Unsupported;
    }
    return table_.getArchiveMeta(archiveId, out);
}

Result<Archive> CacheIndex::getArchiveKey(i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept {
    if (!store_ || !compressionHandler_) {
        return Result<Archive>::err(Status::InvalidArgument);
    }
    if (!archiveExists(archiveId)) {
        return Result<Archive>::err(Status::NotFound);
    }

    Vec<u8> bytes(alloc);
    const Status s = store_->readArchive(id_, archiveId, &bytes);
    if (!ok(s)) {
        return Result<Archive>::err(s);
    }

    if (cacheType_ == CacheType::Dat) {
        // Dat caches store "old" archive bytes directly.
        // Index 0 ("configs") is multi-file; other indices are typically single-file.
        const bool multipleFiles = (id_ == 0);
        return Archive::decodeOld(
            archiveId,
            Span<const u8>(bytes.data(), bytes.size()),
            multipleFiles,
            *compressionHandler_,
            alloc);
    }

    ArchiveMeta meta;
    const Status m = table_.getArchiveMeta(archiveId, &meta);
    if (!ok(m)) {
        return Result<Archive>::err(m);
    }

    Uint8ArrayByteSource source(bytes.data(), bytes.size());
    auto containerRes = Container::decodeFromSource(source, key, *compressionHandler_, alloc);
    if (!containerRes.isOk()) {
        return Result<Archive>::err(containerRes.status());
    }
    Container container = rs::move(containerRes.value());

    return Archive::decodeFromBytes(meta, Span<const u8>(container.data.data(), container.data.size()), alloc);
}

} // namespace rs
