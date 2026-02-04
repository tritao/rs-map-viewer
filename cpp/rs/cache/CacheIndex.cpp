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
#include "../util/StringHash.hpp"

namespace rs {

CacheIndex::CacheIndex() noexcept : cacheType_(CacheType::Dat2), id_(-1), store_(nullptr), compressionHandler_(nullptr) {
    new (&storage_.dat2) Dat2IndexImpl();
}

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
      compressionHandler_(&compressionHandler) {
    if (cacheType_ == CacheType::Dat) {
        new (&storage_.dat) DatIndexImpl();
        storage_.dat.archiveCount = archiveCount;
        storage_.dat.archiveIds = rs::move(archiveIds);
        storage_.dat.archiveIdsBuilt = false;
    } else {
        new (&storage_.dat2) Dat2IndexImpl();
        storage_.dat2.table = rs::move(table);
    }
}

CacheIndex::~CacheIndex() {
    if (cacheType_ == CacheType::Dat) {
        storage_.dat.~DatIndexImpl();
    } else {
        storage_.dat2.~Dat2IndexImpl();
    }
}

CacheIndex::CacheIndex(CacheIndex&& other) noexcept
    : cacheType_(other.cacheType_), id_(other.id_), store_(other.store_), compressionHandler_(other.compressionHandler_) {
    if (cacheType_ == CacheType::Dat) {
        new (&storage_.dat) DatIndexImpl();
        storage_.dat.archiveCount = other.storage_.dat.archiveCount;
        storage_.dat.archiveIds = rs::move(other.storage_.dat.archiveIds);
        storage_.dat.archiveIdsBuilt = other.storage_.dat.archiveIdsBuilt;
    } else {
        new (&storage_.dat2) Dat2IndexImpl();
        storage_.dat2.table = rs::move(other.storage_.dat2.table);
    }

    // Leave `other` in a valid, destructible state.
    other.id_ = -1;
    other.store_ = nullptr;
    other.compressionHandler_ = nullptr;
    if (other.cacheType_ == CacheType::Dat) {
        other.storage_.dat.~DatIndexImpl();
    } else {
        other.storage_.dat2.~Dat2IndexImpl();
    }
    other.cacheType_ = CacheType::Dat2;
    new (&other.storage_.dat2) Dat2IndexImpl();
}

CacheIndex& CacheIndex::operator=(CacheIndex&& other) noexcept {
    if (this == &other) {
        return *this;
    }

    // Destroy current.
    if (cacheType_ == CacheType::Dat) {
        storage_.dat.~DatIndexImpl();
    } else {
        storage_.dat2.~Dat2IndexImpl();
    }

    cacheType_ = other.cacheType_;
    id_ = other.id_;
    store_ = other.store_;
    compressionHandler_ = other.compressionHandler_;

    if (cacheType_ == CacheType::Dat) {
        new (&storage_.dat) DatIndexImpl();
        storage_.dat.archiveCount = other.storage_.dat.archiveCount;
        storage_.dat.archiveIds = rs::move(other.storage_.dat.archiveIds);
        storage_.dat.archiveIdsBuilt = other.storage_.dat.archiveIdsBuilt;
    } else {
        new (&storage_.dat2) Dat2IndexImpl();
        storage_.dat2.table = rs::move(other.storage_.dat2.table);
    }

    // Leave `other` valid.
    other.id_ = -1;
    other.store_ = nullptr;
    other.compressionHandler_ = nullptr;
    if (other.cacheType_ == CacheType::Dat) {
        other.storage_.dat.~DatIndexImpl();
    } else {
        other.storage_.dat2.~Dat2IndexImpl();
    }
    other.cacheType_ = CacheType::Dat2;
    new (&other.storage_.dat2) Dat2IndexImpl();
    return *this;
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
        return storage_.dat2.table.archiveIds();
    }
    if (!storage_.dat.archiveIdsBuilt) {
        storage_.dat.archiveIds.clear();
        auto r = storage_.dat.archiveIds.reserve(static_cast<std::size_t>(storage_.dat.archiveCount));
        if (r.isOk()) {
            for (i32 i = 0; i < storage_.dat.archiveCount; i++) {
                (void)storage_.dat.archiveIds.pushBack(i);
            }
        }
        storage_.dat.archiveIdsBuilt = true;
    }
    return Span<const i32>(storage_.dat.archiveIds.data(), storage_.dat.archiveIds.size());
}

