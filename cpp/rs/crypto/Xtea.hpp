#pragma once

#include <array>
#include <optional>
#include <span>

#include "../types.hpp"

namespace rs {

class Xtea {
public:
    static constexpr i32 GOLDEN_RATIO = static_cast<i32>(0x9e3779b9u);
    static constexpr int ROUNDS = 32;

    static bool isValidKey(const std::optional<std::array<u32, 4>>& key);

    static void decryptInPlace(std::span<u8> data, std::size_t start, std::size_t end, const std::array<u32, 4>& key);
};

} // namespace rs
