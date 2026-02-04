#pragma once

#include "CompressionHandler.hpp"

namespace rs {

class NativeCompressionHandler final : public CompressionHandler {
public:
    [[nodiscard]] std::vector<u8> decompressGzip(const std::vector<u8>& compressed) const override;
    [[nodiscard]] std::vector<u8> decompressBzip2(const std::vector<u8>& compressed, std::size_t actualSize) const override;
};

} // namespace rs

