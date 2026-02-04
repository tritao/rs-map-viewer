#include "SectorChainStore.hpp"

#include <algorithm>
#include <cstddef>
#include <memory>
#include <optional>
#include <span>
#include <stdexcept>
#include <utility>
#include <vector>

#include "../../io/ByteSource.hpp"
#include "../../io/ByteSourceSlice.hpp"
#include "../../io/Endian.hpp"
#include "../../util/U32.hpp"
#include "../../types.hpp"
#include "DatLayout.hpp"

namespace rs {

class SectorChainArchiveSource final : public ByteSource, public std::enable_shared_from_this<SectorChainArchiveSource> {
public:
    SectorChainArchiveSource(
        ByteSourcePtr dataFile,
        std::vector<u32> sectorIds,
        std::size_t size,
        std::size_t headerSize,
        std::size_t dataSize)
        : dataFile_(std::move(dataFile)),
          sectorIds_(std::move(sectorIds)),
          size_(size),
          headerSize_(headerSize),
          dataSize_(dataSize) {}

    [[nodiscard]] std::size_t size() const override { return size_; }

    [[nodiscard]] ByteSourcePtr slice(std::size_t start, std::size_t size) const override {
        return std::make_shared<ByteSourceSlice>(shared_from_this(), start, size);
    }

    void readInto(std::size_t offset, u8* target, std::size_t length) const override {
        if (offset > size_ || length > size_ - offset) {
            throw std::out_of_range("SectorChainArchiveSource: read out of bounds");
        }
        if (length == 0) {
            return;
        }

        std::size_t remaining = length;
        std::size_t inOff = offset;
        std::size_t outOff = 0;

        while (remaining > 0) {
            const std::size_t sectorIndex = inOff / dataSize_;
            const std::size_t sectorOffset = inOff - sectorIndex * dataSize_;
            const std::size_t take = std::min<std::size_t>(dataSize_ - sectorOffset, remaining);

            if (sectorIndex >= sectorIds_.size()) {
                throw std::runtime_error("SectorChainArchiveSource: invalid sector index");
            }
            const u32 sectorId = sectorIds_[sectorIndex];

            const std::size_t fileOffset = static_cast<std::size_t>(sectorId) * SECTOR_SIZE + headerSize_ + sectorOffset;
            dataFile_->readInto(fileOffset, target + outOff, take);

            remaining -= take;
            inOff += take;
            outOff += take;
        }
    }

