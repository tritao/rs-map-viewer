#pragma once

#include <cstddef>

#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/ByteSource.hpp"
#include "CacheStore.hpp"

namespace rs {

class SectorChainStore final : public CacheStore {
public:
    SectorChainStore(
        const ByteSource* dataFile,
        Vec<const ByteSource*> indexFiles,
        const ByteSource* metaFile) noexcept;

    Status getIndexFileSize(i32 indexId, std::size_t* outSize) const noexcept override;
    Status readArchive(i32 indexId, i32 archiveId, Vec<u8>* out) const noexcept override;

private:
    const ByteSource* dataFile_ = nullptr;
    Vec<const ByteSource*> indexFiles_;
    const ByteSource* metaFile_ = nullptr;

    const ByteSource* getIndexFile(i32 indexId) const noexcept;
    [[nodiscard]] i32 getSectorIndexId(i32 indexId) const noexcept;

    struct SectorCluster {
        u32 size = 0;
        u32 sector = 0;
    };

    Status readSectorCluster(const ByteSource& indexFile, i32 archiveId, SectorCluster* out) const noexcept;
    Status walkSectorChain(
        i32 sectorIndexId,
        u32 archiveId,
        u32 firstSectorId,
        u32 totalSize,
        bool extended,
        Vec<u32>* outSectorIds) const noexcept;
};

} // namespace rs
