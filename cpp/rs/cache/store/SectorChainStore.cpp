#include "SectorChainStore.hpp"

#include <cstddef>

#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Endian.hpp"
#include "../../io/ByteSource.hpp"
#include "../../util/U32.hpp"
#include "../../types.hpp"
#include "DatLayout.hpp"

namespace rs {

SectorChainStore::SectorChainStore(
    const ByteSource* dataFile,
    Vec<const ByteSource*> indexFiles,
    const ByteSource* metaFile) noexcept
    : dataFile_(dataFile), indexFiles_(rs::move(indexFiles)), metaFile_(metaFile) {}

const ByteSource* SectorChainStore::getIndexFile(i32 indexId) const noexcept {
    if (indexId < 0) {
        return nullptr;
    }
    if (indexId == 255) {
        return metaFile_;
    }
    const std::size_t idx = static_cast<std::size_t>(indexId);
    if (idx >= indexFiles_.size()) {
        return nullptr;
    }
    return indexFiles_[idx];
}

i32 SectorChainStore::getSectorIndexId(i32 indexId) const noexcept {
    // dat2 has a dedicated "meta" index file (id 255).
    if (metaFile_) {
        return indexId;
    }
    // older dat caches shift index ids by +1.
    return indexId + 1;
}

Status SectorChainStore::getIndexFileSize(i32 indexId, std::size_t* outSize) const noexcept {
    if (!outSize) {
        return Status::InvalidArgument;
    }
    const ByteSource* file = getIndexFile(indexId);
    if (!file) {
        return Status::NotFound;
    }
    *outSize = file->size();
    return Status::Ok;
}

Status SectorChainStore::readSectorCluster(const ByteSource& indexFile, i32 archiveId, SectorCluster* out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (archiveId < 0) {
        return Status::OutOfRange;
    }

    const std::size_t clusterPtr = static_cast<std::size_t>(archiveId) * IDX_ENTRY_SIZE;
    if (clusterPtr > indexFile.size() || IDX_ENTRY_SIZE > indexFile.size() - clusterPtr) {
        return Status::Truncated;
    }

    u8 buf[IDX_ENTRY_SIZE];
    Status s = indexFile.readInto(clusterPtr, Span<u8>(buf, sizeof(buf)));
    if (!ok(s)) {
        return s;
    }

    SectorCluster c;
    c.size = readU24BE(buf);
    c.sector = readU24BE(buf + 3);
    *out = c;
    return Status::Ok;
}

Status SectorChainStore::walkSectorChain(
    i32 sectorIndexId,
    u32 archiveId,
    u32 firstSectorId,
    u32 totalSize,
    bool extended,
    Vec<u32>* outSectorIds) const noexcept {
    if (!dataFile_ || !outSectorIds) {
        return Status::InvalidArgument;
    }
    const std::size_t headerSize = extended ? SECTOR_EXTENDED_HEADER_SIZE : SECTOR_HEADER_SIZE;
    const std::size_t dataSize = extended ? SECTOR_EXTENDED_DATA_SIZE : SECTOR_DATA_SIZE;

    outSectorIds->clear();

    u32 remaining = totalSize;
    u32 chunk = 0;
    u32 sectorId = firstSectorId;

    u8 header[SECTOR_EXTENDED_HEADER_SIZE];

    while (remaining > 0) {
        const std::size_t sectorPtr = static_cast<std::size_t>(sectorId) * SECTOR_SIZE;
        if (sectorPtr > dataFile_->size() || headerSize > dataFile_->size() - sectorPtr) {
            return Status::Truncated;
        }

        Status s = dataFile_->readInto(sectorPtr, Span<u8>(header, headerSize));
        if (!ok(s)) {
            return s;
        }

        u32 readArchiveId = 0;
        u32 readChunk = 0;
        u32 nextSector = 0;
        u32 readIndexId = 0;

        if (extended) {
            readArchiveId = toU32(static_cast<u32>(readI32BE(header)));
            readChunk = readU16BE(header + 4);
            nextSector = readU24BE(header + 6);
            readIndexId = header[9];
        } else {
            readArchiveId = readU16BE(header);
            readChunk = readU16BE(header + 2);
            nextSector = readU24BE(header + 4);
            readIndexId = header[7];
        }

        if (toU32(readArchiveId) != toU32(archiveId)) {
            return Status::BadFormat;
        }
        if (readIndexId != static_cast<u32>(sectorIndexId)) {
            return Status::BadFormat;
        }
        if (readChunk != chunk) {
            return Status::BadFormat;
        }

        auto push = outSectorIds->pushBack(sectorId);
        if (!push.isOk()) {
            return push.status();
        }

        chunk++;
        sectorId = nextSector;

        if (remaining > dataSize) {
            remaining -= static_cast<u32>(dataSize);
        } else {
            remaining = 0;
        }
    }

    return Status::Ok;
}

Status SectorChainStore::readArchive(i32 indexId, i32 archiveId, Vec<u8>* out) const noexcept {
    if (!out || !dataFile_) {
        return Status::InvalidArgument;
    }
    if (indexId < 0) {
        return Status::OutOfRange;
    }

    const ByteSource* indexFile = getIndexFile(indexId);
    if (!indexFile) {
        return Status::NotFound;
    }

    const i32 sectorIndexId = getSectorIndexId(indexId);

    SectorCluster cluster;
    Status s = readSectorCluster(*indexFile, archiveId, &cluster);
    if (!ok(s)) {
        return s;
    }

    const std::size_t totalSize = static_cast<std::size_t>(cluster.size);
    const bool extended = archiveId > 65535;

    const std::size_t headerSize = extended ? SECTOR_EXTENDED_HEADER_SIZE : SECTOR_HEADER_SIZE;
    const std::size_t dataSize = extended ? SECTOR_EXTENDED_DATA_SIZE : SECTOR_DATA_SIZE;

    Vec<u32> sectorIds;
    // Use the same allocator as `out` if possible; fall back to default.
    sectorIds = Vec<u32>(defaultAllocator());

    s = walkSectorChain(
        sectorIndexId,
        static_cast<u32>(archiveId),
        cluster.sector,
        cluster.size,
        extended,
        &sectorIds);
    if (!ok(s)) {
        return s;
    }

    auto rr = out->resize(totalSize);
    if (!rr.isOk()) {
        return rr.status();
    }

    std::size_t written = 0;
    u8 sectorHeader[SECTOR_EXTENDED_HEADER_SIZE];

    for (std::size_t i = 0; i < sectorIds.size(); i++) {
        const u32 sectorId = sectorIds[i];
        const std::size_t sectorPtr = static_cast<std::size_t>(sectorId) * SECTOR_SIZE;
        if (sectorPtr > dataFile_->size() || headerSize > dataFile_->size() - sectorPtr) {
            return Status::Truncated;
        }

        s = dataFile_->readInto(sectorPtr, Span<u8>(sectorHeader, headerSize));
        if (!ok(s)) {
            return s;
        }

        const std::size_t take = (totalSize - written > dataSize) ? dataSize : (totalSize - written);
        if (take == 0) {
            break;
        }

        const std::size_t payloadPtr = sectorPtr + headerSize;
        if (payloadPtr > dataFile_->size() || take > dataFile_->size() - payloadPtr) {
            return Status::Truncated;
        }

        s = dataFile_->readInto(payloadPtr, Span<u8>(out->data() + written, take));
        if (!ok(s)) {
            return s;
        }
        written += take;
    }

    if (written != totalSize) {
        return Status::Truncated;
    }
    return Status::Ok;
}

} // namespace rs
