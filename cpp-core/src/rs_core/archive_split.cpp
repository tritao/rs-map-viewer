#include "rs_core/archive_split.hpp"

#include "rs_core/bytes.hpp"

#include <stdexcept>

namespace rs_core {

std::vector<std::vector<uint8_t>> archive_split_payload(const std::vector<uint8_t>& payload, std::size_t file_count) {
    if (file_count == 0) {
        throw std::invalid_argument("file_count must be > 0");
    }

    if (file_count == 1) {
        return {payload};
    }

    if (payload.size() < 1) {
        throw std::runtime_error("empty archive");
    }

    const uint8_t chunks = payload[payload.size() - 1];
    const std::size_t table_bytes = static_cast<std::size_t>(chunks) * file_count * 4;
    if (payload.size() < 1 + table_bytes) {
        throw std::runtime_error("invalid archive chunk table");
    }

    const std::size_t table_offset = payload.size() - 1 - table_bytes;

    // Read deltas, reconstruct per-file chunk sizes and totals.
    std::vector<int32_t> chunk_sizes;
    chunk_sizes.resize(static_cast<std::size_t>(chunks) * file_count);

    std::vector<uint32_t> file_sizes;
    file_sizes.resize(file_count, 0);

    std::size_t off = table_offset;
    for (std::size_t chunk = 0; chunk < chunks; chunk++) {
        int32_t last_file_size = 0;
        for (std::size_t file_idx = 0; file_idx < file_count; file_idx++) {
            const int32_t delta = read_i32_be(&payload[off]);
            off += 4;
            last_file_size = static_cast<int32_t>(static_cast<uint32_t>(last_file_size) + static_cast<uint32_t>(delta));
            chunk_sizes[chunk * file_count + file_idx] = last_file_size;
            file_sizes[file_idx] += static_cast<uint32_t>(last_file_size);
        }
    }

    std::vector<std::vector<uint8_t>> out;
    out.resize(file_count);
    for (std::size_t file_idx = 0; file_idx < file_count; file_idx++) {
        out[file_idx].resize(file_sizes[file_idx]);
    }

    std::vector<uint32_t> file_offsets(file_count, 0);

    std::size_t input_offset = 0;
    for (std::size_t chunk = 0; chunk < chunks; chunk++) {
        for (std::size_t file_idx = 0; file_idx < file_count; file_idx++) {
            const uint32_t chunk_size = static_cast<uint32_t>(chunk_sizes[chunk * file_count + file_idx]);
            const uint32_t dst_off = file_offsets[file_idx];

            if (input_offset + chunk_size > table_offset) {
                throw std::runtime_error("payload truncated while splitting");
            }
            if (dst_off + chunk_size > out[file_idx].size()) {
                throw std::runtime_error("internal size mismatch while splitting");
            }

            std::memcpy(out[file_idx].data() + dst_off, payload.data() + input_offset, chunk_size);
            file_offsets[file_idx] = dst_off + chunk_size;
            input_offset += chunk_size;
        }
    }

    return out;
}

} // namespace rs_core

