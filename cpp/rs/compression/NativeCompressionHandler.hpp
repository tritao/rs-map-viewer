#pragma once

#include <span>

#include "CompressionHandler.hpp"

namespace rs {

class NativeCompressionHandler final : public CompressionHandler {
public:
    [[nodiscard]] std::vector<u8> decompressGzip(std::span<const u8> compressed) const override;
    [[nodiscard]] std::vector<u8> decompressBzip2(std::span<const u8> compressed, std::size_t actualSize) const override;
};

} // namespace rs
