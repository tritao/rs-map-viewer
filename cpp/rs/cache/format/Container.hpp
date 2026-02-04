#pragma once

#include <array>
#include <optional>
#include <vector>

#include "../../compression/CompressionHandler.hpp"
#include "../../compression/CompressionType.hpp"
#include "../../crypto/Xtea.hpp"
#include "../../io/ByteSource.hpp"

namespace rs {

class Container {
public:
    static Container decodeFromSource(
        const ByteSource& source,
        const std::optional<std::array<u32, 4>>& key,
        const CompressionHandler& compressionHandler);

    Container(CompressionType compression, std::vector<u8> data) : compression(compression), data(std::move(data)) {}

    CompressionType compression;
    std::vector<u8> data;
};

} // namespace rs

