#include "rs_core/xtea.hpp"

#include "rs_core/bytes.hpp"

#include <stdexcept>

namespace rs_core {

static constexpr uint32_t GOLDEN_RATIO = 0x9e3779b9u;
static constexpr uint32_t ROUNDS = 32u;
static constexpr uint32_t INITIAL_SUM = GOLDEN_RATIO * ROUNDS;

void xtea_decrypt_in_place(std::vector<uint8_t>& data, std::size_t start, std::size_t end, const XteaKey& key) {
    if (start > end || end > data.size()) {
        throw std::out_of_range("xtea_decrypt_in_place invalid range");
    }

    const std::size_t n = ((end - start) / 8);
    for (std::size_t i = 0; i < n; i++) {
        const std::size_t off = start + i * 8;
        uint32_t sum = INITIAL_SUM;
        uint32_t v0 = read_u32_be(&data[off + 0]);
        uint32_t v1 = read_u32_be(&data[off + 4]);

        for (uint32_t j = 0; j < ROUNDS; j++) {
            const uint32_t sum_idx1 = (sum >> 11) & 3u;
            const uint32_t expr1 =
                ((((v0 << 4) ^ (v0 >> 5)) + v0) ^ (sum + key.words[sum_idx1]));
            v1 = v1 - expr1;

            sum = sum - GOLDEN_RATIO;

            const uint32_t sum_idx2 = sum & 3u;
            const uint32_t expr2 =
                ((((v1 << 4) ^ (v1 >> 5)) + v1) ^ (sum + key.words[sum_idx2]));
            v0 = v0 - expr2;
        }

        write_i32_be(&data[off + 0], static_cast<int32_t>(v0));
        write_i32_be(&data[off + 4], static_cast<int32_t>(v1));
    }
}

} // namespace rs_core
