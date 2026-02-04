#pragma once

#include <optional>
#include <vector>

#include "../../io/ByteSource.hpp"
#include "../../io/ByteSourceAccess.hpp"
#include "CacheStore.hpp"

namespace rs {

class SectorChainStore final : public CacheStore {
public:
    SectorChainStore(
        ByteSourcePtr dataFile,
        std::vector<std::optional<ByteSourcePtr>> indexFiles,
        std::optional<ByteSourcePtr> metaFile);

    [[nodiscard]] std::optional<std::size_t> getIndexFileSize(i32 indexId) const override;
    [[nodiscard]] ByteSourcePtr openArchiveReader(i32 indexId, i32 archiveId) const override;

private:
    ByteSourcePtr dataFile_;
    std::vector<std::optional<ByteSourcePtr>> indexFiles_;
    std::optional<ByteSourcePtr> metaFile_;

    const ByteSource* getIndexFile(i32 indexId) const;
    [[nodiscard]] i32 getSectorIndexId(i32 indexId) const;

    struct SectorCluster {
        u32 size = 0;
        u32 sector = 0;
    };

    SectorCluster readSectorCluster(const ByteSource& indexFile, i32 indexId, i32 archiveId) const;
    std::vector<u32> walkSectorChain(i32 sectorIndexId, u32 archiveId, u32 firstSectorId, u32 totalSize, bool extended) const;
};

} // namespace rs

