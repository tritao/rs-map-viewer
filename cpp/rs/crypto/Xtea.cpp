#include "Xtea.hpp"

#include <stdexcept>

#include "../io/Endian.hpp"

namespace rs {

static u32 mulU32(u32 a, u32 b) {
    return static_cast<u32>(static_cast<u64>(a) * static_cast<u64>(b));
}

bool Xtea::isValidKey(const std::optional<std::array<u32, 4>>& key) {
    if (!key) {
        return false;
    }
    const auto& k = *key;
    return !(k[0] == 0 && k[1] == 0 && k[2] == 0 && k[3] == 0);
}

void Xtea::decryptInPlace(std::span<u8> data, std::size_t start, std::size_t end, const std::array<u32, 4>& key) {
    if (start > end || end > data.size()) {
        throw std::out_of_range("Xtea: invalid range");
    }

    const std::size_t n = (end - start) / 8;
    const u32 initialSum = mulU32(static_cast<u32>(GOLDEN_RATIO), static_cast<u32>(ROUNDS));

    for (std::size_t i = 0; i < n; i++) {
        const std::size_t off = start + i * 8;
        u32 v0 = readU32BE(data.data() + off);
        u32 v1 = readU32BE(data.data() + off + 4);

        u32 sum = initialSum;
        for (int j = 0; j < ROUNDS; j++) {
            // v1 -= (((v0<<4 ^ v0>>>5) + v0) ^ (sum + key[(sum>>>11)&3]))
            const u32 v0Mix = ((v0 << 4) ^ (v0 >> 5)) + v0;
            const u32 k1 = key[(sum >> 11) & 3u];
            v1 -= (v0Mix ^ (sum + k1));

            sum -= static_cast<u32>(GOLDEN_RATIO);

            // v0 -= (((v1<<4 ^ v1>>>5) + v1) ^ (sum + key[sum&3]))
            const u32 v1Mix = ((v1 << 4) ^ (v1 >> 5)) + v1;
            const u32 k2 = key[sum & 3u];
            v0 -= (v1Mix ^ (sum + k2));
        }

        writeU32BE(data.data() + off, v0);
        writeU32BE(data.data() + off + 4, v1);
    }
}

} // namespace rs

