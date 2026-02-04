#pragma once

#include <vector>

#include "../types.hpp"

namespace rs {

class CompressionHandler {
public:
    virtual ~CompressionHandler() = default;

    [[nodiscard]] virtual std::vector<u8> decompressGzip(const std::vector<u8>& compressed) const = 0;
    [[nodiscard]] virtual std::vector<u8> decompressBzip2(const std::vector<u8>& compressed, std::size_t actualSize) const = 0;
};

} // namespace rs

