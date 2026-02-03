#include "rs_core/sector_chain_store.hpp"

#include <algorithm>
#include <stdexcept>

namespace rs_core {

const ByteSource* SectorChainStore::get_index_file(int index_id) const {
    if (index_id < 0) {
        return nullptr;
    }
    // meta index id 255 is not needed for the initial fixtures; support it when meta_ is provided
    if (index_id == 255) {
        return meta_ ? &(*meta_) : nullptr;
    }
    if (static_cast<std::size_t>(index_id) >= idx_files_.size()) {
        return nullptr;
    }
    const auto& opt = idx_files_[static_cast<std::size_t>(index_id)];
    return opt ? &(*opt) : nullptr;
}

int SectorChainStore::get_sector_index_id(int index_id) const {
    // Mirrors TS: if meta file exists, sector index id == index id, else index id + 1.
    if (meta_) {
        return index_id;
    }
    return index_id + 1;
}

SectorChainStore::Cluster SectorChainStore::read_cluster(const ByteSource& idx, int index_id, int archive_id) const {
    if (archive_id < 0) {
        throw std::out_of_range("archive_id < 0");
    }
    const std::size_t ptr = static_cast<std::size_t>(archive_id) * CLUSTER_SIZE;
    if (ptr + CLUSTER_SIZE > idx.size()) {
        throw std::out_of_range("cluster ptr out of bounds");
    }

    uint8_t buf[CLUSTER_SIZE];
    idx.read_into(ptr, buf, CLUSTER_SIZE);
    Cluster c;
    c.size = read_u24_be(&buf[0]);
    c.sector = read_u24_be(&buf[3]);
    (void)index_id;
    return c;
}

std::vector<uint32_t> SectorChainStore::walk_chain(
    int sector_index_id,
    uint32_t archive_id,
    uint32_t first_sector,
    uint32_t total_size) const {
    std::vector<uint32_t> sector_ids;
    uint32_t remaining = total_size;
    uint32_t chunk = 0;
    uint32_t sector_id = first_sector;

    uint8_t header[SECTOR_HEADER_SIZE];

    while (remaining > 0) {
        const std::size_t ptr = static_cast<std::size_t>(sector_id) * SECTOR_SIZE;
        if (ptr + SECTOR_HEADER_SIZE > dat_.size()) {
            throw std::out_of_range("sector ptr out of bounds");
        }
        dat_.read_into(ptr, header, SECTOR_HEADER_SIZE);

        const uint32_t read_archive = read_u16_be(&header[0]);
        const uint32_t read_chunk = read_u16_be(&header[2]);
        const uint32_t next_sector = read_u24_be(&header[4]);
        const uint32_t read_index = header[7];

        if ((read_archive & 0xffffu) != (archive_id & 0xffffu)) {
            throw std::runtime_error("sector archive id mismatch");
        }
        if (read_index != static_cast<uint32_t>(sector_index_id)) {
            throw std::runtime_error("sector index id mismatch");
        }
        if (read_chunk != chunk) {
            throw std::runtime_error("sector chunk mismatch");
        }

        sector_ids.push_back(sector_id);
        sector_id = next_sector;
        chunk++;

        if (remaining > SECTOR_DATA_SIZE) {
            remaining -= SECTOR_DATA_SIZE;
        } else {
            remaining = 0;
        }
    }

    return sector_ids;
}

std::vector<uint8_t> SectorChainStore::read(int index_id, int archive_id) const {
    const ByteSource* idx = get_index_file(index_id);
    if (!idx) {
        throw std::runtime_error("index file not found");
    }

    const Cluster cluster = read_cluster(*idx, index_id, archive_id);
    const uint32_t size = cluster.size;
    const int sector_index_id = get_sector_index_id(index_id);

    const std::vector<uint32_t> sector_ids =
        walk_chain(sector_index_id, static_cast<uint32_t>(archive_id), cluster.sector, size);

    std::vector<uint8_t> out;
    out.resize(size);

    std::size_t remaining = size;
    std::size_t out_off = 0;

    for (std::size_t si = 0; remaining > 0; si++) {
        if (si >= sector_ids.size()) {
            throw std::runtime_error("sector chain too short");
        }
        const std::size_t take = std::min<std::size_t>(SECTOR_DATA_SIZE, remaining);
        const std::size_t ptr =
            static_cast<std::size_t>(sector_ids[si]) * SECTOR_SIZE + SECTOR_HEADER_SIZE;
        dat_.read_into(ptr, out.data() + out_off, take);
        out_off += take;
        remaining -= take;
    }

    return out;
}

} // namespace rs_core

