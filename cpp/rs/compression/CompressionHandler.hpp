#pragma once

#include <cstddef>
#include <span>
#include <vector>

#include "../types.hpp"

namespace rs {

class CompressionHandler {
public:
    virtual ~CompressionHandler() = default;

    [[nodiscard]] virtual std::vector<u8> decompressGzip(std::span<const u8> compressed) const = 0;
    [[nodiscard]] virtual std::vector<u8> decompressBzip2(std::span<const u8> compressed, std::size_t actualSize) const = 0;
};

} // namespace rs