i32 CacheIndex::archiveCount() const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return storage_.dat2.table.archiveCount();
    }
    return storage_.dat.archiveCount;
}

i32 CacheIndex::lastArchiveId() const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return storage_.dat2.table.lastArchiveId();
    }
    return storage_.dat.archiveCount > 0 ? (storage_.dat.archiveCount - 1) : -1;
}

bool CacheIndex::archiveExists(i32 archiveId) const noexcept {
    if (cacheType_ == CacheType::Dat2) {
        return storage_.dat2.table.archiveExists(archiveId);
    }
    return archiveId >= 0 && archiveId < storage_.dat.archiveCount;
}

i32 CacheIndex::fileCount(i32 archiveId) const noexcept {
    if (cacheType_ != CacheType::Dat2) {
        return 0;
    }
    ArchiveMeta meta;
    const Status s = storage_.dat2.table.getArchiveMeta(archiveId, &meta);
    if (!ok(s)) {
        return 0;
    }
    return meta.fileCount;
}

i32 CacheIndex::getArchiveId(const char* name) const noexcept {
    if (cacheType_ != CacheType::Dat2) {
        return -1;
    }
    if (!name) {
        return -1;
    }
    const i32 h = hashDjb2(name);
    return storage_.dat2.table.getArchiveIdByNameHash(h);
}

Status CacheIndex::getArchiveMeta(i32 archiveId, ArchiveMeta* out) const noexcept {
    if (cacheType_ != CacheType::Dat2) {
        return Status::Unsupported;
    }
    return storage_.dat2.table.getArchiveMeta(archiveId, out);
}

Status CacheIndex::readArchiveBytes(i32 archiveId, Vec<u8>* out, Allocator& alloc) const noexcept {
    (void)alloc;
    if (!store_ || !out) {
        return Status::InvalidArgument;
    }
    if (!archiveExists(archiveId)) {
        return Status::NotFound;
    }
    return store_->readArchive(id_, archiveId, out);
}

Status CacheIndex::readContainerPayload(i32 archiveId, const XteaKey* key, Vec<u8>* out, Allocator& alloc) const noexcept {
    if (cacheType_ != CacheType::Dat2) {
        return Status::Unsupported;
    }
    if (!compressionHandler_ || !out) {
        return Status::InvalidArgument;
    }

    Vec<u8> raw(alloc);
    const Status s = readArchiveBytes(archiveId, &raw, alloc);
    if (!ok(s)) {
        return s;
    }

    Uint8ArrayByteSource source(raw.data(), raw.size());
    auto containerRes = Container::decodeFromSource(source, key, *compressionHandler_, alloc);
    if (!containerRes.isOk()) {
        return containerRes.status();
    }
    Container container = rs::move(containerRes.value());

    *out = rs::move(container.data);
    return Status::Ok;
}

Result<Archive> CacheIndex::getArchiveKey(i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept {
    if (!store_ || !compressionHandler_) {
        return Result<Archive>::err(Status::InvalidArgument);
    }
    if (!archiveExists(archiveId)) {
        return Result<Archive>::err(Status::NotFound);
    }

    Vec<u8> bytes(alloc);
    const Status s = readArchiveBytes(archiveId, &bytes, alloc);
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
    const Status m = getArchiveMeta(archiveId, &meta);
    if (!ok(m)) {
        return Result<Archive>::err(m);
    }

    Vec<u8> payload(alloc);
    const Status ps = readContainerPayload(archiveId, key, &payload, alloc);
    if (!ok(ps)) {
        return Result<Archive>::err(ps);
    }

    return Archive::decodeFromBytes(meta, Span<const u8>(payload.data(), payload.size()), alloc);
}

} // namespace rs
