#pragma once

#include <cstddef>

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"

namespace rs {

class CompressionHandler {
public:
    virtual ~CompressionHandler() = default;

    [[nodiscard]] virtual Result<Vec<u8>> decompressGzip(Span<const u8> compressed, Allocator& alloc) const noexcept = 0;
    [[nodiscard]] virtual Result<Vec<u8>> decompressBzip2(
        Span<const u8> compressed,
        std::size_t actualSize,
        Allocator& alloc) const noexcept = 0;
};

} // namespace rs