    [[nodiscard]] std::optional<std::span<const u8>> tryGetUint8ArrayView() const override { return std::nullopt; }

private:
    ByteSourcePtr dataFile_;
    std::vector<u32> sectorIds_;
    std::size_t size_;
    std::size_t headerSize_;
    std::size_t dataSize_;
};

SectorChainStore::SectorChainStore(
    ByteSourcePtr dataFile,
    std::vector<std::optional<ByteSourcePtr>> indexFiles,
    std::optional<ByteSourcePtr> metaFile)
    : dataFile_(std::move(dataFile)), indexFiles_(std::move(indexFiles)), metaFile_(std::move(metaFile)) {
    if (!dataFile_) {
        throw std::invalid_argument("SectorChainStore: dataFile is null");
    }
}

const ByteSource* SectorChainStore::getIndexFile(i32 indexId) const {
    if (indexId < 0) {
        return nullptr;
    }
    if (indexId == 255) {
        return metaFile_ ? metaFile_->get() : nullptr;
    }
    const std::size_t idx = static_cast<std::size_t>(indexId);
    if (idx >= indexFiles_.size()) {
        return nullptr;
    }
    const auto& opt = indexFiles_[idx];
    return opt ? opt->get() : nullptr;
}

i32 SectorChainStore::getSectorIndexId(i32 indexId) const {
    if (metaFile_) {
        return indexId;
    }
    return indexId + 1;
}

std::optional<std::size_t> SectorChainStore::getIndexFileSize(i32 indexId) const {
    const ByteSource* file = getIndexFile(indexId);
    if (!file) {
        return std::nullopt;
    }
    return file->size();
}

SectorChainStore::SectorCluster SectorChainStore::readSectorCluster(
    const ByteSource& indexFile,
    i32 indexId,
    i32 archiveId) const {
    (void)indexId;
    if (archiveId < 0) {
        throw std::out_of_range("SectorChainStore: archiveId < 0");
    }

    const std::size_t clusterPtr = static_cast<std::size_t>(archiveId) * IDX_ENTRY_SIZE;
    if (clusterPtr + IDX_ENTRY_SIZE > indexFile.size()) {
        throw std::out_of_range("SectorChainStore: idx entry out of bounds");
    }

    u8 buf[IDX_ENTRY_SIZE];
    indexFile.readInto(clusterPtr, buf, IDX_ENTRY_SIZE);

    SectorCluster c;
    c.size = readU24BE(buf);
    c.sector = readU24BE(buf + 3);
    return c;
}

std::vector<u32> SectorChainStore::walkSectorChain(
    i32 sectorIndexId,
    u32 archiveId,
    u32 firstSectorId,
    u32 totalSize,
    bool extended) const {
    const std::size_t headerSize = extended ? SECTOR_EXTENDED_HEADER_SIZE : SECTOR_HEADER_SIZE;
    const std::size_t dataSize = extended ? SECTOR_EXTENDED_DATA_SIZE : SECTOR_DATA_SIZE;

    std::vector<u32> sectorIds;
    u32 remaining = totalSize;
    u32 chunk = 0;
    u32 sectorId = firstSectorId;

    std::vector<u8> header;
    header.resize(headerSize);

    while (remaining > 0) {
        const std::size_t sectorPtr = static_cast<std::size_t>(sectorId) * SECTOR_SIZE;
        if (sectorPtr + headerSize > dataFile_->size()) {
            throw std::out_of_range("SectorChainStore: sector ptr out of bounds");
        }
        dataFile_->readInto(sectorPtr, header.data(), headerSize);

        u32 readArchiveId = 0;
        u32 readChunk = 0;
        u32 nextSector = 0;
        u32 readIndexId = 0;

        if (extended) {
            readArchiveId = toU32(readI32BE(header.data()));
            readChunk = readU16BE(header.data() + 4);
            nextSector = readU24BE(header.data() + 6);
            readIndexId = header[9];
        } else {
            readArchiveId = readU16BE(header.data());
            readChunk = readU16BE(header.data() + 2);
            nextSector = readU24BE(header.data() + 4);
            readIndexId = header[7];
        }

        if (toU32(readArchiveId) != toU32(archiveId)) {
            throw std::runtime_error("SectorChainStore: sector archive id mismatch");
        }
        if (readIndexId != static_cast<u32>(sectorIndexId)) {
            throw std::runtime_error("SectorChainStore: sector index id mismatch");
        }
        if (readChunk != chunk) {
            throw std::runtime_error("SectorChainStore: sector chunk mismatch");
        }

        sectorIds.push_back(sectorId);
        chunk++;
        sectorId = nextSector;
        if (remaining > dataSize) {
            remaining -= static_cast<u32>(dataSize);
        } else {
            remaining = 0;
        }
    }

    return sectorIds;
}

ByteSourcePtr SectorChainStore::openArchiveReader(i32 indexId, i32 archiveId) const {
    if (indexId < 0) {
        throw std::runtime_error("SectorChainStore: indexId < 0");
    }

    const ByteSource* indexFile = getIndexFile(indexId);
    if (!indexFile) {
        throw std::runtime_error("SectorChainStore: index file not found");
    }

    const i32 sectorIndexId = getSectorIndexId(indexId);
    const SectorCluster cluster = readSectorCluster(*indexFile, indexId, archiveId);
    const std::size_t size = static_cast<std::size_t>(cluster.size);
    const bool extended = archiveId > 65535;

    const std::size_t headerSize = extended ? SECTOR_EXTENDED_HEADER_SIZE : SECTOR_HEADER_SIZE;
    const std::size_t dataSize = extended ? SECTOR_EXTENDED_DATA_SIZE : SECTOR_DATA_SIZE;

    const std::vector<u32> sectorIds =
        walkSectorChain(sectorIndexId, static_cast<u32>(archiveId), cluster.sector, cluster.size, extended);

    return std::make_shared<SectorChainArchiveSource>(dataFile_, sectorIds, size, headerSize, dataSize);
}

} // namespace rs
