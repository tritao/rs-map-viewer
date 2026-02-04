#pragma once

#include "CompressionHandler.hpp"

namespace rs {

class NativeCompressionHandler final : public CompressionHandler {
public:
    [[nodiscard]] Result<Vec<u8>> decompressGzip(Span<const u8> compressed, Allocator& alloc) const noexcept override;
    [[nodiscard]] Result<Vec<u8>> decompressBzip2(
        Span<const u8> compressed,
        std::size_t actualSize,
        Allocator& alloc) const noexcept override;
};

} // namespace rs
