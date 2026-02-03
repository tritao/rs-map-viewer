#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace rs_core {

struct XteaKey {
    std::array<uint32_t, 4> words{};
};

// Decrypts [start, end) in-place. Range length is truncated to a multiple of 8 bytes.
void xtea_decrypt_in_place(std::vector<uint8_t>& data, std::size_t start, std::size_t end, const XteaKey& key);

} // namespace rs_core

