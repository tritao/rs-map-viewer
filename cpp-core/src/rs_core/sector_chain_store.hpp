#pragma once

#include "rs_core/bytes.hpp"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

namespace rs_core {

class SectorChainStore {
public:
    SectorChainStore(ByteSource dat, std::vector<std::optional<ByteSource>> idx_files, std::optional<ByteSource> meta)
        : dat_(std::move(dat)), idx_files_(std::move(idx_files)), meta_(std::move(meta)) {}

    // Reads the entire archive bytes for (index_id, archive_id).
    std::vector<uint8_t> read(int index_id, int archive_id) const;

private:
    static constexpr std::size_t SECTOR_HEADER_SIZE = 8;
    static constexpr std::size_t SECTOR_DATA_SIZE = 512;
    static constexpr std::size_t SECTOR_SIZE = SECTOR_HEADER_SIZE + SECTOR_DATA_SIZE;
    static constexpr std::size_t CLUSTER_SIZE = 6;

    const ByteSource* get_index_file(int index_id) const;
    int get_sector_index_id(int index_id) const;

    struct Cluster {
        uint32_t size{};
        uint32_t sector{};
    };

    Cluster read_cluster(const ByteSource& idx, int index_id, int archive_id) const;
    std::vector<uint32_t> walk_chain(int sector_index_id, uint32_t archive_id, uint32_t first_sector, uint32_t total_size) const;

    ByteSource dat_;
    std::vector<std::optional<ByteSource>> idx_files_;
    std::optional<ByteSource> meta_;
};

} // namespace rs_core

