#pragma once

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "ByteSource.hpp"

namespace rs {

class Uint8ArrayByteSource final : public ByteSource {
public:
    Uint8ArrayByteSource(const u8* data, std::size_t size) noexcept : data_(data), size_(size) {}

    [[nodiscard]] std::size_t size() const noexcept override { return size_; }
    Status readInto(std::size_t offset, Span<u8> target) const noexcept override;
    [[nodiscard]] bool tryGetView(Span<const u8>* out) const noexcept override;

private:
    const u8* data_ = nullptr;
    std::size_t size_ = 0;
};

} // namespace rs
